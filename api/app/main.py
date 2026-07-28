from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi_users.exceptions import UserNotExists
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse, JSONResponse

from app.auth.database import User, auth_engine, create_auth_tables
from app.auth.schemas import DemoAuthCredentials, UserCreate, UserRead, UserUpdate
from app.auth.users import (
    UserManager,
    auth_backend,
    auth_redis,
    current_active_user,
    fastapi_users,
    get_user_manager,
)
from app.config import get_settings
from app.database import Base, SessionLocal, engine, redis_client
from app.database_migrations import apply_runtime_migrations
from app.models.point_cloud import PointCloud
from app.models.test import TestRecord
from app.routers.demo_data import router as demo_data_router
from app.routers.health import router as health_router
from app.routers.notifications import router as notifications_router
from app.routers.point_clouds import router as point_clouds_router
from app.services.notifications import notification_hub
from app.services.object_storage import ObjectNotFoundError, get_object_storage
from app.services.las_service import validate_and_extract


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.upload_temp_dir.mkdir(parents=True, exist_ok=True)
    object_storage = get_object_storage()
    object_storage.ensure_ready()
    await create_auth_tables()
    Base.metadata.create_all(bind=engine)
    apply_runtime_migrations()
    notification_hub.bind_running_loop()

    with SessionLocal() as session:
        if session.query(TestRecord).count() == 0:
            session.add(TestRecord(name="PostgreSQL 示例数据"))
            session.commit()
        for record in session.query(PointCloud).filter(PointCloud.status == "READY"):
            try:
                object_storage.stat(record.storage_key)
            except ObjectNotFoundError:
                legacy_path = settings.legacy_upload_dir / record.storage_key
                if legacy_path.exists():
                    object_storage.put_file(record.storage_key, legacy_path, record.sha256)
                    legacy_path.unlink()
            if record.classification_stats is None:
                with object_storage.local_copy(record.storage_key) as local_path:
                    metadata = validate_and_extract(
                        local_path,
                        record.original_name,
                        settings.max_upload_size_bytes,
                    )
                record.crs_wkt = metadata.crs_wkt
                record.crs_epsg = metadata.crs_epsg
                record.classification_stats = metadata.classification_stats
                record.return_stats = metadata.return_stats
                record.gps_time_min = metadata.gps_time_min
                record.gps_time_max = metadata.gps_time_max
                record.generating_software = metadata.generating_software
                record.system_identifier = metadata.system_identifier
                record.vlr_summary = metadata.vlr_summary
                record.evlr_summary = metadata.evlr_summary
        session.commit()

    redis_client.setnx("demo:test", "Redis 示例数据")
    yield
    await auth_redis.aclose()
    await auth_engine.dispose()
    redis_client.close()
    engine.dispose()


app = FastAPI(
    title="Point Cloud Platform API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(demo_data_router)
app.include_router(point_clouds_router)
app.include_router(notifications_router)
app.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/api/auth",
    tags=["Authentication"],
)
app.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/api/auth",
    tags=["Authentication"],
)
app.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/api/users",
    tags=["Users"],
)


@app.post("/api/auth/demo-prepare", tags=["Authentication"])
async def prepare_demo_account(
    credentials: DemoAuthCredentials,
    user_manager: UserManager = Depends(get_user_manager),
) -> dict[str, str]:
    """Create the demo account or align its password before normal login."""
    try:
        user = await user_manager.get_by_email(credentials.email)
    except UserNotExists:
        await user_manager.create(
            UserCreate(email=credentials.email, password=credentials.password),
        )
        return {"action": "registered"}

    password_matches, updated_hash = user_manager.password_helper.verify_and_update(
        credentials.password,
        user.hashed_password,
    )
    if not password_matches:
        updated_hash = user_manager.password_helper.hash(credentials.password)

    if updated_hash is not None:
        await user_manager.user_db.update(
            user,
            {"hashed_password": updated_hash},
        )

    return {"action": "login" if password_matches else "password_reset"}


@app.get("/", tags=["Root"])
def read_root(user: User = Depends(current_active_user)) -> dict[str, str]:
    return {
        "message": "Point Cloud Platform API is running",
        "user": user.email,
    }


@app.get("/openapi.json", include_in_schema=False)
def protected_openapi(_: User = Depends(current_active_user)) -> JSONResponse:
    return JSONResponse(app.openapi())


@app.get("/docs", include_in_schema=False)
def protected_docs(_: User = Depends(current_active_user)) -> HTMLResponse:
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title=f"{app.title} - Swagger UI",
    )
