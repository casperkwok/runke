"""语音外呼任务 / 通话记录服务。"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bot import Bot, Conversation, Message
from app.models.customer_pack import CustomerPack
from app.models.voice import Voice
from app.models.voice_call import CallRecord, CallTask
from app.schemas.voice_call import CallTaskCreate, CallTaskUpdate

_INTENT_KEYS = ("interest", "intent", "intention", "意向")


# ---------------- 外呼任务 ----------------
async def _pack_total(db: AsyncSession, owner_id: uuid.UUID, pack_id: uuid.UUID | None) -> int:
    if not pack_id:
        return 0
    from app.services import customer_pack_service as packs

    pack = (await db.execute(
        select(CustomerPack).where(CustomerPack.id == pack_id, CustomerPack.owner_id == owner_id)
    )).scalar_one_or_none()
    if pack is None:
        return 0
    members = await packs.resolve_members(db, pack, owner_id)
    return len(members)


async def _enrich_task(db: AsyncSession, t: CallTask) -> dict:
    d = {c.name: getattr(t, c.name) for c in t.__table__.columns}
    bot = await db.get(Bot, t.bot_id) if t.bot_id else None
    d["bot_name"] = bot.name if bot else ""
    pack = await db.get(CustomerPack, t.pack_id) if t.pack_id else None
    d["pack_name"] = pack.name if pack else ""
    voice = await db.get(Voice, t.voice_id) if t.voice_id else None
    d["voice_name"] = voice.name if voice else ""
    return d


async def list_tasks(db: AsyncSession, owner_id: uuid.UUID) -> list[dict]:
    rows = (await db.execute(
        select(CallTask).where(CallTask.owner_id == owner_id).order_by(CallTask.created_at.desc())
    )).scalars().all()
    return [await _enrich_task(db, t) for t in rows]


async def create_task(db: AsyncSession, owner_id: uuid.UUID, data: CallTaskCreate) -> dict:
    total = await _pack_total(db, owner_id, data.pack_id)
    t = CallTask(owner_id=owner_id, total=total, status="draft", **data.model_dump())
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return await _enrich_task(db, t)


async def update_task(db: AsyncSession, owner_id: uuid.UUID, task_id: uuid.UUID,
                      data: CallTaskUpdate) -> dict | None:
    t = (await db.execute(
        select(CallTask).where(CallTask.id == task_id, CallTask.owner_id == owner_id)
    )).scalar_one_or_none()
    if t is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    pack_changed = "pack_id" in payload and payload["pack_id"] != t.pack_id
    for k, v in payload.items():
        setattr(t, k, v)
    if pack_changed:
        t.total = await _pack_total(db, owner_id, t.pack_id)
    await db.commit()
    await db.refresh(t)
    return await _enrich_task(db, t)


async def delete_task(db: AsyncSession, owner_id: uuid.UUID, task_id: uuid.UUID) -> bool:
    t = (await db.execute(
        select(CallTask).where(CallTask.id == task_id, CallTask.owner_id == owner_id)
    )).scalar_one_or_none()
    if t is None:
        return False
    await db.delete(t)
    await db.commit()
    return True


# ---------------- 通话记录 ----------------
async def _enrich_record(db: AsyncSession, r: CallRecord) -> dict:
    d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
    bot = await db.get(Bot, r.bot_id) if r.bot_id else None
    d["bot_name"] = bot.name if bot else ""
    task = await db.get(CallTask, r.task_id) if r.task_id else None
    d["task_name"] = task.name if task else ""
    return d


async def list_records(db: AsyncSession, owner_id: uuid.UUID,
                       task_id: uuid.UUID | None = None) -> list[dict]:
    q = select(CallRecord).where(CallRecord.owner_id == owner_id)
    if task_id:
        q = q.where(CallRecord.task_id == task_id)
    rows = (await db.execute(q.order_by(CallRecord.created_at.desc()))).scalars().all()
    return [await _enrich_record(db, r) for r in rows]


async def get_record(db: AsyncSession, owner_id: uuid.UUID, rec_id: uuid.UUID) -> dict | None:
    r = (await db.execute(
        select(CallRecord).where(CallRecord.id == rec_id, CallRecord.owner_id == owner_id)
    )).scalar_one_or_none()
    if r is None:
        return None
    d = await _enrich_record(db, r)
    # 转写优先取关联会话的消息，回落到记录快照
    transcript = list(r.transcript or [])
    if r.conversation_id:
        msgs = (await db.execute(
            select(Message).where(Message.conversation_id == r.conversation_id).order_by(Message.created_at)
        )).scalars().all()
        turns = [{"who": "me" if m.role == "user" else "bot", "text": m.content}
                 for m in msgs if m.role in ("user", "assistant") and m.content.strip()]
        if turns:
            transcript = turns
    d["transcript"] = transcript
    return d


async def create_record_from_conversation(
    db: AsyncSession, owner_id: uuid.UUID, conv: Conversation, *,
    variables: dict | None = None, summary: str = "",
) -> CallRecord | None:
    """语音/外呼通话结束时生成通话记录。转写即会话消息，意向取自变量。"""
    variables = variables or {}
    intent = ""
    for k in _INTENT_KEYS:
        for key in (k, f"session.{k}"):
            if variables.get(key):
                intent = str(variables[key])
                break
        if intent:
            break
    contact = ""
    for k in ("cand_name", "name", "customer_name", "session.cand_name"):
        if variables.get(k):
            contact = str(variables[k])
            break
    phone = str(variables.get("phone") or variables.get("session.phone") or "")
    started = conv.created_at or datetime.now(timezone.utc)
    now = datetime.now(timezone.utc)
    try:
        dur = max(0, int((now - started).total_seconds()))
    except Exception:
        dur = 0
    rec = CallRecord(
        owner_id=owner_id, bot_id=conv.bot_id, conversation_id=conv.id,
        phone=phone, contact=contact, direction="preview" if conv.channel == "debug" else "outbound",
        status="completed", duration_sec=dur, summary=summary[:2000], intent=intent,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec
