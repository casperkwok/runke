import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import Pagination, get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.bot import (
    BotCreate,
    BotOut,
    BotUpdate,
    ConversationCreate,
    ConversationOut,
)
from app.schemas.api_token import ApiTokenCreate, ApiTokenCreated, ApiTokenOut
from app.schemas.common import Envelope, Meta
from app.services import bot_service, token_service

router = APIRouter(prefix="/bots", tags=["bots"])


@router.get("", summary="我的 bot 列表")
async def list_bots(
    page: Pagination = Depends(),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[BotOut]]:
    rows, total = await bot_service.list_bots(session, current.id, page.offset, page.limit)
    return Envelope(
        data=[BotOut.model_validate(b) for b in rows],
        meta=Meta(page=page.page, page_size=page.page_size, total=total),
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="创建 bot")
async def create_bot(
    body: BotCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[BotOut]:
    bot = await bot_service.create_bot(session, current.id, body)
    return Envelope(data=BotOut.model_validate(bot))


@router.get("/{bot_id}", summary="bot 详情")
async def get_bot(
    bot_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[BotOut]:
    bot = await bot_service.get_bot(session, bot_id, current.id)
    return Envelope(data=BotOut.model_validate(bot))


@router.patch("/{bot_id}", summary="更新 bot（含 welcome/role 等配置）")
async def update_bot(
    bot_id: uuid.UUID,
    body: BotUpdate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[BotOut]:
    bot = await bot_service.update_bot(session, bot_id, current.id, body)
    return Envelope(data=BotOut.model_validate(bot))


@router.delete("/{bot_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除 bot")
async def delete_bot(
    bot_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await bot_service.delete_bot(session, bot_id, current.id)


# ---- 嵌套：bot 下的会话 ----
@router.get("/{bot_id}/conversations", summary="bot 的会话列表")
async def list_conversations(
    bot_id: uuid.UUID,
    page: Pagination = Depends(),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[ConversationOut]]:
    rows, total = await bot_service.list_conversations(
        session, bot_id, current.id, page.offset, page.limit
    )
    return Envelope(
        data=[ConversationOut.model_validate(c) for c in rows],
        meta=Meta(page=page.page, page_size=page.page_size, total=total),
    )


@router.post(
    "/{bot_id}/conversations",
    status_code=status.HTTP_201_CREATED,
    summary="在 bot 下新建会话",
)
async def create_conversation(
    bot_id: uuid.UUID,
    body: ConversationCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[ConversationOut]:
    conv = await bot_service.create_conversation(session, bot_id, current.id, body)
    return Envelope(data=ConversationOut.model_validate(conv))


# ---- API 令牌（发布渠道）----
@router.get("/{bot_id}/tokens", summary="bot 的 API 令牌列表")
async def list_tokens(
    bot_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[ApiTokenOut]]:
    rows = await token_service.list_tokens(session, bot_id, current.id)
    return Envelope(data=[ApiTokenOut.model_validate(t) for t in rows])


@router.post("/{bot_id}/tokens", status_code=status.HTTP_201_CREATED, summary="签发 API 令牌（明文仅返回一次）")
async def create_token(
    bot_id: uuid.UUID,
    body: ApiTokenCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[ApiTokenCreated]:
    token, key = await token_service.create_token(session, bot_id, current.id, body)
    out = ApiTokenCreated.model_validate({**ApiTokenOut.model_validate(token).model_dump(), "key": key})
    return Envelope(data=out)


@router.delete("/{bot_id}/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT, summary="删除 API 令牌")
async def delete_token(
    bot_id: uuid.UUID,
    token_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await token_service.delete_token(session, token_id, current.id)
