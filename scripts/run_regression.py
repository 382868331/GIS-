from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import math
import sys
from pathlib import Path

import httpx


def expect(response: httpx.Response, *statuses: int) -> httpx.Response:
    if response.status_code not in statuses:
        raise RuntimeError(
            f"{response.request.method} {response.request.url} -> "
            f"{response.status_code}: {response.text[:500]}",
        )
    return response


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def login(client: httpx.Client, email: str, password: str) -> None:
    expect(
        client.post("/api/auth/demo-prepare", json={"email": email, "password": password}),
        200,
    )
    expect(
        client.post(
            "/api/auth/login",
            data={"username": email, "password": password},
        ),
        200,
        204,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Point cloud live regression test")
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--sample", type=Path, required=True)
    parser.add_argument("--email", default="regression.pointcloud@example.com")
    parser.add_argument("--password", default="Regression-Only-2026")
    parser.add_argument("--keep", action="store_true", help="Keep uploaded record after test")
    args = parser.parse_args()

    sample = args.sample.resolve()
    if not sample.exists():
        raise FileNotFoundError(sample)
    print(f"[1/10] Sample: {sample.name} ({sample.stat().st_size:,} bytes)")

    with httpx.Client(base_url=args.api, timeout=180.0, trust_env=False) as client:
        login(client, args.email, args.password)
        config = expect(client.get("/api/point-clouds/config"), 200).json()
        print(f"[2/10] Authenticated; chunk size={config['chunk_size_bytes']:,}")

        upload = expect(
            client.post(
                "/api/point-clouds/uploads",
                json={"file_name": sample.name, "size_bytes": sample.stat().st_size},
            ),
            201,
        ).json()
        chunk_size = upload["chunk_size"]
        total = upload["total_chunks"]
        print(f"[3/10] Upload session {upload['id']} with {total} chunks")

        with sample.open("rb") as source:
            for index in range(min(2, total)):
                content = source.read(chunk_size)
                expect(
                    client.put(
                        f"/api/point-clouds/uploads/{upload['id']}/chunks/{index}",
                        content=content,
                        headers={"X-Chunk-SHA256": digest(content)},
                    ),
                    200,
                )
        print("[4/10] Uploaded first chunks, simulating interruption")

        status_data = expect(
            client.get(f"/api/point-clouds/uploads/{upload['id']}"),
            200,
        ).json()
        uploaded = set(status_data["uploaded_chunks"])
        if not {0, min(1, total - 1)}.issubset(uploaded):
            raise AssertionError("Server did not persist uploaded chunks")

        pending_chunks: list[tuple[int, bytes]] = []
        with sample.open("rb") as source:
            for index in range(total):
                content = source.read(chunk_size)
                if index not in uploaded:
                    pending_chunks.append((index, content))

        def send_chunk(item: tuple[int, bytes]) -> int:
            index, content = item
            expect(
                client.put(
                    f"/api/point-clouds/uploads/{upload['id']}/chunks/{index}",
                    content=content,
                    headers={"X-Chunk-SHA256": digest(content)},
                ),
                200,
            )
            return index

        completed_chunks = len(uploaded)
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [executor.submit(send_chunk, item) for item in pending_chunks]
            for future in as_completed(futures):
                future.result()
                completed_chunks += 1
                if completed_chunks % 5 == 0 or completed_chunks == total:
                    print(f"[5/10] Concurrent resume {completed_chunks}/{total} chunks")

        record = expect(
            client.post(f"/api/point-clouds/uploads/{upload['id']}/complete"),
            200,
        ).json()
        if record["point_count"] <= 0 or record["las_version"] != "1.3":
            raise AssertionError(f"Unexpected metadata: {record}")
        if sum(record["classification_stats"].values()) != record["point_count"]:
            raise AssertionError("Classification statistics do not cover every point")
        if sum(record["return_stats"].values()) != record["point_count"]:
            raise AssertionError("Return statistics do not cover every point")
        if not record["generating_software"] or not isinstance(record["vlr_summary"], list):
            raise AssertionError("Professional LAS metadata is incomplete")
        print(f"[6/10] Validated LAS {record['las_version']}, {record['point_count']:,} points")

        notifications = expect(client.get("/api/notifications"), 200).json()
        if not any(
            item["event_type"] == "UPLOAD_COMPLETED" and item["resource_id"] == record["id"]
            for item in notifications["items"]
        ):
            raise AssertionError("Persistent upload-completed notification is missing")

        listing = expect(client.get("/api/point-clouds?page=1&page_size=100"), 200).json()
        if record["id"] not in {item["id"] for item in listing["items"]}:
            raise AssertionError("Uploaded record missing from list")

        preview = expect(client.get(f"/api/point-clouds/{record['id']}/preview"), 200).json()
        if preview["sampled_count"] > config["max_preview_points"]:
            raise AssertionError("Preview point limit was not applied")
        if len(preview["positions"]) != preview["sampled_count"] * 3:
            raise AssertionError("Preview position payload is malformed")
        print(
            f"[7/10] Preview sampled {preview['sampled_count']:,} points; "
            f"mode={preview['color_mode']}",
        )

        download = expect(client.get(f"/api/point-clouds/{record['id']}/download"), 200)
        if digest(download.content) != record["sha256"]:
            raise AssertionError("Downloaded file hash differs from uploaded file")
        print("[8/10] Download SHA-256 verified")

        edits = expect(client.get(f"/api/point-clouds/{record['id']}/edits"), 200).json()
        if edits["revision"] != 0 or edits["document"].get("objects") != []:
            raise AssertionError(f"Unexpected initial edit document: {edits}")
        auto_document = {
            "objects": [
                {
                    "id": "regression-point",
                    "type": "point",
                    "points": [[1.0, 2.0, 3.0]],
                    "label": "Regression point",
                },
            ],
        }
        auto_saved = expect(
            client.put(
                f"/api/point-clouds/{record['id']}/edits",
                json={"revision": 0, "document": auto_document, "save_mode": "auto"},
            ),
            200,
        ).json()
        if auto_saved["revision"] != 1:
            raise AssertionError("Autosave did not advance edit revision")
        expect(
            client.put(
                f"/api/point-clouds/{record['id']}/edits",
                json={"revision": 0, "document": auto_document, "save_mode": "auto"},
            ),
            409,
        )
        manual_saved = expect(
            client.put(
                f"/api/point-clouds/{record['id']}/edits",
                json={"revision": 1, "document": auto_document, "save_mode": "manual"},
            ),
            200,
        ).json()
        if manual_saved["revision"] != 2:
            raise AssertionError("Manual save did not advance edit revision")
        notifications = expect(client.get("/api/notifications"), 200).json()
        edit_events = {
            item["event_type"]
            for item in notifications["items"]
            if item["resource_id"] == record["id"]
        }
        if not {"EDIT_AUTO_SAVED", "EDIT_MANUAL_SAVED"}.issubset(edit_events):
            raise AssertionError("Persistent edit-save notifications are missing")
        print("[9/10] Edit autosave, conflict detection, manual save, and notifications verified")

        if not args.keep:
            expect(client.delete(f"/api/point-clouds/{record['id']}"), 204)
            expect(client.get(f"/api/point-clouds/{record['id']}"), 404)
            notifications = expect(client.get("/api/notifications"), 200).json()
            if not any(
                item["event_type"] == "POINT_CLOUD_DELETED"
                and item["resource_id"] == record["id"]
                for item in notifications["items"]
            ):
                raise AssertionError("Persistent delete notification is missing")
            print("[10/10] Delete and 404 behavior verified")
        else:
            print(f"[10/10] Kept record {record['id']}")

    print("REGRESSION PASSED")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"REGRESSION FAILED: {error}", file=sys.stderr)
        raise
