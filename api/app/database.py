from redis import Redis
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import get_settings


settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

redis_client = Redis.from_url(
    settings.redis_url,
    decode_responses=True,
    health_check_interval=30,
)


class Base(DeclarativeBase):
    pass
