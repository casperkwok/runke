"""技能体系业务：Connector / Skill 的 CRUD，技能测试，以及把绑定技能编译为 agent 工具。"""
import uuid
from typing import Any

import anyio
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.skill import Connector, Skill
from app.schemas.skill import (
    ConnectorCreate,
    ConnectorUpdate,
    SkillCreate,
    SkillTestResult,
    SkillUpdate,
)


# ---------------- Connector ----------------
async def _owned_connector(session: AsyncSession, cid: uuid.UUID, owner_id: uuid.UUID) -> Connector:
    c = await session.get(Connector, cid)
    if c is None or c.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="连接器不存在")
    return c


async def list_connectors(session: AsyncSession, owner_id: uuid.UUID) -> list[Connector]:
    rows = (
        await session.execute(
            select(Connector).where(Connector.owner_id == owner_id).order_by(Connector.created_at.desc())
        )
    ).scalars().all()
    return list(rows)


async def create_connector(session: AsyncSession, owner_id: uuid.UUID, data: ConnectorCreate) -> Connector:
    c = Connector(owner_id=owner_id, **data.model_dump())
    session.add(c)
    await session.commit()
    await session.refresh(c)
    return c


async def update_connector(session: AsyncSession, cid: uuid.UUID, owner_id: uuid.UUID, data: ConnectorUpdate) -> Connector:
    c = await _owned_connector(session, cid, owner_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    await session.commit()
    await session.refresh(c)
    return c


async def delete_connector(session: AsyncSession, cid: uuid.UUID, owner_id: uuid.UUID) -> None:
    c = await _owned_connector(session, cid, owner_id)
    await session.delete(c)
    await session.commit()


# ---------------- Skill ----------------
async def _owned_skill(session: AsyncSession, sid: uuid.UUID, owner_id: uuid.UUID) -> Skill:
    s = await session.get(Skill, sid)
    if s is None or s.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="技能不存在")
    return s


async def list_skills(session: AsyncSession, owner_id: uuid.UUID) -> list[Skill]:
    await ensure_builtin_skills(session, owner_id)
    rows = (
        await session.execute(
            select(Skill).where(Skill.owner_id == owner_id).order_by(Skill.created_at.desc())
        )
    ).scalars().all()
    return list(rows)


async def create_skill(session: AsyncSession, owner_id: uuid.UUID, data: SkillCreate) -> Skill:
    if data.skill_type == "builtin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="内置技能由平台预置，无需创建")
    s = Skill(owner_id=owner_id, **data.model_dump())
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return s


async def get_skill(session: AsyncSession, sid: uuid.UUID, owner_id: uuid.UUID) -> Skill:
    return await _owned_skill(session, sid, owner_id)


async def update_skill(session: AsyncSession, sid: uuid.UUID, owner_id: uuid.UUID, data: SkillUpdate) -> Skill:
    s = await _owned_skill(session, sid, owner_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    await session.commit()
    await session.refresh(s)
    return s


async def delete_skill(session: AsyncSession, sid: uuid.UUID, owner_id: uuid.UUID) -> None:
    s = await _owned_skill(session, sid, owner_id)
    if s.skill_type == "builtin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="内置技能为平台能力，不可删除")
    await session.delete(s)
    await session.commit()


async def test_skill(session: AsyncSession, sid: uuid.UUID, owner_id: uuid.UUID, args: dict[str, Any]) -> SkillTestResult:
    s = await _owned_skill(session, sid, owner_id)
    if s.skill_type != "tool" or not s.connector_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅工具技能可测试，且需关联连接器")
    conn = await session.get(Connector, s.connector_id)
    if conn is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="连接器不存在")
    from app.agents.tools.skill_tool import call_connector

    res = await anyio.to_thread.run_sync(call_connector, conn, args)
    return SkillTestResult(ok=res.get("ok", False), status=res.get("status"), result=res.get("result"), error=res.get("error"))


