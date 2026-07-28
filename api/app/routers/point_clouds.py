from __future__ import annotations

import json
import math
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app.auth.database import User
from app.auth.users import current_active_user
from app.config import Settings, get_settings
from app.database import SessionLocal
from app.models.point_cloud import PointCloud, PointCloudEditDocument, UploadSession
from app.schemas.point_cloud import (
    ChunkUploadResult,
    EditDocumentRead,
    EditDocumentWrite,
    PointCloudList,
    PointCloudPreview,
    PointCloudRead,
    PointCloudUpdate,
    UploadCreate,
    UploadSessionRead,
)
from app.services.las_service import LasMetadata, LasValidationError, build_preview, validate_and_extract
from app.services.object_storage import (
    ObjectNotFoundError,
    ObjectStorage,
    ObjectStorageError,
    get_object_storage,
)
from app.services.notifications import create_notification
from app.services.upload_service import (
    UploadError,
    assemble_chunks,
    expected_chunk_size,
    new_upload_id,
    remove_upload_parts,
    save_chunk,
    total_chunks,
    upload_lock,
    uploaded_bytes,
    validate_upload_request,
)


router = APIRouter(
    prefix="/api/point-clouds",
    tags=["Point clouds"],
    dependencies=[Depends(current_active_user)],
)


def _user_id(user: User) -> str:
    return str(user.id)


def _session_read(upload: UploadSession) -> UploadSessionRead:
    return UploadSessionRead(
        id=upload.id,
        file_name=upload.original_name,
        size_bytes=upload.size_bytes,
        chunk_size=upload.chunk_size,
        total_chunks=upload.total_chunks,
        uploaded_chunks=sorted(upload.uploaded_chunks),
        status=upload.status,
        expires_at=upload.expires_at,
    )


def _get_upload(upload_id: str, user: User) -> UploadSession:
    with SessionLocal() as session:
        upload = session.get(UploadSession, upload_id)
        if upload is None or upload.user_id != _user_id(user):
            raise HTTPException(status_code=404, detail="上传会话不存在")
        session.expunge(upload)
        return upload


def _get_point_cloud(record_id: str, user: User) -> PointCloud:
    with SessionLocal() as session:
        record = session.get(PointCloud, record_id)
        if record is None or record.user_id != _user_id(user):
            raise HTTPException(status_code=404, detail="点云记录不存在")
        session.expunge(record)
        return record


def _new_point_cloud_record(
    *,
    record_id: str,
    user_id: str,
    original_name: str,
    storage_key: str,
    metadata: LasMetadata,
) -> PointCloud:
    return PointCloud(
        id=record_id,
        user_id=user_id,
        original_name=original_name,
        storage_key=storage_key,
        size_bytes=metadata.size_bytes,
        sha256=metadata.sha256,
        las_version=metadata.las_version,
        point_format=metadata.point_format,
        point_count=metadata.point_count,
        has_rgb=metadata.has_rgb,
        has_intensity=metadata.has_intensity,
        min_x=metadata.mins[0],
        max_x=metadata.maxs[0],
        min_y=metadata.mins[1],
        max_y=metadata.maxs[1],
        min_z=metadata.mins[2],
        max_z=metadata.maxs[2],
        scale_x=metadata.scales[0],
        scale_y=metadata.scales[1],
        scale_z=metadata.scales[2],
        offset_x=metadata.offsets[0],
        offset_y=metadata.offsets[1],
        offset_z=metadata.offsets[2],
        crs_wkt=metadata.crs_wkt,
        crs_epsg=metadata.crs_epsg,
        classification_stats=metadata.classification_stats,
        return_stats=metadata.return_stats,
        gps_time_min=metadata.gps_time_min,
        gps_time_max=metadata.gps_time_max,
        generating_software=metadata.generating_software,
        system_identifier=metadata.system_identifier,
        vlr_summary=metadata.vlr_summary,
        evlr_summary=metadata.evlr_summary,
        status="READY",
    )


@router.get("/config")
def read_upload_config(settings: Settings = Depends(get_settings)) -> dict[str, int]:
    return {
        "max_file_size_bytes": settings.max_upload_size_bytes,
        "chunk_size_bytes": settings.upload_chunk_size_bytes,
        "max_preview_points": settings.max_preview_points,
    }


