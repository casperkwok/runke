"""Completion：把会话历史交给 AgentRuntime，流式生成并持久化 assistant 消息。

会话写入用独立 session（不跨越长流式请求生命周期）。
"""
import json
import uuid
from collections.abc import AsyncIterator

from fastapi import HTTPException, status
from sqlalchemy import select

from app.agents.models import build_chat_model
from app.agents.presets import PRESETS, get_preset
from app.agents.runtime import AgentRuntime
from app.core.config import settings
from app.core.db import SessionLocal
from app.models.bot import Bot, Conversation, Message


def _resolve_system_prompt(bot: Bot) -> str:
    prompt = (bot.system_prompt or "").strip()
    if prompt:  # 单 Agent 编辑器里配置的「角色设定」
        return prompt
    key = (getattr(bot, "preset_key", "") or "").strip()
    if key in PRESETS:  # 命中内置预置 key → 用预置 prompt
        return PRESETS[key].system_prompt
    return get_preset(None).system_prompt  # 兜底：通用助手


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


import re as _re

# 旁白/舞台提示关键词：含这些词的括号段视为模型漏出的内心戏，剥掉
_STAGE_KW = _re.compile(
    r"语速|语气|停顿|顿了|微笑|笑[着意容]|点头|沉默|旁白|平稳|温和|轻声|叹气|思考|等待|清了清|深呼吸|放慢|放轻|认真地|热情地|礼貌地"
)
_PAREN = _re.compile(r"[（(][^（）()]{0,60}[）)]")


def _strip_stage_directions(text: str) -> str:
    """剥掉含旁白关键词的括号段 + 折叠多余空行（电话口语风格的兜底清洗）。"""
    cleaned = _PAREN.sub(lambda m: "" if _STAGE_KW.search(m.group(0)) else m.group(0), text or "")
    cleaned = _re.sub(r"\n{2,}", "\n", cleaned)
    return cleaned.strip()


class _BotCtx:
    def __init__(self, bot: Bot, conv: Conversation, turns: list[tuple[str, str]]):
        self.orchestration_type = bot.orchestration_type
        self.workflow_definition = dict(bot.workflow_definition or {})
        self.system_prompt = _resolve_system_prompt(bot)
        self.bot_name = bot.name
        self.capabilities = dict(bot.capabilities or {})
        self.kb_id = str(bot.knowledge_base_id) if bot.knowledge_base_id else None
        self.model = bot.model or None
        self.model_params = dict(bot.model_params or {})
        self.skill_ids = list(bot.skill_ids or [])
        # 全局配置（变量 / 数据钩子 / 上下文注入）
        self.variables = list(bot.variables or [])
        self.data_hooks = list(bot.data_hooks or [])
        self.context_enabled = bool(bot.context_enabled)
        self.context_template = bot.context_template or ""
        self.conv_id = conv.id
        self.conv_variables = dict(conv.variables or {})
        self.human = bool(conv.human)  # 人工接管时 AI 不自动回复
        # 首轮：除刚存入的这条 user 外没有 assistant 历史 → 触发 session_start 钩子
        self.is_first_turn = not any(role == "assistant" for role, _ in turns)
        self.turns = turns


async def _load(conv_id: uuid.UUID, owner_id: uuid.UUID) -> _BotCtx:
    """校验所有权，返回 bot 上下文（编排类型 / workflow 定义 / system / kb / 历史 / 全局配置）。"""
    async with SessionLocal() as session:
        conv = await session.get(Conversation, conv_id)
        if conv is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")
        bot = await session.get(Bot, conv.bot_id)
        if bot is None or bot.owner_id != owner_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="会话不存在")

        rows = (
            await session.execute(
                select(Message)
                .where(Message.conversation_id == conv_id)
                .order_by(Message.created_at.asc())
            )
        ).scalars().all()
        return _BotCtx(bot, conv, [(m.role, m.content) for m in rows])


