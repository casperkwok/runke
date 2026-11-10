"""健康检查：存活 + 依赖（Postgres / Redis）探活。"""
from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.redis import get_redis
from app.schemas.common import Envelope

router = APIRouter(tags=["health"])


@router.get("/health", summary="存活检查")
async def health() -> Envelope[dict]:
    return Envelope(data={"status": "ok", "app": settings.app_name, "env": settings.env})


@router.get("/health/ready", summary="就绪检查（含依赖探活）")
async def readiness(
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> Envelope[dict]:
    checks: dict[str, str] = {}
    try:
        await session.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["postgres"] = f"error: {exc.__class__.__name__}"
    try:
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["redis"] = f"error: {exc.__class__.__name__}"

    status = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    return Envelope(data={"status": status, "checks": checks})