@router.post("/bootstrap", response_model=PointCloudRead)
def bootstrap_point_cloud(
    user: User = Depends(current_active_user),
    settings: Settings = Depends(get_settings),
    object_storage: ObjectStorage = Depends(get_object_storage),
) -> PointCloud:
    user_id = _user_id(user)
    with SessionLocal() as session:
        existing = session.scalar(
            select(PointCloud)
            .where(PointCloud.user_id == user_id)
            .order_by(PointCloud.created_at.asc())
            .limit(1),
        )
        if existing is not None:
            session.expunge(existing)
            return existing

    sample = settings.bundled_sample_path.resolve()
    if not sample.exists():
        raise HTTPException(status_code=503, detail="部署内置示例 LAS 不存在")
    metadata = validate_and_extract(sample, sample.name, settings.max_upload_size_bytes)
    record_id = str(uuid.uuid4())
    storage_key = f"users/{user_id}/{record_id}.las"
    object_storage.put_file(storage_key, sample, metadata.sha256)
    record = _new_point_cloud_record(
        record_id=record_id,
        user_id=user_id,
        original_name=sample.name,
        storage_key=storage_key,
        metadata=metadata,
    )
    try:
        with SessionLocal() as session:
            session.add(record)
            session.commit()
            session.refresh(record)
            session.expunge(record)
    except SQLAlchemyError as error:
        object_storage.remove(storage_key)
        raise HTTPException(status_code=503, detail="初始化示例记录失败") from error
    create_notification(
        user_id=user_id,
        event_type="SAMPLE_INITIALIZED",
        title="示例点云已就绪",
        message=f"已为工作区加载部署内置的“{sample.name}”。",
        resource_type="point_cloud",
        resource_id=record.id,
        payload={"file_name": sample.name},
    )
    return record


@router.post("/uploads", response_model=UploadSessionRead, status_code=status.HTTP_201_CREATED)
def create_upload(
    payload: UploadCreate,
    user: User = Depends(current_active_user),
    settings: Settings = Depends(get_settings),
) -> UploadSessionRead:
    try:
        safe_name = validate_upload_request(
            payload.file_name,
            payload.size_bytes,
            settings.max_upload_size_bytes,
        )
    except UploadError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    with SessionLocal() as session:
        existing = session.scalar(
            select(UploadSession)
            .where(
                UploadSession.user_id == _user_id(user),
                UploadSession.original_name == safe_name,
                UploadSession.size_bytes == payload.size_bytes,
                UploadSession.status == "UPLOADING",
                UploadSession.expires_at > datetime.now(UTC),
            )
            .order_by(UploadSession.created_at.desc())
            .limit(1),
        )
        if existing is not None:
            create_notification(
                user_id=_user_id(user),
                event_type="UPLOAD_RESUMED",
                title="继续上传",
                message=f"已恢复“{existing.original_name}”的断点上传。",
                resource_type="upload",
                resource_id=existing.id,
                payload={"file_name": existing.original_name},
            )
            return _session_read(existing)

        upload = UploadSession(
            id=new_upload_id(),
            user_id=_user_id(user),
            original_name=safe_name,
            size_bytes=payload.size_bytes,
            expected_sha256=payload.sha256.lower() if payload.sha256 else None,
            chunk_size=settings.upload_chunk_size_bytes,
            total_chunks=total_chunks(payload.size_bytes, settings.upload_chunk_size_bytes),
            uploaded_chunks=[],
            status="UPLOADING",
            expires_at=datetime.now(UTC) + timedelta(hours=settings.upload_session_hours),
        )
        session.add(upload)
        session.commit()
        session.refresh(upload)
        (settings.upload_temp_dir / upload.id).mkdir(parents=True, exist_ok=True)
        create_notification(
            user_id=_user_id(user),
            event_type="UPLOAD_STARTED",
            title="开始上传",
            message=f"“{upload.original_name}”已创建上传任务。",
            resource_type="upload",
            resource_id=upload.id,
            payload={"file_name": upload.original_name, "size_bytes": upload.size_bytes},
        )
        return _session_read(upload)


@router.get("/uploads/{upload_id}", response_model=UploadSessionRead)
def read_upload(upload_id: str, user: User = Depends(current_active_user)) -> UploadSessionRead:
    return _session_read(_get_upload(upload_id, user))