async def _persist_assistant(conv_id: uuid.UUID, content: str, meta: dict | None = None) -> uuid.UUID:
    async with SessionLocal() as session:
        msg = Message(conversation_id=conv_id, role="assistant", content=content, meta=meta or {})
        session.add(msg)
        await session.commit()
        await session.refresh(msg)
        return msg.id


def ensure_llm_ready() -> None:
    if not settings.deepseek_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="未配置 DEEPSEEK_API_KEY，无法生成回复（见 .env）",
        )


async def _run_agent_bot(bot_id: str, text: str) -> str:
    """工作流 app 节点：把另一个「已编排好的单 Agent」(bot) 作为子步骤运行，返回其输出。"""
    try:
        bid = uuid.UUID(bot_id)
    except ValueError:
        return ""
    async with SessionLocal() as session:
        bot = await session.get(Bot, bid)
        if bot is None:
            return ""
        system = _resolve_system_prompt(bot)
        tools = []
        if bot.knowledge_base_id:
            from app.agents.tools.rag_search import make_rag_search_tool

            tools = [make_rag_search_tool(str(bot.knowledge_base_id))]
        chat_model = build_chat_model(bot.model or None, params=dict(bot.model_params or {}))
        runtime = AgentRuntime(system, model=chat_model, tools=tools)
    parts: list[str] = []
    async for delta in runtime.astream_tokens([("user", text)]):
        parts.append(delta)
    return "".join(parts)


async def _run_skill(skill_id: str, text: str) -> str:
    """工作流 skill 节点：用一个临时 agent 装配该技能并在输入上运行，返回输出。"""
    from app.services.skill_service import build_tools_for_skills

    async with SessionLocal() as session:
        # 技能归属随其 owner；此处用技能自身校验，复用 build_tools_for_skills 需 owner_id
        from app.models.skill import Skill as _Skill

        try:
            sk = await session.get(_Skill, uuid.UUID(skill_id))
        except ValueError:
            return text
        if sk is None:
            return text
        tools, sop_text = await build_tools_for_skills(session, sk.owner_id, [skill_id])
    if not tools and not sop_text:
        return text
    system = "你是一个执行助手，请使用已绑定的技能/工具完成用户请求，并给出最终结果。" + sop_text
    runtime = AgentRuntime(system, tools=tools)
    parts: list[str] = []
    async for delta in runtime.astream_tokens([("user", text)]):
        parts.append(delta)
    return "".join(parts)


async def save_user_message(conv_id: uuid.UUID, content: str) -> None:
    async with SessionLocal() as session:
        session.add(Message(conversation_id=conv_id, role="user", content=content))
        await session.commit()


# 语音投机的意图分类 memo（进程级，按会话）：同一轮内候选文本前缀增长的反复预演直接复用
# 上次的分支判定，省掉每次改押都重跑一遍分类 LLM。commit（本轮落定）即清；15s 过期兜底。
_INTENT_MEMO: dict[uuid.UUID, tuple[float, dict]] = {}


def _intent_memo_for(conv_id: uuid.UUID) -> dict:
    import time as _time

    now = _time.time()
    if len(_INTENT_MEMO) > 256:  # 防泄漏：顺手清掉过期项
        for k in [k for k, (ts, _) in _INTENT_MEMO.items() if now - ts > 15]:
            _INTENT_MEMO.pop(k, None)
    ent = _INTENT_MEMO.get(conv_id)
    memo = ent[1] if ent and now - ent[0] < 15 else {}
    _INTENT_MEMO[conv_id] = (now, memo)
    return memo


