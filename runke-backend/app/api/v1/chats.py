import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.db import get_session
from app.models.user import User
from app.schemas.bot import ConversationOut, MessageOut
from app.schemas.chat import HumanReplyRequest, InboxItem, TakeoverRequest
from app.schemas.common import Envelope
from app.services import chat_service

router = APIRouter(prefix="/chats", tags=["chats"])


@router.get("/inbox", summary="聊天管家收件箱（某 bot 的会话）")
async def inbox(
    bot_id: uuid.UUID,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[list[InboxItem]]:
    items = await chat_service.list_inbox(session, bot_id, current.id)
    return Envelope(data=items)


@router.post("/conversations/{conv_id}/takeover", summary="人工接管 / 恢复 AI 托管")
async def takeover(
    conv_id: uuid.UUID,
    body: TakeoverRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[ConversationOut]:
    conv = await chat_service.set_human(session, conv_id, current.id, body.human)
    return Envelope(data=ConversationOut.model_validate(conv))


@router.post("/conversations/{conv_id}/reply", summary="人工回复（以客服身份追加消息）")
async def human_reply(
    conv_id: uuid.UUID,
    body: HumanReplyRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[MessageOut]:
    msg = await chat_service.human_reply(session, conv_id, current.id, body.content)
    return Envelope(data=MessageOut.model_validate(msg))
