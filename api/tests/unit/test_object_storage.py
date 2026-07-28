from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import object_storage as module
from app.services.object_storage import ObjectStorage, ObjectStorageError


class FakeMinio:
    def __init__(self, *args, **kwargs) -> None:
        self.objects: dict[str, bytes] = {}
        self.removed: list[str] = []
        self.closed = False

    def bucket_exists(self, bucket: str) -> bool:
        return bucket == "point-clouds"

    def fput_object(self, bucket: str, key: str, path: str, **kwargs):
        self.objects[key] = Path(path).read_bytes()
        return SimpleNamespace(etag="fake-etag")

    def stat_object(self, bucket: str, key: str):
        return SimpleNamespace(size=len(self.objects[key]), etag="fake-etag")

    def get_object(self, bucket: str, key: str):
        payload = self.objects[key]
        owner = self

        class Response:
            cursor = 0

            def read(self, size: int) -> bytes:
                block = payload[self.cursor:self.cursor + size]
                self.cursor += len(block)
                return block

            def close(self) -> None:
                owner.closed = True

            def release_conn(self) -> None:
                pass

        return Response()

    def fget_object(self, bucket: str, key: str, path: str):
        Path(path).write_bytes(self.objects[key])

    def remove_object(self, bucket: str, key: str) -> None:
        self.removed.append(key)
        self.objects.pop(key, None)


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> ObjectStorage:
    monkeypatch.setattr(module, "Minio", FakeMinio)
    settings = SimpleNamespace(
        minio_bucket="point-clouds",
        minio_endpoint="127.0.0.1:9000",
        minio_access_key="test-access",
        minio_secret_key="test-secret",
        minio_secure=False,
        minio_region="us-east-1",
    )
    return ObjectStorage(settings)  # type: ignore[arg-type]


def test_put_stream_and_remove(storage: ObjectStorage, tmp_path: Path) -> None:
    source = tmp_path / "sample.las"
    source.write_bytes(b"LASF-test-payload")

    storage.ensure_ready()
    storage.put_file("users/u/record.las", source, "abc")

    assert b"".join(storage.iter_object("users/u/record.las", block_size=4)) == source.read_bytes()
    assert storage.client.closed is True  # type: ignore[attr-defined]

    storage.remove("users/u/record.las")
    assert storage.client.removed == ["users/u/record.las"]  # type: ignore[attr-defined]


def test_local_copy_is_cleaned_up(storage: ObjectStorage, tmp_path: Path) -> None:
    source = tmp_path / "sample.las"
    source.write_bytes(b"LASF-preview")
    storage.put_file("record.las", source, "abc")

    copied_path: Path | None = None
    with storage.local_copy("record.las") as local_path:
        copied_path = local_path
        assert local_path.read_bytes() == source.read_bytes()
        assert local_path.exists()

    assert copied_path is not None
    assert not copied_path.exists()


def test_put_rejects_size_mismatch(storage: ObjectStorage, tmp_path: Path) -> None:
    source = tmp_path / "sample.las"
    source.write_bytes(b"LASF")
    storage.client.stat_object = lambda bucket, key: SimpleNamespace(size=3)  # type: ignore[method-assign]

    with pytest.raises(ObjectStorageError, match="size"):
        storage.put_file("record.las", source, "abc")
