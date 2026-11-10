"""Bot / Conversation / Message 业务逻辑（含所有权校验）。"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bot import Bot, Conversation, Message
from app.schemas.bot import BotCreate, BotUpdate, ConversationCreate, MessageCreate


async def _owned_bot(session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID) -> Bot:
    bot = await session.get(Bot, bot_id)
    if bot is None or bot.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="bot 不存在")
    return bot


async def _owned_conversation(
    session: AsyncSession, conv_id: uuid.UUID, owner_id: uuid.UUID
) -> Conversation:
    conv = await session.get(Conversation, conv_id)
    if conv is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
    await _owned_bot(session, conv.bot_id, owner_id)
    return conv


# ---- Bots ----
async def list_bots(
    session: AsyncSession, owner_id: uuid.UUID, offset: int, limit: int
) -> tuple[list[Bot], int]:
    total = await session.scalar(
        select(func.count()).select_from(Bot).where(Bot.owner_id == owner_id)
    )
    rows = (
        await session.execute(
            select(Bot)
            .where(Bot.owner_id == owner_id)
            .order_by(Bot.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    return list(rows), int(total or 0)


async def create_bot(session: AsyncSession, owner_id: uuid.UUID, data: BotCreate) -> Bot:
    bot = Bot(owner_id=owner_id, **data.model_dump())
    session.add(bot)
    await session.commit()
    await session.refresh(bot)
    return bot


async def get_bot(session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID) -> Bot:
    return await _owned_bot(session, bot_id, owner_id)


async def update_bot(
    session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID, data: BotUpdate
) -> Bot:
    bot = await _owned_bot(session, bot_id, owner_id)
    fields = data.model_dump(exclude_unset=True)
    for k, v in fields.items():
        setattr(bot, k, v)
    # 工作流模式：开场白在「开始」节点里配置，保存图时同步到 bot.welcome（下游渠道统一读 welcome）
    if "workflow_definition" in fields and (bot.orchestration_type == "workflow"):
        for n in (bot.workflow_definition or {}).get("nodes", []):
            if n.get("type") == "start":
                bot.welcome = ((n.get("fields") or {}).get("welcome") or "").strip()
                break
    await session.commit()
    await session.refresh(bot)
    return bot


async def delete_bot(session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID) -> None:
    bot = await _owned_bot(session, bot_id, owner_id)
    await session.delete(bot)
    await session.commit()


# ---- Conversations ----
async def list_conversations(
    session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID, offset: int, limit: int
) -> tuple[list[Conversation], int]:
    await _owned_bot(session, bot_id, owner_id)
    total = await session.scalar(
        select(func.count()).select_from(Conversation).where(Conversation.bot_id == bot_id)
    )
    rows = (
        await session.execute(
            select(Conversation)
            .where(Conversation.bot_id == bot_id)
            .order_by(Conversation.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    return list(rows), int(total or 0)


async def create_conversation(
    session: AsyncSession, bot_id: uuid.UUID, owner_id: uuid.UUID, data: ConversationCreate
) -> Conversation:
    bot = await _owned_bot(session, bot_id, owner_id)
    # 归一化初始变量键：无作用域前缀的视为会话变量
    init_vars: dict = {}
    for k, v in (data.variables or {}).items():
        key = k if "." in k else f"session.{k}"
        init_vars[key] = v
    # 关联客户 → 载入 {{customer.*}} 变量（供上下文注入引用，闭环 CRM）
    if data.customer_id is not None:
        from app.models.customer import Customer

        cust = await session.get(Customer, data.customer_id)
        if cust is not None and cust.owner_id == owner_id:
            init_vars.update(
                {
                    "customer.name": cust.name,
                    "customer.company": cust.company,
                    "customer.title": cust.title,
                    "customer.phone": cust.phone,
                    "customer.email": cust.email,
                    "customer.status": cust.status,
                    "customer.intent": cust.intent or "",
                    "customer.stage": cust.stage,
                    "customer.owner": cust.owner,
                    "customer.summary": cust.summary,
                    "customer.tags": "、".join(cust.tags or []),
                }
            )
    channel = data.channel or "debug"
    conv = Conversation(bot_id=bot_id, title=data.title, variables=init_vars, channel=channel)
    session.add(conv)
    await session.flush()
    # 真实渠道：把开场白用会话变量+全局默认值解析好，落库为第一条助手消息（调试预览自带开场白气泡，不落库以免重复）
    welcome = (bot.welcome or "").strip()
    if welcome and channel != "debug":
        from app.services import context_service as ctxs

        store = ctxs.build_var_store(bot.variables, init_vars, channel)
        text = ctxs.substitute(welcome, store).strip()
        if text:
            session.add(Message(conversation_id=conv.id, role="assistant", content=text))
    await session.commit()
    await session.refresh(conv)
    return conv


async def get_conversation(
    session: AsyncSession, conv_id: uuid.UUID, owner_id: uuid.UUID
) -> Conversation:
    return await _owned_conversation(session, conv_id, owner_id)


# ---- Messages ----
async def list_messages(
    session: AsyncSession, conv_id: uuid.UUID, owner_id: uuid.UUID, offset: int, limit: int
) -> tuple[list[Message], int]:
    await _owned_conversation(session, conv_id, owner_id)
    total = await session.scalar(
        select(func.count()).select_from(Message).where(Message.conversation_id == conv_id)
    )
    rows = (
        await session.execute(
            select(Message)
            .where(Message.conversation_id == conv_id)
            .order_by(Message.created_at.asc())
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    return list(rows), int(total or 0)


async def create_message(
    session: AsyncSession, conv_id: uuid.UUID, owner_id: uuid.UUID, data: MessageCreate
) -> Message:
    await _owned_conversation(session, conv_id, owner_id)
    msg = Message(conversation_id=conv_id, role=data.role, content=data.content)
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    return msg
