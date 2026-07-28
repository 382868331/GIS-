import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.models.point_cloud import UploadSession
from app.services.upload_service import (
    UploadError,
    assemble_chunks,
    expected_chunk_size,
    remove_upload_parts,
    save_chunk,
    total_chunks,
    uploaded_bytes,
    validate_upload_request,
)


def make_session(size: int, chunk_size: int) -> UploadSession:
    return UploadSession(
        id="upload-test",
        user_id="user-test",
        original_name="sample.las",
        size_bytes=size,
        chunk_size=chunk_size,
        total_chunks=total_chunks(size, chunk_size),
        uploaded_chunks=[],
        status="UPLOADING",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )


def test_chunks_can_resume_and_assemble(tmp_path: Path):
    content = b"LASF" + bytes(range(256)) * 40
    session = make_session(len(content), 1024)

    first = content[:1024]
    save_chunk(session, tmp_path, 0, first, hashlib.sha256(first).hexdigest())
    session.uploaded_chunks = [0]
    assert uploaded_bytes(session) == 1024

    for index in range(1, session.total_chunks):
        start = index * session.chunk_size
        chunk = content[start:start + session.chunk_size]
        save_chunk(session, tmp_path, index, chunk, hashlib.sha256(chunk).hexdigest())
        session.uploaded_chunks = [*session.uploaded_chunks, index]

    assembled = assemble_chunks(session, tmp_path)
    assert assembled.read_bytes() == content
    remove_upload_parts(tmp_path, session.id)
    assert not (tmp_path / session.id).exists()


def test_chunk_hash_and_size_are_verified(tmp_path: Path):
    session = make_session(1500, 1000)
    with pytest.raises(UploadError, match="大小"):
        save_chunk(session, tmp_path, 0, b"short", None)
    with pytest.raises(UploadError, match="校验值"):
        save_chunk(session, tmp_path, 0, b"x" * 1000, "0" * 64)
    assert expected_chunk_size(session, 1) == 500


def test_upload_request_is_sanitized_and_validated():
    assert validate_upload_request("../../safe.LAS", 100, 1000) == "safe.LAS"
    with pytest.raises(UploadError, match="只允许"):
        validate_upload_request("unsafe.exe", 100, 1000)
    with pytest.raises(UploadError, match="大小限制"):
        validate_upload_request("large.las", 1001, 1000)
