from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy import func, select, update

from app.auth.database import User, auth_session_maker
from app.auth.users import UserManager, current_active_user, get_redis_strategy
from app.database import SessionLocal
from app.models.notification import Notification
from app.schemas.notification import NotificationList, NotificationRead
from app.services.notifications import notification_hub


router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


@router.get("", response_model=NotificationList)
def list_notifications(
    limit: int = 30,
    user: User = Depends(current_active_user),
) -> NotificationList:
    safe_limit = max(1, min(limit, 100))
    user_id = str(user.id)
    with SessionLocal() as session:
        items = list(
            session.scalars(
                select(Notification)
                .where(Notification.user_id == user_id)
                .order_by(Notification.created_at.desc())
                .limit(safe_limit),
            ),
        )
        count = int(
            session.scalar(
                select(func.count())
                .select_from(Notification)
                .where(Notification.user_id == user_id, Notification.is_read.is_(False)),
            )
            or 0
        )
        return NotificationList(
            items=[NotificationRead.model_validate(item) for item in items],
            unread_count=count,
        )


@router.post("/read-all", status_code=204)
def read_all_notifications(user: User = Depends(current_active_user)) -> None:
    with SessionLocal() as session:
        session.execute(
            update(Notification)
            .where(Notification.user_id == str(user.id), Notification.is_read.is_(False))
            .values(is_read=True),
        )
        session.commit()


@router.post("/{notification_id}/read", response_model=NotificationRead)
def read_notification(
    notification_id: str,
    user: User = Depends(current_active_user),
) -> Notification:
    with SessionLocal() as session:
        notification = session.get(Notification, notification_id)
        if notification is None or notification.user_id != str(user.id):
            raise HTTPException(status_code=404, detail="通知不存在")
        notification.is_read = True
        session.commit()
        session.refresh(notification)
        session.expunge(notification)
        return notification


@router.websocket("/ws")
async def notifications_websocket(websocket: WebSocket) -> None:
    token = websocket.cookies.get("pointcloud_session")
    async with auth_session_maker() as session:
        user_database = SQLAlchemyUserDatabase(session, User)
        user = await get_redis_strategy().read_token(token, UserManager(user_database))
    if user is None or not user.is_active:
        await websocket.close(code=4401, reason="Unauthorized")
        return

    user_id = str(user.id)
    await notification_hub.connect(user_id, websocket)
    try:
        await websocket.send_json({"type": "connected"})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        notification_hub.disconnect(user_id, websocket)
