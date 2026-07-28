from __future__ import annotations

import hashlib
import math
import shutil
import threading
import uuid
from pathlib import Path

from app.models.point_cloud import UploadSession


class UploadError(ValueError):
    pass


_locks_guard = threading.Lock()
_upload_locks: dict[str, threading.Lock] = {}


def upload_lock(upload_id: str) -> threading.Lock:
    with _locks_guard:
        return _upload_locks.setdefault(upload_id, threading.Lock())


def validate_upload_request(file_name: str, size_bytes: int, max_size: int) -> str:
    safe_name = Path(file_name.replace("\\", "/")).name.strip()
    if not safe_name:
        raise UploadError("文件名不能为空")
    if Path(safe_name).suffix.lower() != ".las":
        raise UploadError("只允许上传 .las 文件")
    if size_bytes <= 0:
        raise UploadError("文件不能为空")
    if size_bytes > max_size:
        raise UploadError(f"文件超过大小限制（最大 {max_size} 字节）")
    return safe_name


def total_chunks(size_bytes: int, chunk_size: int) -> int:
    return math.ceil(size_bytes / chunk_size)


def session_directory(temp_root: Path, upload_id: str) -> Path:
    directory = temp_root / upload_id
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def chunk_path(temp_root: Path, upload_id: str, chunk_index: int) -> Path:
    return session_directory(temp_root, upload_id) / f"{chunk_index:08d}.part"


def expected_chunk_size(session: UploadSession, chunk_index: int) -> int:
    if chunk_index < 0 or chunk_index >= session.total_chunks:
        raise UploadError("分片序号超出范围")
    if chunk_index == session.total_chunks - 1:
        return session.size_bytes - session.chunk_size * (session.total_chunks - 1)
    return session.chunk_size


def save_chunk(
    session: UploadSession,
    temp_root: Path,
    chunk_index: int,
    content: bytes,
    expected_sha256: str | None,
) -> None:
    expected_size = expected_chunk_size(session, chunk_index)
    if len(content) != expected_size:
        raise UploadError(f"分片大小错误，应为 {expected_size} 字节")
    if expected_sha256:
        actual_hash = hashlib.sha256(content).hexdigest()
        if actual_hash.lower() != expected_sha256.lower():
            raise UploadError("分片校验值不匹配，请重新上传该分片")

    target = chunk_path(temp_root, session.id, chunk_index)
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(content)
    temporary.replace(target)


def uploaded_bytes(session: UploadSession) -> int:
    total = 0
    for index in session.uploaded_chunks:
        total += expected_chunk_size(session, index)
    return total


def assemble_chunks(session: UploadSession, temp_root: Path) -> Path:
    missing = sorted(set(range(session.total_chunks)) - set(session.uploaded_chunks))
    if missing:
        raise UploadError(f"仍有 {len(missing)} 个分片未上传")

    directory = session_directory(temp_root, session.id)
    assembled = directory / "assembled.las"
    temporary = directory / "assembled.tmp"
    with temporary.open("wb") as output:
        for index in range(session.total_chunks):
            part = chunk_path(temp_root, session.id, index)
            if not part.exists():
                raise UploadError(f"分片 {index} 在磁盘中不存在")
            with part.open("rb") as source:
                shutil.copyfileobj(source, output, length=1024 * 1024)
    temporary.replace(assembled)
    if assembled.stat().st_size != session.size_bytes:
        assembled.unlink(missing_ok=True)
        raise UploadError("合并后的文件大小不一致")
    return assembled


def remove_upload_parts(temp_root: Path, upload_id: str) -> None:
    directory = temp_root / upload_id
    if directory.exists():
        shutil.rmtree(directory)
    with _locks_guard:
        _upload_locks.pop(upload_id, None)


def new_upload_id() -> str:
    return str(uuid.uuid4())
