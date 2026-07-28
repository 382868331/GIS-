import uuid
from collections.abc import AsyncGenerator

import redis.asyncio as async_redis
from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    CookieTransport,
    RedisStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.exceptions import InvalidPasswordException
from fastapi_users.schemas import BaseUserCreate

from app.auth.database import User, get_user_db
from app.config import get_settings


settings = get_settings()

auth_redis = async_redis.from_url(settings.redis_url, decode_responses=True)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.auth_secret
    verification_token_secret = settings.auth_secret

    async def validate_password(
        self,
        password: str,
        user: BaseUserCreate | User,
    ) -> None:
        del user
        if len(password) < 8:
            raise InvalidPasswordException(
                reason="密码长度至少为 8 位",
            )

    async def on_after_register(
        self,
        user: User,
        request: Request | None = None,
    ) -> None:
        del request
        print(f"User registered: {user.id}")


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase[User, uuid.UUID] = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)


cookie_transport = CookieTransport(
    cookie_name="pointcloud_session",
    cookie_max_age=60 * 60 * 24,
    cookie_secure=settings.auth_cookie_secure,
    cookie_httponly=True,
    cookie_samesite="lax",
)


def get_redis_strategy() -> RedisStrategy:
    return RedisStrategy(
        auth_redis,
        lifetime_seconds=60 * 60 * 24,
        key_prefix="pointcloud_auth:",
    )


auth_backend = AuthenticationBackend(
    name="cookie-redis",
    transport=cookie_transport,
    get_strategy=get_redis_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](
    get_user_manager,
    [auth_backend],
)

current_active_user = fastapi_users.current_user(active=True)