async def preview_stream(
    conv_id: uuid.UUID, owner_id: uuid.UUID, content: str
) -> AsyncIterator[str]:
    """预演 completion（只读）：用假设输入跑一遍工作流，流式产出回复 + 末尾给出「该提交的
    用户消息/回复/会话变量」，但【不持久化任何东西、不触发副作用技能】。供语音投机生成用——
    用户还在说话时提前跑，命中后再用 commit_turn 落库，猜错就丢弃，状态不会被污染。"""
    from app.services import context_service as ctxs
    from app.workflows.engine import run_workflow

    ctx = await _load(conv_id, owner_id)
    store = ctxs.build_var_store(ctx.variables, ctx.conv_variables)
    store["history"] = "\n".join(
        ("用户：" if r == "user" else "助手：") + c for r, c in ctx.turns[-12:]
    )
    store["text"] = content

    # ---- 单 Agent 预演：跑模型出回复，不持久化 ----
    if ctx.orchestration_type != "workflow":
        parts: list[str] = []
        try:
            # 数据钩子（填充上下文变量；预演不落库）
            if ctx.is_first_turn:
                await ctxs.run_due_hooks(ctx.data_hooks, owner_id, store, "session_start")
            await ctxs.run_due_hooks(ctx.data_hooks, owner_id, store, "each_turn")
            system_prompt = ctxs.substitute(ctx.system_prompt, store)
            ctx_block = ctxs.render_context(ctx.context_enabled, ctx.context_template, store)
            if ctx_block:
                system_prompt = ctx_block + "\n\n" + system_prompt
            # 语音电话沟通：必须口语化、简短、一次只说一句话/问一个问题，然后停下来等对方回应；
            # 绝不要一口气把整套话术讲完（否则又慢又不像真人通话）。
            system_prompt += (
                "\n\n# 语音通话模式（必须严格遵守）"
                "\n现在是电话语音实时沟通，不是文字。请：1) 口语化、自然；2) 每次只说一两句话、最多问一个问题，"
                "然后停下来等用户回应；3) 绝不一次性把整段话术/多个问题连着说完；4) 不要用任何 Markdown、列表、括号旁白或书面长句。"
            )
            # 语音低延迟：不挂载技能/知识库「工具」（function-calling 会多一轮决策、拖慢首响），
            # 但保留 SOP 文本（话术脚本，仅是提示词，不增加调用回合）。
            tools: list = []
            if ctx.skill_ids:
                from app.services.skill_service import build_tools_for_skills
                async with SessionLocal() as s:
                    _skill_tools, sop_text = await build_tools_for_skills(s, owner_id, ctx.skill_ids)
                if sop_text:
                    system_prompt += sop_text
            # 语音低延迟首选 qwen-flash（实测首 token 最快，~1.7-2s）；缺 key 时回落 deepseek-flash。
            voice_params = {**(ctx.model_params or {}), "max_tokens": 320}
            voice_model = "qwen-flash" if settings.qwen_api_key else "RunkeAI 3.5"
            chat_model = build_chat_model(voice_model, params=voice_params)
            recent = ctx.turns[-8:]
            if not tools:
                # 无工具：直连 LLM 流式（跳过 LangGraph ReAct 图开销，首 token 更快）
                from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
                msgs: list = [SystemMessage(content=system_prompt)]
                for r, c in recent:
                    msgs.append(HumanMessage(content=c) if r == "user" else AIMessage(content=c))
                msgs.append(HumanMessage(content=content))
                async for chunk in chat_model.astream(msgs):
                    delta = chunk.content if isinstance(chunk.content, str) else str(chunk.content)
                    if delta:
                        parts.append(delta)
                        yield _sse({"type": "delta", "content": delta})
            else:
                runtime = AgentRuntime(system_prompt, model=chat_model, tools=tools)
                async for delta in runtime.astream_tokens(
                    [*recent, ("user", content)], steps_out=[], silent_tools={"register_customer"}
                ):
                    parts.append(delta)
                    yield _sse({"type": "delta", "content": delta})
            reply = _strip_stage_directions("".join(parts))
            yield _sse({"type": "done", "reply": reply, "variables": {}})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "message": f"{exc.__class__.__name__}: {exc}"})
        return

    # ---- 工作流预演：跑画布图，不持久化、不触发副作用技能 ----
    # 语音低延迟（同上单 Agent 预演的取舍）：意图分类/口语回复节点覆写为快模型 + 限输出；
    # 终端回复节点 token 级流式透传（队列桥接），首句到就能进 TTS，不再等整图跑完。
    # 文字渠道(sse_stream)与结束回写(finalize_workflow)不受影响，仍用节点自带模型。
    import asyncio

    async def _noop_skill(skill_id: str, args: dict) -> str:
        return "（预演·跳过技能）"

    voice_model = "qwen-flash" if settings.qwen_api_key else None
    _EOS = object()
    memo = _intent_memo_for(conv_id)

    def _spawn(run_memo: dict) -> tuple[asyncio.Queue, asyncio.Task]:
        q: asyncio.Queue = asyncio.Queue()

        async def _run():
            try:
                return await run_workflow(
                    ctx.workflow_definition, content,
                    run_agent=_run_agent_bot, run_skill=_run_skill, invoke_skill=_noop_skill,
                    variables=store, on_delta=q.put_nowait,
                    model_override=voice_model, reply_max_tokens=320,
                    intent_memo=run_memo,
                )
            finally:
                q.put_nowait(_EOS)

        return q, asyncio.create_task(_run())

    # 分支投机：意图分类(~400ms) 与「按默认分支整图执行」并行——短答（"可以/好的"）绝大多数
    # 落默认分支，命中即把分类从关键路径上拿掉；判错就取消重走（成本与串行相同）。
    # 仅单 intent 节点、有「默认」描述分支、且本轮 memo 尚未覆盖时启用。
    classify_task = None
    spec_didx = spec_nid = None
    nodes_ = ctx.workflow_definition.get("nodes", [])
    intent_nodes = [n for n in nodes_ if n.get("type") == "intent"]
    if len(intent_nodes) == 1:
        inode = intent_nodes[0]
        nid = inode["id"]
        branches = (inode.get("fields") or {}).get("branches", [])
        didx = next((i for i, b in enumerate(branches) if "默认" in str(b.get("desc", ""))), None)
        m = memo.get(nid)
        covered = bool(m and content.startswith(m["text"]) and len(content) - len(m["text"]) <= 8)
        if didx is not None and branches and not covered:
            from app.workflows.engine import _classify

            spec_didx, spec_nid = didx, nid
            classify_task = asyncio.create_task(_classify(
                content, branches, (inode.get("fields") or {}).get("model") if not voice_model else voice_model,
                store.get("history", ""),
            ))

            # 分类结果落 memo 不依赖本生成器存活：投机改押会把上一次 preview 整个 cancel，
            # 若分类已经跑完却没记下来，下一次（候选只长了几个字）还要再付一遍分类延迟。
            def _memo_cls(t: asyncio.Task, _nid=nid, _text=content):
                if not t.cancelled() and t.exception() is None:
                    memo[_nid] = {"text": _text, "idx": t.result()}

            classify_task.add_done_callback(_memo_cls)

    if classify_task is not None:
        q, task = _spawn({**memo, spec_nid: {"text": content, "idx": spec_didx}})
    else:
        q, task = _spawn(memo)

    streamed = False
    try:
        if classify_task is not None:
            cidx = await classify_task
            memo[spec_nid] = {"text": content, "idx": cidx}
            if cidx != spec_didx:  # 押错默认分支：丢弃投机（其缓冲 delta 一并作废），按真分支重走
                task.cancel()
                q, task = _spawn(memo)
        while True:
            item = await q.get()
            if item is _EOS:
                break
            streamed = True
            yield _sse({"type": "delta", "content": item})
        output, _trace, wf_vars = await task
        output = _strip_stage_directions(output)
        if not streamed:  # 回复来自 reply/直答等非流式节点 → 整段补发
            yield _sse({"type": "delta", "content": output})
        merged = {**store, **wf_vars}
        merged.pop("history", None)
        merged.pop("text", None)
        yield _sse({"type": "done", "reply": output, "variables": merged})
    except Exception as exc:  # noqa: BLE001
        yield _sse({"type": "error", "message": f"{exc.__class__.__name__}: {exc}"})
    finally:
        if not task.done():
            task.cancel()


