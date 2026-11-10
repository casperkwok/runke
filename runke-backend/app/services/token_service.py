"""API 令牌服务：签发（明文仅返回一次）、列举、删除、校验。"""
import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_token import ApiToken
from app.models.bot import Bot
from app.schemas.api_token import ApiTokenCreate


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def _owned_bot(session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID) -> Bot:
    bot = await session.get(Bot, bot_id)
    if bot is None or bot.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="bot 不存在")
    return bot


async def list_tokens(session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID) -> list[ApiToken]:
    await _owned_bot(session, bot_id, owner_id)
    rows = (
        await session.execute(
            select(ApiToken).where(ApiToken.bot_id == bot_id).order_by(ApiToken.created_at.desc())
        )
    ).scalars().all()
    return list(rows)


async def create_token(
    session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID, data: ApiTokenCreate
) -> tuple[ApiToken, str]:
    await _owned_bot(session, bot_id, owner_id)
    key = "rk-" + secrets.token_hex(24)  # rk- + 48 hex
    prefix = key[:11]  # rk- + 8
    token = ApiToken(
        owner_id=owner_id,
        bot_id=bot_id,
        name=data.name or "Runke-Token",
        prefix=prefix,
        key_hash=_hash(key),
        expires_at=data.expires_at,
    )
    session.add(token)
    await session.commit()
    await session.refresh(token)
    return token, key


async def delete_token(session: AsyncSession, token_id: uuid.UUID, owner_id: uuid.UUID) -> None:
    t = await session.get(ApiToken, token_id)
    if t is None or t.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="令牌不存在")
    await session.delete(t)
    await session.commit()


async def verify_token(session: AsyncSession, key: str) -> ApiToken:
    """校验明文 key → 返回有效令牌；无效/过期抛 401。同时更新 last_used。"""
    t = (
        await session.execute(select(ApiToken).where(ApiToken.key_hash == _hash(key)))
    ).scalar_one_or_none()
    if t is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="无效的 API 令牌")
    if t.expires_at is not None and t.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API 令牌已过期")
    t.last_used_at = datetime.now(timezone.utc)
    await session.commit()
    return t
