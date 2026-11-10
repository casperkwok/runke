"""工作流实验区（对话式编排 Agent + 实验图调试运行）。

与正式工作流完全隔离：只读 bot 的资源清单（变量/技能/知识库），
图数据走 bot.workflow_exp，永不触碰 workflow_definition。
"""
import uuid
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user
from app.core.db import get_session
from app.models.knowledge import KnowledgeBase
from app.models.skill import Skill
from app.models.user import User
from app.schemas.common import Envelope
from app.services import bot_service, completion_service, wf_copilot_service

router = APIRouter(prefix="/bots", tags=["wf-exp"])


class WfAgentRequest(BaseModel):
    # [{role: user|assistant, content}]，最后一条为本轮用户消息
    messages: list[dict[str, Any]] = Field(default_factory=list)
    graph: dict[str, Any] = Field(default_factory=dict)


class WfExpRunRequest(BaseModel):
    input: str = Field(min_length=1)
    graph: dict[str, Any] = Field(default_factory=dict)
    # 跨轮持久化变量（上次响应返回的 variables 原样带回）
    variables: dict[str, Any] = Field(default_factory=dict)
    # 对话历史 [{role, content}]，供 {{history}} 引用
    history: list[dict[str, Any]] = Field(default_factory=list)


class WfExpRunOut(BaseModel):
    output: str
    steps: list[dict[str, Any]]
    summary: dict[str, Any]
    variables: dict[str, Any]


async def _bot_resources(session: AsyncSession, owner_id: uuid.UUID) -> tuple[list[dict], list[dict]]:
    skills = [
        {"id": str(s.id), "name": s.name, "desc": (s.description or "")[:80]}
        for s in (await session.execute(select(Skill).where(Skill.owner_id == owner_id))).scalars()
    ]
    kbs = [
        {"id": str(k.id), "name": k.name}
        for k in (await session.execute(select(KnowledgeBase).where(KnowledgeBase.owner_id == owner_id))).scalars()
    ]
    return skills, kbs


@router.post("/{bot_id}/wf-agent", summary="实验区编排 Agent（SSE：delta/ops/run/done）", response_class=StreamingResponse)
async def wf_agent(
    bot_id: uuid.UUID,
    body: WfAgentRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    bot = await bot_service.get_bot(session, bot_id, current.id)
    completion_service.ensure_llm_ready()
    skills, kbs = await _bot_resources(session, current.id)
    generator = wf_copilot_service.copilot_stream(
        bot_id=bot.id,
        bot_name=bot.name,
        bot_variables=list(bot.variables or []),
        skills=skills,
        kbs=kbs,
        messages=body.messages,
        graph=body.graph,
        official_definition=dict(bot.workflow_definition or {}),
    )
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{bot_id}/wf-exp/run", summary="实验图调试运行一轮（无状态：变量由前端跨轮带回）")
async def wf_exp_run(
    bot_id: uuid.UUID,
    body: WfExpRunRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Envelope[WfExpRunOut]:
    from app.services import context_service as ctxs

    bot = await bot_service.get_bot(session, bot_id, current.id)
    completion_service.ensure_llm_ready()
    graph = wf_copilot_service.ensure_graph(body.graph)
    store = ctxs.build_var_store(list(bot.variables or []), body.variables, channel="实验调试")
    store["history"] = "\n".join(
        ("用户：" if m.get("role") == "user" else "助手：") + str(m.get("content") or "")
        for m in body.history[-12:]
    )
    store["text"] = body.input
    output, steps, summary, merged = await wf_copilot_service.run_exp_turn(graph, body.input, store)
    return Envelope(data=WfExpRunOut(output=output, steps=steps, summary=summary, variables=merged))