async def commit_turn(conv_id: uuid.UUID, owner_id: uuid.UUID, user: str, reply: str, variables: dict) -> dict:
    """把预演算好的一轮落库：存用户消息 + 助手回复 + 覆盖会话变量（不再跑模型/工作流）。"""
    from app.services import context_service as ctxs

    await _load(conv_id, owner_id)  # 所有权校验
    _INTENT_MEMO.pop(conv_id, None)  # 本轮落定，下一轮是新话语，分类 memo 作废
    async with SessionLocal() as s:
        if user:
            s.add(Message(conversation_id=conv_id, role="user", content=user))
        if reply:
            s.add(Message(conversation_id=conv_id, role="assistant", content=reply))
        await s.commit()
    if variables:
        await ctxs.persist_conv_variables(conv_id, dict(variables))
    return {"ok": True}


async def finalize_workflow(conv_id: uuid.UUID, owner_id: uuid.UUID) -> dict:
    """对话结束时调一次：把 session._finalize=true 后跑一遍工作流，触发「结束」专门路径
    （如润客招聘助手的 生成纪要→回写人才库）。回写只在对话整轮结束时发生一次，不在每轮。"""
    from app.services import context_service as ctxs
    from app.workflows.engine import run_workflow

    ctx = await _load(conv_id, owner_id)
    if ctx.orchestration_type != "workflow" or not ctx.workflow_definition.get("nodes"):
        return {"ok": False, "note": "非工作流，无结束回写"}

    store = ctxs.build_var_store(ctx.variables, ctx.conv_variables)
    store["session._finalize"] = "true"
    store["history"] = "\n".join(
        ("用户：" if r == "user" else "助手：") + c for r, c in ctx.turns[-24:]
    )
    store["text"] = "（对话结束）"

    async def _invoke_skill(skill_id: str, args: dict) -> str:
        from app.services.skill_service import build_tools_for_skills

        async with SessionLocal() as s:
            tools, _sop = await build_tools_for_skills(s, owner_id, [skill_id])
        if not tools:
            return "（技能不可用）"
        res = await tools[0].ainvoke(args)
        return res if isinstance(res, str) else str(res)

    output, trace, wf_vars = await run_workflow(
        ctx.workflow_definition, "（对话结束）",
        run_agent=_run_agent_bot, run_skill=_run_skill, invoke_skill=_invoke_skill, variables=store,
    )
    merged = {**store, **wf_vars}
    merged.pop("history", None)
    merged.pop("text", None)
    await ctxs.persist_conv_variables(ctx.conv_id, merged)
    # 取回写节点的结果
    wb = next((s.get("output") for s in trace if s.get("type") == "skill"), "")
    # 语音/外呼通话：结束时生成通话记录（转写=会话消息，意向取自变量）
    try:
        from app.models.bot import Conversation
        from app.services import voice_call_service as vcs

        async with SessionLocal() as s:
            conv = await s.get(Conversation, conv_id)
            if conv is not None and conv.channel in ("voice", "outbound"):
                await vcs.create_record_from_conversation(
                    s, owner_id, conv, variables=merged, summary=str(wb or "")
                )
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "writeback": wb, "node_count": len(trace)}


