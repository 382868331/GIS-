from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile

from minio import Minio
from minio.error import S3Error

from app.config import Settings
from app.config import get_settings


class ObjectStorageError(RuntimeError):
    pass


class ObjectNotFoundError(ObjectStorageError):
    pass


class ObjectStorage:
    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.minio_bucket
        self.client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
            region=settings.minio_region,
        )

    def ensure_ready(self) -> None:
        try:
            if not self.client.bucket_exists(self.bucket):
                raise ObjectStorageError(
                    f"MinIO bucket {self.bucket!r} does not exist; run the MinIO initializer",
                )
        except S3Error as error:
            raise ObjectStorageError("MinIO is unavailable or credentials are invalid") from error

    def put_file(self, object_key: str, source: Path, sha256: str) -> None:
        try:
            result = self.client.fput_object(
                self.bucket,
                object_key,
                str(source),
                content_type="application/vnd.las",
                metadata={"sha256": sha256},
            )
            stored = self.client.stat_object(self.bucket, object_key)
            if stored.size != source.stat().st_size:
                self.client.remove_object(self.bucket, object_key)
                raise ObjectStorageError("MinIO object size verification failed")
            if not result.etag:
                raise ObjectStorageError("MinIO did not return an object ETag")
        except ObjectStorageError:
            raise
        except S3Error as error:
            raise ObjectStorageError("Failed to upload LAS object to MinIO") from error

    def stat(self, object_key: str):
        try:
            return self.client.stat_object(self.bucket, object_key)
        except S3Error as error:
            if error.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
                raise ObjectNotFoundError(f"Object {object_key!r} does not exist") from error
            raise ObjectStorageError("Failed to read object metadata from MinIO") from error

    def iter_object(self, object_key: str, block_size: int = 1024 * 1024) -> Iterator[bytes]:
        response = None
        try:
            response = self.client.get_object(self.bucket, object_key)
            while block := response.read(block_size):
                yield block
        except S3Error as error:
            if error.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
                raise ObjectNotFoundError(f"Object {object_key!r} does not exist") from error
            raise ObjectStorageError("Failed to stream object from MinIO") from error
        finally:
            if response is not None:
                response.close()
                response.release_conn()

    @contextmanager
    def local_copy(self, object_key: str) -> Iterator[Path]:
        temporary_path: Path | None = None
        try:
            with NamedTemporaryFile(suffix=".las", delete=False) as temporary:
                temporary_path = Path(temporary.name)
            self.client.fget_object(self.bucket, object_key, str(temporary_path))
            yield temporary_path
        except S3Error as error:
            if error.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
                raise ObjectNotFoundError(f"Object {object_key!r} does not exist") from error
            raise ObjectStorageError("Failed to download object from MinIO") from error
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def remove(self, object_key: str) -> None:
        try:
            self.client.remove_object(self.bucket, object_key)
        except S3Error as error:
            raise ObjectStorageError("Failed to remove object from MinIO") from error


@lru_cache
def get_object_storage() -> ObjectStorage:
    return ObjectStorage(get_settings())
