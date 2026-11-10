"""密码哈希 + JWT 签发/校验。"""
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


def _to_bytes(raw: str) -> bytes:
    # bcrypt 仅取前 72 字节，超长直接截断，避免 5.x 抛错
    return raw.encode("utf-8")[:72]


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_to_bytes(raw), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_to_bytes(raw), hashed.encode("utf-8"))
    except ValueError:
        return False


def _create_token(sub: str, ttl: timedelta, token_type: str) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": sub,
        "type": token_type,
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(sub: str) -> str:
    return _create_token(sub, timedelta(minutes=settings.access_token_ttl_minutes), "access")


def create_refresh_token(sub: str) -> str:
    return _create_token(sub, timedelta(days=settings.refresh_token_ttl_days), "refresh")


def decode_token(token: str) -> dict[str, Any]:
    """解码并校验签名/过期；失败抛 JWTError。"""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


__all__ = [
    "hash_password",
    "verify_password",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "JWTError",
]