async def sse_stream(
    conv_id: uuid.UUID, owner_id: uuid.UUID, content: str, model: str | None = None
) -> AsyncIterator[str]:
    """SSE 生成器：先存用户消息，流式产出 delta，最后存 assistant 并发 done。"""
    await save_user_message(conv_id, content)
    ctx = await _load(conv_id, owner_id)
    parts: list[str] = []
    run_meta: dict | None = None

    # 人工接管中：仅保存访客消息，不触发 AI 生成（由人工在聊天管家回复）
    if ctx.human:
        yield _sse({"type": "human", "message": "人工客服处理中…"})
        yield _sse({"type": "done", "message_id": ""})
        return

    try:
        if ctx.orchestration_type == "workflow":
            # 工作流模式：真实执行画布图。app 节点 = 运行一个已编排的单 Agent(另一个 bot)。
            from app.services import context_service as ctxs
            from app.workflows.engine import run_workflow

            if not ctx.workflow_definition.get("nodes"):
                raise ValueError("该智能体为工作流模式，但尚未编排任何节点")
            # 全局配置：组装变量 → 执行数据钩子 → 作为初始变量传入引擎（节点用 {{scope.name}} 引用）
            store = ctxs.build_var_store(ctx.variables, ctx.conv_variables)
            # 对话历史 + 当前输入供工作流 llm 节点引用（{{history}} / {{text}}）
            hist_turns = ctx.turns[:-1] if ctx.turns and ctx.turns[-1][0] == "user" else ctx.turns
            store["history"] = "\n".join(
                ("用户：" if r == "user" else "助手：") + c for r, c in hist_turns[-12:]
            )
            store["text"] = content
            changed = False
            if ctx.is_first_turn:
                changed |= await ctxs.run_due_hooks(ctx.data_hooks, owner_id, store, "session_start")
            changed |= await ctxs.run_due_hooks(ctx.data_hooks, owner_id, store, "each_turn")
            if changed:
                await ctxs.persist_conv_variables(ctx.conv_id, store)
            async def _invoke_skill(skill_id: str, args: dict) -> str:
                from app.services.skill_service import build_tools_for_skills

                async with SessionLocal() as s:
                    tools, _sop = await build_tools_for_skills(s, owner_id, [skill_id])
                if not tools:
                    return "（技能不可用）"
                res = await tools[0].ainvoke(args)
                return res if isinstance(res, str) else str(res)

            output, trace, wf_vars = await run_workflow(
                ctx.workflow_definition,
                content,
                run_agent=_run_agent_bot,
                run_skill=_run_skill,
                invoke_skill=_invoke_skill,
                variables=store,
            )
            # 工作流里 variable 节点写入/递增的标志位回写会话，实现跨轮状态机
            merged = {**store, **wf_vars}
            merged.pop("history", None)
            merged.pop("text", None)
            await ctxs.persist_conv_variables(ctx.conv_id, merged)
            # 工作流运行过程：逐节点输入/输出，供前端「预览和调试」展示
            steps = [
                {
                    "node": s.get("node"),
                    "type": s.get("type"),
                    "title": s.get("title") or "",
                    "status": s.get("status") or "ok",
                    "elapsed_ms": s.get("elapsed_ms"),
                    "input": (s.get("input") or "")[:2000],
                    "output": (s.get("output") or "")[:2000],
                    "note": s.get("note") or "",
                    "branch_label": s.get("branch_label"),
                    "detail": s.get("detail") or {},
                    "inputs": s.get("inputs") or {},
                    "outputs": s.get("outputs") or {},
                    "vars": s.get("vars") or {},
                    "error": s.get("error"),
                    "ok": s.get("status", "ok") == "ok",
                }
                for s in trace
            ]
            total_ms = sum(int(s.get("elapsed_ms") or 0) for s in steps)
            summary = {"total_ms": total_ms, "node_count": len(steps), "ok": all(s["ok"] for s in steps)}
            run_meta = {"trace": steps, "summary": summary, "input": content}
            yield _sse({"type": "trace", "input": content, "steps": steps, "summary": summary})
            output = _strip_stage_directions(output)
            parts.append(output)
            yield _sse({"type": "delta", "content": output})
        else:
            # 单 Agent 模式：model + harness（+可选 rag_search）
            from app.services import context_service as ctxs

            # 全局配置运行时：组装变量存储 → 执行数据钩子 → 渲染上下文注入
            store = ctxs.build_var_store(ctx.variables, ctx.conv_variables)
            changed = False
            if ctx.is_first_turn:
                changed |= await ctxs.run_due_hooks(
                    ctx.data_hooks, owner_id, store, "session_start"
                )
            changed |= await ctxs.run_due_hooks(ctx.data_hooks, owner_id, store, "each_turn")
            if changed:
                await ctxs.persist_conv_variables(ctx.conv_id, store)

            # 角色设定中也可引用变量；上下文注入块拼到 system 前
            system_prompt = ctxs.substitute(ctx.system_prompt, store)
            ctx_block = ctxs.render_context(ctx.context_enabled, ctx.context_template, store)
            if ctx_block:
                system_prompt = ctx_block + "\n\n" + system_prompt
            tools = []
            if ctx.kb_id:
                from app.agents.tools.rag_search import make_rag_search_tool

                tools = [make_rag_search_tool(ctx.kb_id)]
                system_prompt += (
                    "\n\n# 知识库与忠实度（必须严格遵守）"
                    "\n你挂载了一个专属知识库，并拥有 rag_search 工具。涉及具体规定、专业资料、产品/业务细节或任何可能记录在知识库中的事实时，必须先调用 rag_search 检索。"
                    "\n【只依据检索结果作答】只能依据本次 rag_search 检索到的内容回答，可逐条追溯到来源；与你常识冲突时以知识库为准。"
                    "\n【严禁编造】检索结果为空或不足以回答时，绝对不要用通用知识猜测、编造、脑补任何具体事实（数字、政策、流程、价格、条款等），"
                    "宁可如实告知：「没查到相关资料，已尽力」，并建议换种问法或转人工，也不要给出不确定的答案。"
                    "\n【不要空转】同一个问题不要反复检索：检索一次没有结果就按上面如实回应，不要换着说法一直调用工具。"
                )
            if ctx.skill_ids:
                from app.services.skill_service import build_tools_for_skills

                async with SessionLocal() as s:
                    skill_tools, sop_text = await build_tools_for_skills(s, owner_id, ctx.skill_ids)
                tools += skill_tools
                if skill_tools:
                    system_prompt += "\n\n你已绑定若干技能工具，当用户的需求可以通过这些工具完成时，请主动调用对应工具。"
                if sop_text:
                    system_prompt += sop_text
            chat_model = build_chat_model(
                model or ctx.model, params=ctx.model_params
            )
            runtime = AgentRuntime(system_prompt, model=chat_model, tools=tools)
            tool_steps: list = []
            try:
                async for delta in runtime.astream_tokens(ctx.turns, steps_out=tool_steps, silent_tools={"register_customer"}):
                    parts.append(delta)
                    yield _sse({"type": "delta", "content": delta})
            except Exception as loop_exc:  # noqa: BLE001
                # 撞循环上限/工具反复空转等：优雅兜底，绝不报错也绝不编造
                if "recursion" in str(loop_exc).lower() or loop_exc.__class__.__name__ == "GraphRecursionError":
                    fallback = "" if "".join(parts).strip() else "没查到相关资料，已尽力。建议换种问法，或联系人工进一步处理。"
                    if fallback:
                        parts.append(fallback)
                        yield _sse({"type": "delta", "content": fallback})
                else:
                    raise
            # 单 Agent 运行过程：注入后的系统提示词 / 变量 / 可用工具 / 工具调用
            agent_trace = {
                "system_prompt": system_prompt[:4000],
                "variables": {k: v for k, v in store.items() if k not in ("history", "text") and not k.startswith("sys.")},
                "tools": [getattr(t, "name", "") for t in tools],
                "tool_steps": tool_steps,
                "model": (model or ctx.model or ""),
            }
            run_meta = {"agent_trace": agent_trace}
            yield _sse({"type": "agent_trace", **agent_trace})
    except Exception as exc:  # noqa: BLE001
        yield _sse({"type": "error", "message": f"{exc.__class__.__name__}: {exc}"})
        return

    msg_id = await _persist_assistant(conv_id, "".join(parts), meta=run_meta)
    yield _sse({"type": "done", "message_id": str(msg_id)})