# ---------------- 编译为 agent 工具 ----------------
# 内置技能动作注册表：key → (展示名, 描述)。平台预置、不可删除，绑定即可调用。
BUILTIN_ACTIONS: dict[str, dict[str, str]] = {
    "register_customer": {"label": "登记客户", "desc": "把核实到的客户信息写回客户管理（按手机号/姓名 upsert）"},
    "web_search": {"label": "联网搜索", "desc": "允许助手实时检索互联网信息"},
    "image_understanding": {"label": "图片理解", "desc": "识别用户上传的图片内容"},
    "long_term_memory": {"label": "长期记忆", "desc": "记住跨会话的关键偏好"},
}


async def ensure_builtin_skills(session: AsyncSession, owner_id: uuid.UUID) -> None:
    """幂等地为 owner 预置全部内置技能（平台能力），缺失才补建。"""
    existing = (
        await session.execute(
            select(Skill.builtin).where(Skill.owner_id == owner_id, Skill.skill_type == "builtin")
        )
    ).scalars().all()
    have = {b for b in existing if b}
    missing = [k for k in BUILTIN_ACTIONS if k not in have]
    if not missing:
        return
    for k in missing:
        meta = BUILTIN_ACTIONS[k]
        session.add(Skill(owner_id=owner_id, skill_type="builtin", builtin=k,
                          name=meta["label"], description=meta["desc"], enabled=True))
    await session.commit()


def _make_builtin_tool(key: str, owner_id: uuid.UUID):
    if key == "register_customer":
        from app.agents.tools.crm_tool import make_crm_register_tool
        return make_crm_register_tool(owner_id, "")
    # web_search / image_understanding / long_term_memory: 模型/会话级能力，暂无独立工具
    return None


async def build_tools_for_skills(
    session: AsyncSession, owner_id: uuid.UUID, skill_ids: list[str]
) -> tuple[list, str]:
    """把绑定的技能编译为 (LangChain 工具列表, SOP 提示词附加文本)。
    - tool 技能 → HTTP 工具
    - sop 技能 → 步骤注入提示词；其 tool_ids 引用的工具也加入工具集
    """
    from app.agents.tools.skill_tool import make_skill_tool

    if not skill_ids:
        return [], ""
    uids: list[uuid.UUID] = []
    for sid in skill_ids:
        try:
            uids.append(uuid.UUID(str(sid)))
        except ValueError:
            continue
    if not uids:
        return [], ""

    skills = (
        await session.execute(
            select(Skill).where(Skill.owner_id == owner_id, Skill.id.in_(uids), Skill.enabled.is_(True))
        )
    ).scalars().all()

    tool_skill_ids: set[uuid.UUID] = set()
    sop_blocks: list[str] = []
    builtin_tools: list = []
    for s in skills:
        if s.skill_type == "builtin":
            t = _make_builtin_tool(getattr(s, "builtin", "") or "", owner_id)
            if t is not None:
                builtin_tools.append(t)
        elif s.skill_type == "bitable":
            from app.agents.tools.bitable_tool import make_bitable_tool
            builtin_tools.append(make_bitable_tool(s))
        elif s.skill_type == "tool":
            tool_skill_ids.add(s.id)
        elif s.skill_type == "sop":
            steps = "\n".join(f"{i + 1}. {st}" for i, st in enumerate(s.steps or []))
            sop_blocks.append(f"【SOP：{s.name}】\n触发条件：{s.trigger}\n执行步骤：\n{steps}")
            for tid in s.tool_ids or []:
                try:
                    tool_skill_ids.add(uuid.UUID(str(tid)))
                except ValueError:
                    continue

    tools: list = list(builtin_tools)
    if tool_skill_ids:
        tool_skills = (
            await session.execute(select(Skill).where(Skill.id.in_(tool_skill_ids), Skill.skill_type == "tool"))
        ).scalars().all()
        for ts in tool_skills:
            conn = await session.get(Connector, ts.connector_id) if ts.connector_id else None
            tools.append(make_skill_tool(ts, conn))

    sop_text = ""
    if sop_blocks:
        sop_text = "\n\n你已掌握以下标准作业流程(SOP)，当用户意图匹配其触发条件时，请严格按步骤执行：\n\n" + "\n\n".join(sop_blocks)
    return tools, sop_text
