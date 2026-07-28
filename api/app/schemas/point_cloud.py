from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UploadCreate(BaseModel):
    file_name: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)
    sha256: str | None = Field(default=None, pattern=r"^[a-fA-F0-9]{64}$")

    @field_validator("file_name")
    @classmethod
    def normalize_file_name(cls, value: str) -> str:
        normalized = value.strip().replace("\\", "/").split("/")[-1]
        if not normalized:
            raise ValueError("文件名不能为空")
        return normalized


class UploadSessionRead(BaseModel):
    id: str
    file_name: str
    size_bytes: int
    chunk_size: int
    total_chunks: int
    uploaded_chunks: list[int]
    status: str
    expires_at: datetime


class ChunkUploadResult(BaseModel):
    upload_id: str
    chunk_index: int
    uploaded_chunks: list[int]
    uploaded_bytes: int
    complete: bool


class PointCloudRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_name: str
    size_bytes: int
    sha256: str
    las_version: str
    point_format: int
    point_count: int
    has_rgb: bool
    has_intensity: bool
    min_x: float
    max_x: float
    min_y: float
    max_y: float
    min_z: float
    max_z: float
    scale_x: float
    scale_y: float
    scale_z: float
    offset_x: float
    offset_y: float
    offset_z: float
    crs_wkt: str | None
    crs_epsg: int | None
    classification_stats: dict[str, int] | None
    return_stats: dict[str, int] | None
    gps_time_min: float | None
    gps_time_max: float | None
    generating_software: str | None
    system_identifier: str | None
    vlr_summary: list[dict[str, object]] | None
    evlr_summary: list[dict[str, object]] | None
    status: str
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class PointCloudList(BaseModel):
    items: list[PointCloudRead]
    page: int
    page_size: int
    total: int
    total_pages: int


class PointCloudUpdate(BaseModel):
    original_name: str = Field(min_length=1, max_length=255)

    @field_validator("original_name")
    @classmethod
    def normalize_original_name(cls, value: str) -> str:
        name = value.strip().replace("\\", "/").split("/")[-1]
        if not name.lower().endswith(".las"):
            raise ValueError("文件名必须以 .las 结尾")
        return name


class EditDocumentRead(BaseModel):
    point_cloud_id: str
    revision: int
    document: dict[str, object]
    updated_at: datetime


class EditDocumentWrite(BaseModel):
    revision: int = Field(ge=0)
    document: dict[str, object]
    save_mode: str = Field(pattern=r"^(auto|manual)$")


class PreviewBounds(BaseModel):
    min: list[float]
    max: list[float]
    center: list[float]


class PointCloudPreview(BaseModel):
    id: str
    point_count: int
    sampled_count: int
    has_rgb: bool
    color_mode: str
    positions: list[float]
    colors: list[float]
    intensities: list[float]
    bounds: PreviewBounds
