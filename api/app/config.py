from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    async_database_url: str
    redis_url: str
    auth_secret: str
    auth_cookie_secure: bool = False
    upload_temp_dir: Path = Path("data/upload-parts")
    legacy_upload_dir: Path = Path("data/uploads")
    bundled_sample_path: Path = Path("../NEONDSSampleLiDARPointCloud.las")
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str = "point-clouds"
    minio_secure: bool = False
    minio_region: str = "us-east-1"
    max_upload_size_bytes: int = 512 * 1024 * 1024
    upload_chunk_size_bytes: int = 5 * 1024 * 1024
    upload_session_hours: int = 24
    max_preview_points: int = 200_000

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