@router.put("/uploads/{upload_id}/chunks/{chunk_index}", response_model=ChunkUploadResult)
async def upload_chunk(
    upload_id: str,
    chunk_index: int,
    request: Request,
    user: User = Depends(current_active_user),
    settings: Settings = Depends(get_settings),
    x_chunk_sha256: str | None = Header(default=None),
) -> ChunkUploadResult:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            declared_size = int(content_length)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Content-Length 无效") from error
        if declared_size <= 0 or declared_size > settings.upload_chunk_size_bytes:
            raise HTTPException(status_code=413, detail="分片请求体超过允许大小")

    # Read the request body before acquiring the per-upload threading lock.
    # Waiting for an async body while holding this lock can deadlock the event
    # loop when the browser sends multiple chunks concurrently.
    content = await request.body()
    if len(content) > settings.upload_chunk_size_bytes:
        raise HTTPException(status_code=413, detail="分片请求体超过允许大小")

    lock = upload_lock(upload_id)
    with lock:
        with SessionLocal() as session:
            upload = session.get(UploadSession, upload_id)
            if upload is None or upload.user_id != _user_id(user):
                raise HTTPException(status_code=404, detail="上传会话不存在")
            if upload.status != "UPLOADING":
                raise HTTPException(status_code=409, detail="上传会话不处于可上传状态")
            expires_at = upload.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if expires_at <= datetime.now(UTC):
                raise HTTPException(status_code=410, detail="上传会话已过期")

            try:
                expected_size = expected_chunk_size(upload, chunk_index)
            except UploadError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error

            if content_length and declared_size != expected_size:
                raise HTTPException(status_code=422, detail=f"分片大小应为 {expected_size} 字节")
            try:
                save_chunk(upload, settings.upload_temp_dir, chunk_index, content, x_chunk_sha256)
            except UploadError as error:
                raise HTTPException(status_code=422, detail=str(error)) from error

            chunks = sorted(set(upload.uploaded_chunks) | {chunk_index})
            upload.uploaded_chunks = chunks
            session.commit()
            bytes_uploaded = uploaded_bytes(upload)
            return ChunkUploadResult(
                upload_id=upload.id,
                chunk_index=chunk_index,
                uploaded_chunks=chunks,
                uploaded_bytes=bytes_uploaded,
                complete=len(chunks) == upload.total_chunks,
            )


@router.post("/uploads/{upload_id}/complete", response_model=PointCloudRead)
def complete_upload(
    upload_id: str,
    user: User = Depends(current_active_user),
    settings: Settings = Depends(get_settings),
    object_storage: ObjectStorage = Depends(get_object_storage),
) -> PointCloud:
    lock = upload_lock(upload_id)
    with lock:
        with SessionLocal() as session:
            upload = session.get(UploadSession, upload_id)
            if upload is None or upload.user_id != _user_id(user):
                raise HTTPException(status_code=404, detail="上传会话不存在")
            if upload.status not in {"UPLOADING", "FAILED"}:
                raise HTTPException(status_code=409, detail="上传会话已经完成或取消")
            upload.status = "VALIDATING"
            upload.error_message = None
            session.commit()

        uploaded_object_key: str | None = None
        try:
            upload = _get_upload(upload_id, user)
            assembled = assemble_chunks(upload, settings.upload_temp_dir)
            metadata = validate_and_extract(
                assembled,
                upload.original_name,
                settings.max_upload_size_bytes,
            )
            if upload.expected_sha256 and metadata.sha256 != upload.expected_sha256:
                raise UploadError("完整文件 SHA-256 校验失败")

            record_id = str(uuid.uuid4())
            storage_key = f"users/{_user_id(user)}/{record_id}.las"
            object_storage.put_file(storage_key, assembled, metadata.sha256)
            uploaded_object_key = storage_key
            record = _new_point_cloud_record(
                record_id=record_id,
                user_id=_user_id(user),
                original_name=upload.original_name,
                storage_key=storage_key,
                metadata=metadata,
            )
            with SessionLocal() as session:
                session.add(record)
                tracked = session.get(UploadSession, upload_id)
                if tracked:
                    tracked.status = "COMPLETED"
                session.commit()
                session.refresh(record)
                session.expunge(record)
            remove_upload_parts(settings.upload_temp_dir, upload_id)
            create_notification(
                user_id=_user_id(user),
                event_type="UPLOAD_COMPLETED",
                title="上传完成",
                message=f"“{record.original_name}”已保存到 MinIO 并完成元数据解析。",
                resource_type="point_cloud",
                resource_id=record.id,
                payload={"file_name": record.original_name, "point_count": record.point_count},
            )
            return record
        except (UploadError, LasValidationError) as error:
            if uploaded_object_key is not None:
                object_storage.remove(uploaded_object_key)
            with SessionLocal() as session:
                tracked = session.get(UploadSession, upload_id)
                if tracked:
                    tracked.status = "FAILED"
                    tracked.error_message = str(error)
                    session.commit()
            raise HTTPException(status_code=422, detail=str(error)) from error
        except ObjectStorageError as error:
            if uploaded_object_key is not None:
                try:
                    object_storage.remove(uploaded_object_key)
                except ObjectStorageError:
                    pass
            with SessionLocal() as session:
                tracked = session.get(UploadSession, upload_id)
                if tracked:
                    tracked.status = "FAILED"
                    tracked.error_message = str(error)
                    session.commit()
            raise HTTPException(status_code=503, detail="对象存储写入失败，请稍后重试") from error
        except SQLAlchemyError as error:
            if uploaded_object_key is not None:
                try:
                    object_storage.remove(uploaded_object_key)
                except ObjectStorageError:
                    pass
            raise HTTPException(status_code=503, detail="数据库写入失败，文件已清理") from error


