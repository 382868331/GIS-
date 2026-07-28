import uuid
from collections.abc import AsyncGenerator

from fastapi import Depends
from fastapi_users.db import SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


settings = get_settings()


class AuthBase(DeclarativeBase):
    pass


class User(SQLAlchemyBaseUserTableUUID, AuthBase):
    __tablename__ = "users"


auth_engine = create_async_engine(settings.async_database_url, pool_pre_ping=True)
auth_session_maker = async_sessionmaker(auth_engine, expire_on_commit=False)


async def create_auth_tables() -> None:
    async with auth_engine.begin() as connection:
        await connection.run_sync(AuthBase.metadata.create_all)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with auth_session_maker() as session:
        yield session


async def get_user_db(
    session: AsyncSession = Depends(get_async_session),
) -> AsyncGenerator[SQLAlchemyUserDatabase[User, uuid.UUID], None]:
    yield SQLAlchemyUserDatabase(session, User)
