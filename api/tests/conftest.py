from pathlib import Path

import laspy
import numpy as np
import pytest


@pytest.fixture
def las_factory(tmp_path: Path):
    def create(name: str = "sample.las", *, with_rgb: bool = False, count: int = 1000) -> Path:
        point_format = 3 if with_rgb else 1
        las = laspy.create(point_format=point_format, file_version="1.2")
        las.x = np.linspace(256000.0, 256100.0, count)
        las.y = np.linspace(4111000.0, 4111100.0, count)
        las.z = np.linspace(380.0, 430.0, count)
        las.intensity = np.arange(count, dtype=np.uint16)
        if with_rgb:
            las.red = np.linspace(0, 65535, count, dtype=np.uint16)
            las.green = np.linspace(65535, 0, count, dtype=np.uint16)
            las.blue = np.full(count, 32768, dtype=np.uint16)
        path = tmp_path / name
        las.write(path)
        return path

    return create
