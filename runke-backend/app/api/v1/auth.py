from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserOut,
)
from app.schemas.common import Envelope
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=201, summary="注册新账号")
async def register(
    body: RegisterRequest, session: AsyncSession = Depends(get_session)
) -> Envelope[UserOut]:
    user = await auth_service.create_user(session, body.email, body.password, body.name)
    return Envelope(data=UserOut.model_validate(user))


@router.post("/login", summary="登录，换取 token 对")
async def login(
    body: LoginRequest, session: AsyncSession = Depends(get_session)
) -> Envelope[TokenPair]:
    tokens = await auth_service.authenticate(session, body.email, body.password)
    return Envelope(data=tokens)


@router.post("/refresh", summary="用 refresh token 刷新")
async def refresh(
    body: RefreshRequest, session: AsyncSession = Depends(get_session)
) -> Envelope[TokenPair]:
    tokens = await auth_service.refresh(session, body.refresh_token)
    return Envelope(data=tokens)


@router.get("/me", summary="当前登录用户")
async def me(current: User = Depends(get_current_user)) -> Envelope[UserOut]:
    return Envelope(data=UserOut.model_validate(current))