@router.delete("/uploads/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_upload(
    upload_id: str,
    user: User = Depends(current_active_user),
    settings: Settings = Depends(get_settings),
) -> Response:
    with upload_lock(upload_id):
        with SessionLocal() as session:
            upload = session.get(UploadSession, upload_id)
            if upload is None or upload.user_id != _user_id(user):
                raise HTTPException(status_code=404, detail="上传会话不存在")
            session.delete(upload)
            session.commit()
        remove_upload_parts(settings.upload_temp_dir, upload_id)
    create_notification(
        user_id=_user_id(user),
        event_type="UPLOAD_CANCELLED",
        title="上传已取消",
        message=f"“{upload.original_name}”的临时分片已清除。",
        resource_type="upload",
        resource_id=upload_id,
        payload={"file_name": upload.original_name},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=PointCloudList)
def list_point_clouds(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    user: User = Depends(current_active_user),
) -> PointCloudList:
    with SessionLocal() as session:
        filters = PointCloud.user_id == _user_id(user)
        total = int(session.scalar(select(func.count()).select_from(PointCloud).where(filters)) or 0)
        items = list(
            session.scalars(
                select(PointCloud)
                .where(filters)
                .order_by(PointCloud.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size),
            ),
        )
        return PointCloudList(
            items=[PointCloudRead.model_validate(item) for item in items],
            page=page,
            page_size=page_size,
            total=total,
            total_pages=math.ceil(total / page_size) if total else 0,
        )


@router.get("/{record_id}", response_model=PointCloudRead)
def read_point_cloud(record_id: str, user: User = Depends(current_active_user)) -> PointCloud:
    return _get_point_cloud(record_id, user)


@router.get("/{record_id}/edits", response_model=EditDocumentRead)
def read_edit_document(
    record_id: str,
    user: User = Depends(current_active_user),
) -> EditDocumentRead:
    _get_point_cloud(record_id, user)
    with SessionLocal() as session:
        document = session.get(PointCloudEditDocument, record_id)
        if document is None:
            document = PointCloudEditDocument(
                point_cloud_id=record_id,
                user_id=_user_id(user),
                revision=0,
                document={"objects": []},
            )
            session.add(document)
            session.commit()
            session.refresh(document)
        return EditDocumentRead(
            point_cloud_id=document.point_cloud_id,
            revision=document.revision,
            document=document.document,
            updated_at=document.updated_at,
        )


@router.put("/{record_id}/edits", response_model=EditDocumentRead)
def save_edit_document(
    record_id: str,
    payload: EditDocumentWrite,
    user: User = Depends(current_active_user),
) -> EditDocumentRead:
    record = _get_point_cloud(record_id, user)
    if len(json.dumps(payload.document, ensure_ascii=False)) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="编辑文档不能超过 2 MiB")
    with SessionLocal() as session:
        document = session.get(PointCloudEditDocument, record_id)
        if document is None:
            if payload.revision != 0:
                raise HTTPException(status_code=409, detail="编辑版本冲突，请重新加载")
            document = PointCloudEditDocument(
                point_cloud_id=record_id,
                user_id=_user_id(user),
                revision=1,
                document=payload.document,
            )
            session.add(document)
        else:
            if document.user_id != _user_id(user):
                raise HTTPException(status_code=404, detail="编辑文档不存在")
            if document.revision != payload.revision:
                raise HTTPException(status_code=409, detail="编辑版本冲突，请重新加载")
            document.revision += 1
            document.document = payload.document
        session.commit()
        session.refresh(document)
        result = EditDocumentRead(
            point_cloud_id=document.point_cloud_id,
            revision=document.revision,
            document=document.document,
            updated_at=document.updated_at,
        )
    create_notification(
        user_id=_user_id(user),
        event_type="EDIT_AUTO_SAVED" if payload.save_mode == "auto" else "EDIT_MANUAL_SAVED",
        title="编辑已自动保存" if payload.save_mode == "auto" else "编辑已手动保存",
        message=f"“{record.original_name}”的编辑图层已保存（版本 {result.revision}）。",
        resource_type="point_cloud",
        resource_id=record_id,
        payload={"revision": result.revision, "save_mode": payload.save_mode},
    )
    return result


