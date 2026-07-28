from pathlib import Path

import pytest

from app.services.las_service import LasValidationError, build_preview, validate_and_extract


def test_valid_las_metadata_and_preview(las_factory):
    path = las_factory(with_rgb=False, count=1200)
    metadata = validate_and_extract(path, "SAMPLE.LAS", 20 * 1024 * 1024)

    assert metadata.point_count == 1200
    assert metadata.las_version == "1.2"
    assert metadata.has_rgb is False
    assert metadata.has_intensity is True
    assert len(metadata.sha256) == 64
    assert sum(metadata.classification_stats.values()) == 1200
    assert sum(metadata.return_stats.values()) == 1200
    assert metadata.generating_software is not None
    assert isinstance(metadata.vlr_summary, list)
    assert isinstance(metadata.evlr_summary, list)

    preview = build_preview(path, "record-1", 200)
    assert preview["sampled_count"] == 200
    assert preview["color_mode"] == "HEIGHT"
    assert len(preview["positions"]) == 600
    assert len(preview["colors"]) == 600
    assert len(preview["intensities"]) == 200
    assert max(abs(value) for value in preview["positions"]) < 100


def test_rgb_las_uses_source_colors(las_factory):
    path = las_factory(with_rgb=True, count=60)
    metadata = validate_and_extract(path, path.name, path.stat().st_size + 1)
    preview = build_preview(path, "rgb", 100)

    assert metadata.has_rgb is True
    assert preview["has_rgb"] is True
    assert preview["color_mode"] == "RGB"
    assert min(preview["colors"]) >= 0
    assert max(preview["colors"]) <= 1


@pytest.mark.parametrize("name", ["sample.txt", "sample.laz", "sample"])
def test_wrong_extension_is_rejected(las_factory, name: str):
    path = las_factory()
    with pytest.raises(LasValidationError, match="只允许"):
        validate_and_extract(path, name, 20 * 1024 * 1024)


def test_text_renamed_to_las_is_rejected(tmp_path: Path):
    path = tmp_path / "fake.las"
    path.write_text("not a point cloud", encoding="utf-8")
    with pytest.raises(LasValidationError, match="文件签名"):
        validate_and_extract(path, path.name, 1024)


def test_truncated_las_is_rejected(las_factory, tmp_path: Path):
    valid = las_factory()
    truncated = tmp_path / "truncated.las"
    truncated.write_bytes(valid.read_bytes()[:80])
    with pytest.raises(LasValidationError, match="损坏"):
        validate_and_extract(truncated, truncated.name, 20 * 1024 * 1024)


def test_oversized_file_is_rejected(las_factory):
    path = las_factory()
    with pytest.raises(LasValidationError, match="大小限制"):
        validate_and_extract(path, path.name, path.stat().st_size - 1)
