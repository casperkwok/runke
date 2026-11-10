"""异步 SQLAlchemy 2.0：engine / session / ORM Base。"""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings

# 测试下用 NullPool：避免 asyncpg 连接绑定到已结束的事件循环
_engine_kwargs: dict = {"echo": settings.db_echo}
if settings.env == "test":
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_pre_ping"] = True

engine = create_async_engine(settings.database_url, **_engine_kwargs)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 依赖：每请求一个 session。"""
    async with SessionLocal() as session:
        yield session