@router.patch("/{record_id}", response_model=PointCloudRead)
def update_point_cloud(
    record_id: str,
    payload: PointCloudUpdate,
    user: User = Depends(current_active_user),
) -> PointCloud:
    with SessionLocal() as session:
        record = session.get(PointCloud, record_id)
        if record is None or record.user_id != _user_id(user):
            raise HTTPException(status_code=404, detail="点云记录不存在")
        old_name = record.original_name
        record.original_name = payload.original_name
        session.commit()
        session.refresh(record)
        session.expunge(record)
    create_notification(
        user_id=_user_id(user),
        event_type="POINT_CLOUD_SAVED",
        title="编辑已保存",
        message=f"“{old_name}”已重命名为“{record.original_name}”。",
        resource_type="point_cloud",
        resource_id=record.id,
        payload={"old_name": old_name, "file_name": record.original_name},
    )
    return record


@router.get("/{record_id}/preview", response_model=PointCloudPreview)
def preview_point_cloud(
    record_id: str,
    user: User = Depends(current_active_user),
    settings: Settings = Depends(get_settings),
    object_storage: ObjectStorage = Depends(get_object_storage),
) -> dict[str, object]:
    record = _get_point_cloud(record_id, user)
    try:
        with object_storage.local_copy(record.storage_key) as path:
            return build_preview(path, record.id, settings.max_preview_points)
    except ObjectNotFoundError as error:
        raise HTTPException(status_code=404, detail="数据库记录存在，但对象存储文件已丢失") from error
    except ObjectStorageError as error:
        raise HTTPException(status_code=503, detail="对象存储暂时不可用") from error
    except LasValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/{record_id}/download")
def download_point_cloud(
    record_id: str,
    user: User = Depends(current_active_user),
    object_storage: ObjectStorage = Depends(get_object_storage),
) -> StreamingResponse:
    record = _get_point_cloud(record_id, user)
    try:
        stored = object_storage.stat(record.storage_key)
    except ObjectNotFoundError as error:
        raise HTTPException(status_code=404, detail="数据库记录存在，但对象存储文件已丢失") from error
    except ObjectStorageError as error:
        raise HTTPException(status_code=503, detail="对象存储暂时不可用") from error
    create_notification(
        user_id=_user_id(user),
        event_type="POINT_CLOUD_EXPORTED",
        title="点云已导出",
        message=f"已开始导出 {record.original_name}",
        resource_type="point_cloud",
        resource_id=record.id,
        payload={"file_name": record.original_name, "size_bytes": stored.size},
    )
    encoded_name = quote(record.original_name)
    return StreamingResponse(
        object_storage.iter_object(record.storage_key),
        media_type="application/vnd.las",
        headers={
            "Content-Length": str(stored.size),
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}",
            "ETag": stored.etag,
        },
    )


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_point_cloud(
    record_id: str,
    user: User = Depends(current_active_user),
    object_storage: ObjectStorage = Depends(get_object_storage),
) -> Response:
    deleted_name = ""
    with SessionLocal() as session:
        record = session.get(PointCloud, record_id)
        if record is None or record.user_id != _user_id(user):
            raise HTTPException(status_code=404, detail="点云记录不存在")
        try:
            object_storage.stat(record.storage_key)
            object_storage.remove(record.storage_key)
        except ObjectNotFoundError as error:
            raise HTTPException(status_code=409, detail="对象存储文件已丢失，未删除数据库记录") from error
        except ObjectStorageError as error:
            raise HTTPException(status_code=503, detail="对象存储删除失败，数据库记录未变更") from error
        try:
            edit_document = session.get(PointCloudEditDocument, record_id)
            if edit_document is not None:
                session.delete(edit_document)
            session.delete(record)
            session.commit()
            deleted_name = record.original_name
        except SQLAlchemyError as error:
            raise HTTPException(status_code=503, detail="数据库记录删除失败") from error
    create_notification(
        user_id=_user_id(user),
        event_type="POINT_CLOUD_DELETED",
        title="点云已删除",
        message=f"“{deleted_name}”的数据库记录和 MinIO 对象已删除。",
        resource_type="point_cloud",
        resource_id=record_id,
        payload={"file_name": deleted_name},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
