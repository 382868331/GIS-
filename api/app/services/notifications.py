from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict

from fastapi import WebSocket
from sqlalchemy import func, select

from app.database import SessionLocal
from app.models.notification import Notification
from app.schemas.notification import NotificationRead


class NotificationHub:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_running_loop(self) -> None:
        self._loop = asyncio.get_running_loop()

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        connections = self._connections.get(user_id)
        if connections is None:
            return
        connections.discard(websocket)
        if not connections:
            self._connections.pop(user_id, None)

    async def broadcast(self, user_id: str, notification: NotificationRead) -> None:
        payload = {
            "type": "notification",
            "notification": notification.model_dump(mode="json"),
        }
        stale: list[WebSocket] = []
        for connection in tuple(self._connections.get(user_id, ())):
            try:
                await connection.send_json(payload)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self.disconnect(user_id, connection)

    def broadcast_from_worker(self, user_id: str, notification: NotificationRead) -> None:
        if self._loop is None or self._loop.is_closed():
            return
        self._loop.call_soon_threadsafe(
            lambda: asyncio.create_task(self.broadcast(user_id, notification)),
        )


notification_hub = NotificationHub()


def create_notification(
    *,
    user_id: str,
    event_type: str,
    title: str,
    message: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    payload: dict[str, object] | None = None,
) -> NotificationRead:
    with SessionLocal() as session:
        notification = Notification(
            id=str(uuid.uuid4()),
            user_id=user_id,
            event_type=event_type,
            title=title,
            message=message,
            resource_type=resource_type,
            resource_id=resource_id,
            payload=payload or {},
            is_read=False,
        )
        session.add(notification)
        session.commit()
        session.refresh(notification)
        result = NotificationRead.model_validate(notification)
    notification_hub.broadcast_from_worker(user_id, result)
    return result


def unread_count(user_id: str) -> int:
    with SessionLocal() as session:
        return int(
            session.scalar(
                select(func.count())
                .select_from(Notification)
                .where(Notification.user_id == user_id, Notification.is_read.is_(False)),
            )
            or 0
        )
