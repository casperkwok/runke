"""公开（免登录）网站小部件接口：仅对「已发布且开启网站集成」的 Bot 开放。

安全模型：按 bot_id 公钥访问，要求 bot.published 且 bot.widget_enabled；
对话以 bot.owner 身份创建并生成（复用既有 completion 链路）。
"""
import uuid

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.bot import Bot, Conversation
from app.schemas.common import Envelope
from app.schemas.public import PublicBotOut, PublicChatRequest
from app.services import completion_service

router = APIRouter(prefix="/public", tags=["public"])


async def _published_bot(session: AsyncSession, bot_id: uuid.UUID) -> Bot:
    bot = await session.get(Bot, bot_id)
    if bot is None or not bot.published or not bot.widget_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="小部件不可用或未发布")
    return bot


@router.get("/bots/{bot_id}", summary="公开 Bot 信息（网站小部件）")
async def public_bot(bot_id: uuid.UUID) -> Envelope[PublicBotOut]:
    async with SessionLocal() as session:
        bot = await _published_bot(session, bot_id)
        return Envelope(
            data=PublicBotOut(
                id=bot.id,
                name=bot.name,
                avatar=bot.avatar or "",
                welcome=bot.welcome or "",
                examples=list(bot.examples or []),
                widget_config=dict(bot.widget_config or {}),
            )
        )


@router.post("/bots/{bot_id}/chat", summary="公开对话（SSE 流式）")
async def public_chat(bot_id: uuid.UUID, body: PublicChatRequest) -> StreamingResponse:
    completion_service.ensure_llm_ready()
    async with SessionLocal() as session:
        bot = await _published_bot(session, bot_id)
        owner_id = bot.owner_id
        conv_id = body.conversation_id
        if conv_id is not None:
            conv = await session.get(Conversation, conv_id)
            if conv is None or conv.bot_id != bot.id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
        else:
            conv = Conversation(bot_id=bot.id, title="网站访客会话", channel="web")
            session.add(conv)
            await session.commit()
            await session.refresh(conv)
            conv_id = conv.id

    async def gen():
        # 首条事件回传 conversation_id，便于前端后续轮次复用
        yield f'data: {{"type":"conversation","id":"{conv_id}"}}\n\n'
        async for chunk in completion_service.sse_stream(conv_id, owner_id, body.content):
            yield chunk

    return StreamingResponse(gen(), media_type="text/event-stream")
