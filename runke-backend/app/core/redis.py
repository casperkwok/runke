"""Redis 异步客户端（缓存 / 会话 / 限流）。"""
from redis.asyncio import Redis

from app.core.config import settings

redis_client: Redis = Redis.from_url(settings.redis_url, decode_responses=True)


async def get_redis() -> Redis:
    return redis_client
