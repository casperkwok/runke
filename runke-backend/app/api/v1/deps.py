"""路由公共依赖：当前用户、分页。"""
import uuid

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.security import JWTError, decode_token
from app.models.user import User

bearer = HTTPBearer(auto_error=True)


async def get_current_user(
    cred: HTTPAuthorizationCredentials = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="无效或过期的凭证"
    )
    try:
        payload = decode_token(cred.credentials)
        if payload.get("type") != "access":
            raise creds_exc
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise creds_exc

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise creds_exc
    return user


class Pagination:
    def __init__(
        self,
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
    ):
        self.page = page
        self.page_size = page_size
        self.offset = (page - 1) * page_size
        self.limit = page_size
