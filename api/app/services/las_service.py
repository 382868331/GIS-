from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np


class LasValidationError(ValueError):
    pass


@dataclass(frozen=True)
class LasMetadata:
    size_bytes: int
    sha256: str
    las_version: str
    point_format: int
    point_count: int
    has_rgb: bool
    has_intensity: bool
    mins: tuple[float, float, float]
    maxs: tuple[float, float, float]
    scales: tuple[float, float, float]
    offsets: tuple[float, float, float]
    crs_wkt: str | None
    crs_epsg: int | None
    classification_stats: dict[str, int]
    return_stats: dict[str, int]
    gps_time_min: float | None
    gps_time_max: float | None
    generating_software: str | None
    system_identifier: str | None
    vlr_summary: list[dict[str, object]]
    evlr_summary: list[dict[str, object]]


def _vlr_summary(vlrs: object | None) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for vlr in vlrs or []:
        try:
            data_length = len(vlr.record_data_bytes())
        except Exception:
            data_length = 0
        result.append({
            "user_id": str(getattr(vlr, "user_id", "")),
            "record_id": int(getattr(vlr, "record_id", 0)),
            "description": str(getattr(vlr, "description", "")),
            "data_length": data_length,
            "type": type(vlr).__name__,
        })
    return result


def calculate_sha256(path: Path, block_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(block_size), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_and_extract(path: Path, original_name: str, max_size: int) -> LasMetadata:
    if Path(original_name).suffix.lower() != ".las":
        raise LasValidationError("只允许上传 .las 文件")
    if not path.exists():
        raise LasValidationError("上传文件不存在")

    size_bytes = path.stat().st_size
    if size_bytes == 0:
        raise LasValidationError("文件不能为空")
    if size_bytes > max_size:
        raise LasValidationError(f"文件超过大小限制（最大 {max_size} 字节）")

    with path.open("rb") as stream:
        if stream.read(4) != b"LASF":
            raise LasValidationError("文件签名无效，不是合法 LAS 文件")

    try:
        with laspy.open(path) as reader:
            header = reader.header
            point_count = int(header.point_count)
            dimensions = set(header.point_format.dimension_names)
            if point_count <= 0:
                raise LasValidationError("LAS 文件不包含点数据")

            classification_stats: dict[str, int] = {}
            return_stats: dict[str, int] = {}
            gps_time_min: float | None = None
            gps_time_max: float | None = None
            for points in reader.chunk_iterator(1_000_000):
                if "classification" in dimensions:
                    values, counts = np.unique(
                        np.asarray(points.classification, dtype=np.uint8),
                        return_counts=True,
                    )
                    for value, count in zip(values, counts, strict=True):
                        key = str(int(value))
                        classification_stats[key] = classification_stats.get(key, 0) + int(count)
                if "return_number" in dimensions:
                    values, counts = np.unique(
                        np.asarray(points.return_number, dtype=np.uint8),
                        return_counts=True,
                    )
                    for value, count in zip(values, counts, strict=True):
                        key = str(int(value))
                        return_stats[key] = return_stats.get(key, 0) + int(count)
                if "gps_time" in dimensions:
                    gps_values = np.asarray(points.gps_time, dtype=np.float64)
                    finite = gps_values[np.isfinite(gps_values)]
                    if len(finite):
                        chunk_min = float(finite.min())
                        chunk_max = float(finite.max())
                        gps_time_min = chunk_min if gps_time_min is None else min(gps_time_min, chunk_min)
                        gps_time_max = chunk_max if gps_time_max is None else max(gps_time_max, chunk_max)

            crs_wkt: str | None = None
            crs_epsg: int | None = None
            try:
                crs = header.parse_crs()
                if crs is not None:
                    crs_wkt = crs.to_wkt()
                    crs_epsg = crs.to_epsg()
            except Exception:
                pass

            return LasMetadata(
                size_bytes=size_bytes,
                sha256=calculate_sha256(path),
                las_version=str(header.version),
                point_format=int(header.point_format.id),
                point_count=point_count,
                has_rgb={"red", "green", "blue"}.issubset(dimensions),
                has_intensity="intensity" in dimensions,
                mins=tuple(float(value) for value in header.mins),
                maxs=tuple(float(value) for value in header.maxs),
                scales=tuple(float(value) for value in header.scales),
                offsets=tuple(float(value) for value in header.offsets),
                crs_wkt=crs_wkt,
                crs_epsg=crs_epsg,
                classification_stats=classification_stats,
                return_stats=return_stats,
                gps_time_min=gps_time_min,
                gps_time_max=gps_time_max,
                generating_software=str(header.generating_software).strip() or None,
                system_identifier=str(header.system_identifier).strip() or None,
                vlr_summary=_vlr_summary(header.vlrs),
                evlr_summary=_vlr_summary(header.evlrs),
            )
    except LasValidationError:
        raise
    except Exception as error:
        raise LasValidationError("LAS 文件损坏、被截断或无法解析") from error


def _height_colors(z_values: np.ndarray, min_z: float, max_z: float) -> np.ndarray:
    span = max(max_z - min_z, 1e-9)
    normalized = np.clip((z_values - min_z) / span, 0.0, 1.0)
    colors = np.empty((len(normalized), 3), dtype=np.float32)
    colors[:, 0] = np.clip(1.7 * normalized - 0.15, 0.08, 1.0)
    colors[:, 1] = np.clip(1.45 - np.abs(normalized - 0.52) * 2.2, 0.18, 0.95)
    colors[:, 2] = np.clip(1.25 - 1.45 * normalized, 0.18, 1.0)
    return colors


def build_preview(path: Path, point_cloud_id: str, max_points: int) -> dict[str, object]:
    try:
        with laspy.open(path) as reader:
            header = reader.header
            total = int(header.point_count)
            if total <= 0:
                raise LasValidationError("点云不包含可预览的点")
            stride = max(1, math.ceil(total / max_points))
            center = (header.mins + header.maxs) / 2.0
            has_rgb = {"red", "green", "blue"}.issubset(
                set(header.point_format.dimension_names),
            )
            position_parts: list[np.ndarray] = []
            color_parts: list[np.ndarray] = []
            intensity_parts: list[np.ndarray] = []
            has_intensity = "intensity" in set(header.point_format.dimension_names)
            remaining = max_points

            for points in reader.chunk_iterator(1_000_000):
                sampled = points[::stride]
                if len(sampled) > remaining:
                    sampled = sampled[:remaining]
                if len(sampled) == 0:
                    continue

                positions = np.column_stack((
                    np.asarray(sampled.x) - center[0],
                    np.asarray(sampled.y) - center[1],
                    np.asarray(sampled.z) - center[2],
                )).astype(np.float32)
                position_parts.append(positions)

                if has_rgb:
                    rgb = np.column_stack((sampled.red, sampled.green, sampled.blue)).astype(
                        np.float32,
                    )
                    divisor = 65535.0 if float(rgb.max(initial=0)) > 255 else 255.0
                    color_parts.append(np.clip(rgb / divisor, 0.0, 1.0))
                else:
                    color_parts.append(
                        _height_colors(
                            np.asarray(sampled.z, dtype=np.float64),
                            float(header.mins[2]),
                            float(header.maxs[2]),
                        ),
                    )

                if has_intensity:
                    intensity = np.asarray(sampled.intensity, dtype=np.float32)
                    maximum = max(float(intensity.max(initial=0)), 1.0)
                    intensity_parts.append(np.clip(intensity / maximum, 0.0, 1.0))
                else:
                    intensity_parts.append(np.zeros(len(sampled), dtype=np.float32))

                remaining -= len(sampled)
                if remaining <= 0:
                    break

            positions = np.concatenate(position_parts, axis=0)
            colors = np.concatenate(color_parts, axis=0)
            intensities = np.concatenate(intensity_parts, axis=0)
            return {
                "id": point_cloud_id,
                "point_count": total,
                "sampled_count": int(len(positions)),
                "has_rgb": has_rgb,
                "color_mode": "RGB" if has_rgb else "HEIGHT",
                "positions": positions.reshape(-1).tolist(),
                "colors": colors.reshape(-1).tolist(),
                "intensities": intensities.tolist(),
                "bounds": {
                    "min": [float(value) for value in header.mins],
                    "max": [float(value) for value in header.maxs],
                    "center": [float(value) for value in center],
                },
            }
    except LasValidationError:
        raise
    except Exception as error:
        raise LasValidationError("点云预览数据读取失败") from error
