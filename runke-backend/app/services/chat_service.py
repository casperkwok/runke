"""聊天管家：收件箱列表、人工接管、人工回复。"""
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bot import Conversation, Message
from app.schemas.chat import InboxItem
from app.services import bot_service


async def list_inbox(session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID) -> list[InboxItem]:
    await bot_service._owned_bot(session, bot_id, owner_id)  # 校验归属
    convs = (
        await session.execute(select(Conversation).where(Conversation.bot_id == bot_id))
    ).scalars().all()
    items: list[InboxItem] = []
    for c in convs:
        last = (
            await session.execute(
                select(Message)
                .where(Message.conversation_id == c.id)
                .order_by(Message.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        count = await session.scalar(
            select(func.count()).select_from(Message).where(Message.conversation_id == c.id)
        )
        if last is None and count == 0:
            continue  # 跳过空会话
        vars_ = c.variables or {}
        name = vars_.get("customer.name") or c.title or "访客"
        items.append(
            InboxItem(
                id=c.id,
                name=name,
                channel=c.channel or "",
                human=c.human,
                intent=vars_.get("customer.intent") or None,
                preview=(last.content[:60] if last else ""),
                last_at=last.created_at if last else c.created_at,
                msg_count=int(count or 0),
            )
        )
    items.sort(key=lambda x: x.last_at or x.id, reverse=True)
    return items


async def set_human(
    session: AsyncSession, conv_id: uuid.UUID, owner_id: uuid.UUID, human: bool
) -> Conversation:
    conv = await bot_service.get_conversation(session, conv_id, owner_id)
    conv.human = human
    await session.commit()
    await session.refresh(conv)
    return conv


async def human_reply(
    session: AsyncSession, conv_id: uuid.UUID, owner_id: uuid.UUID, content: str
) -> Message:
    await bot_service.get_conversation(session, conv_id, owner_id)
    # 人工以 assistant 身份回复（访客侧看到的就是“客服”消息）
    msg = Message(conversation_id=conv_id, role="assistant", content=content)
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    return msg
