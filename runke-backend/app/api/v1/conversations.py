import uuid

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import Pagination, get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.bot import (
    CompletionRequest,
    ConversationOut,
    MessageCreate,
    MessageOut,
)
from app.schemas.common import Envelope, Meta
from app.services import bot_service, completion_service

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("/{conv_id}", summary="会话详情")
async def get_conversation(
    conv_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[ConversationOut]:
    conv = await bot_service.get_conversation(session, conv_id, current.id)
    return Envelope(data=ConversationOut.model_validate(conv))


@router.get("/{conv_id}/messages", summary="会话消息列表（时间正序）")
async def list_messages(
    conv_id: uuid.UUID,
    page: Pagination = Depends(),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[MessageOut]]:
    rows, total = await bot_service.list_messages(
        session, conv_id, current.id, page.offset, page.limit
    )
    return Envelope(
        data=[MessageOut.model_validate(m) for m in rows],
        meta=Meta(page=page.page, page_size=page.page_size, total=total),
    )


@router.post(
    "/{conv_id}/messages",
    status_code=status.HTTP_201_CREATED,
    summary="向会话追加消息（P2 接入 completion 流式生成）",
)
async def create_message(
    conv_id: uuid.UUID,
    body: MessageCreate,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[MessageOut]:
    msg = await bot_service.create_message(session, conv_id, current.id, body)
    return Envelope(data=MessageOut.model_validate(msg))


@router.post(
    "/{conv_id}/completions",
    summary="生成回复（单 Agent，SSE 流式）",
    response_class=StreamingResponse,
)
async def create_completion(
    conv_id: uuid.UUID,
    body: CompletionRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # 先做前置校验（所有权 / key），保证错误能以正常 HTTP 状态返回
    await bot_service.get_conversation(session, conv_id, current.id)
    completion_service.ensure_llm_ready()

    generator = completion_service.sse_stream(conv_id, current.id, body.content, body.model)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/{conv_id}/preview",
    summary="预演 completion（只读·不持久化，供语音投机生成）",
    response_class=StreamingResponse,
)
async def preview_completion(
    conv_id: uuid.UUID,
    body: CompletionRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    await bot_service.get_conversation(session, conv_id, current.id)
    completion_service.ensure_llm_ready()
    generator = completion_service.preview_stream(conv_id, current.id, body.content)
    return StreamingResponse(
        generator, media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class CommitRequest(BaseModel):
    user: str = ""
    reply: str = ""
    variables: dict = {}


@router.post("/{conv_id}/commit", summary="提交预演结果：落库一轮(用户/回复/变量)，不跑模型")
async def commit_turn(
    conv_id: uuid.UUID,
    body: CommitRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[dict]:
    await bot_service.get_conversation(session, conv_id, current.id)
    res = await completion_service.commit_turn(conv_id, current.id, body.user, body.reply, body.variables)
    return Envelope(data=res)


@router.post("/{conv_id}/finalize", summary="结束对话：触发一次性结束逻辑（如纪要回写）")
async def finalize_conversation(
    conv_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[dict]:
    await bot_service.get_conversation(session, conv_id, current.id)
    completion_service.ensure_llm_ready()
    res = await completion_service.finalize_workflow(conv_id, current.id)
    return Envelope(data=res)
