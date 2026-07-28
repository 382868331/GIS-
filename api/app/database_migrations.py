from sqlalchemy import text

from app.database import engine


POINT_CLOUD_COLUMNS = {
    "crs_wkt": "TEXT",
    "crs_epsg": "INTEGER",
    "classification_stats": "JSON",
    "return_stats": "JSON",
    "gps_time_min": "DOUBLE PRECISION",
    "gps_time_max": "DOUBLE PRECISION",
    "generating_software": "VARCHAR(64)",
    "system_identifier": "VARCHAR(64)",
    "vlr_summary": "JSON",
    "evlr_summary": "JSON",
}


def apply_runtime_migrations() -> None:
    """Apply additive PostgreSQL migrations needed by this demo deployment."""
    with engine.begin() as connection:
        for name, sql_type in POINT_CLOUD_COLUMNS.items():
            connection.execute(
                text(f"ALTER TABLE point_clouds ADD COLUMN IF NOT EXISTS {name} {sql_type}"),
            )
