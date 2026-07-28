from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.auth.users import current_active_user
from app.database import SessionLocal, redis_client
from app.models.test import TestRecord


router = APIRouter(
    prefix="/api",
    tags=["Demo data"],
    dependencies=[Depends(current_active_user)],
)


class PostgreSQLData(BaseModel):
    id: int
    name: str
    created_at: datetime


class RedisData(BaseModel):
    key: str
    value: str


class DemoDataResponse(BaseModel):
    postgresql: PostgreSQLData
    redis: RedisData


@router.get("/demo-data", response_model=DemoDataResponse)
def read_demo_data() -> DemoDataResponse:
    try:
        with SessionLocal() as session:
            record = session.scalar(
                select(TestRecord).order_by(TestRecord.id.asc()).limit(1)
            )

        redis_value = redis_client.get("demo:test")
    except (SQLAlchemyError, ConnectionError) as error:
        raise HTTPException(
            status_code=503,
            detail="数据库服务暂时不可用",
        ) from error

    if record is None or redis_value is None:
        raise HTTPException(status_code=404, detail="演示数据不存在")

    return DemoDataResponse(
        postgresql=PostgreSQLData(
            id=record.id,
            name=record.name,
            created_at=record.created_at,
        ),
        redis=RedisData(
            key="demo:test",
            value=redis_value,
        ),
    )
