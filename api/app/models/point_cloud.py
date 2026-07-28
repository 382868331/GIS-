from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Float, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class PointCloud(Base):
    __tablename__ = "point_clouds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    las_version: Mapped[str] = mapped_column(String(16), nullable=False)
    point_format: Mapped[int] = mapped_column(Integer, nullable=False)
    point_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    has_rgb: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_intensity: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    min_x: Mapped[float] = mapped_column(Float, nullable=False)
    max_x: Mapped[float] = mapped_column(Float, nullable=False)
    min_y: Mapped[float] = mapped_column(Float, nullable=False)
    max_y: Mapped[float] = mapped_column(Float, nullable=False)
    min_z: Mapped[float] = mapped_column(Float, nullable=False)
    max_z: Mapped[float] = mapped_column(Float, nullable=False)
    scale_x: Mapped[float] = mapped_column(Float, nullable=False)
    scale_y: Mapped[float] = mapped_column(Float, nullable=False)
    scale_z: Mapped[float] = mapped_column(Float, nullable=False)
    offset_x: Mapped[float] = mapped_column(Float, nullable=False)
    offset_y: Mapped[float] = mapped_column(Float, nullable=False)
    offset_z: Mapped[float] = mapped_column(Float, nullable=False)
    crs_wkt: Mapped[str | None] = mapped_column(Text, nullable=True)
    crs_epsg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    classification_stats: Mapped[dict[str, int] | None] = mapped_column(JSON, nullable=True)
    return_stats: Mapped[dict[str, int] | None] = mapped_column(JSON, nullable=True)
    gps_time_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_time_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    generating_software: Mapped[str | None] = mapped_column(String(64), nullable=True)
    system_identifier: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vlr_summary: Mapped[list[dict[str, object]] | None] = mapped_column(JSON, nullable=True)
    evlr_summary: Mapped[list[dict[str, object]] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="READY")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )


class UploadSession(Base):
    __tablename__ = "point_cloud_upload_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expected_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    chunk_size: Mapped[int] = mapped_column(Integer, nullable=False)
    total_chunks: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_chunks: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="UPLOADING")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PointCloudEditDocument(Base):
    __tablename__ = "point_cloud_edit_documents"

    point_cloud_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    document: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )
