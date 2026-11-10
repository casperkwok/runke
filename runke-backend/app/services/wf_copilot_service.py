"""工作流实验区 Copilot：对话式生成/修改编排 + AI 自跑调试。

设计要点：
- 模型不输出整图，而是调用 edit_graph 工具下发一批「图操作」(ops)；服务端在内存
  图副本上应用并校验，同时把成功的 ops 以 SSE 事件实时推给前端画布（前端应用
  同一套语义后自动排版，模型完全不管 x/y 坐标）。
- run_preview 工具让模型自己发测试消息、读 trace、自检自修（与文字预演同语义：
  技能节点跳过副作用）。
- 实验区数据存 bot.workflow_exp = {graph, messages}，与正式 workflow_definition
  完全隔离、永不回写。本服务不写任何 Bot 字段。
"""
import asyncio
import json
import uuid
from copy import deepcopy
from typing import Any, AsyncIterator

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from app.agents.models import build_chat_model

# ---------------- 图规范（与前端 wf-nodes.tsx / 引擎 engine.py 对齐） ----------------

VALID_TYPES = {
    "start", "llm", "kb", "variable", "reply", "voice",
    "cond", "intent", "human", "app", "skill", "code", "end",
}

# 与前端 defaultFields 对齐：add_node 时作为底座，模型给的 fields 覆盖其上
DEFAULT_FIELDS: dict[str, dict[str, Any]] = {
    "start": {"input": "用户输入的内容", "welcome": ""},
    "llm": {"input": "上一个节点的输出内容", "model": "RunkeAI 4.0", "output_json": False, "prompt": ""},
    "kb": {"input": "上一个节点的输出内容", "items": []},
    "variable": {"rows": []},
    "reply": {"content": ""},
    "voice": {"content": "", "voiceId": "", "voiceMode": "speak"},
    "intent": {"input": "上一个节点的输出内容", "model": "RunkeAI 4.0", "branches": []},
    "cond": {"branches": []},
    "code": {"input": "上一个节点的输出内容", "inputs": [], "code": ""},
    "human": {"channel": "电子邮件"},
    "skill": {"skillId": ""},
    "app": {"botId": ""},
    "end": {},
}


def ensure_graph(graph: dict | None) -> dict:
    """空图兜底：开始 → 结束。引擎要求必须有 start 节点。"""
    g = deepcopy(graph) if graph else {}
    nodes = g.get("nodes") or []
    if not any(n.get("type") == "start" for n in nodes):
        g = {
            "nodes": [
                {"id": "n_start", "type": "start", "x": 80, "y": 150, "fields": dict(DEFAULT_FIELDS["start"])},
                {"id": "n_end", "type": "end", "x": 560, "y": 170, "fields": {}},
            ],
            "edges": [{"from": "n_start", "to": "n_end"}],
        }
    g.setdefault("nodes", [])
    g.setdefault("edges", [])
    return g


def compact_graph(graph: dict) -> dict:
    """喂给模型的紧凑视图：剔除坐标等画布私有字段。"""
    nodes = []
    for n in graph.get("nodes", []):
        c: dict[str, Any] = {"id": n.get("id"), "type": n.get("type"), "fields": n.get("fields") or {}}
        if n.get("title"):
            c["title"] = n["title"]
        if n.get("desc"):
            c["desc"] = n["desc"]
        nodes.append(c)
    edges = [
        {k: v for k, v in {"from": e.get("from"), "to": e.get("to"), "port": e.get("port")}.items() if v is not None}
        for e in graph.get("edges", [])
    ]
    return {"nodes": nodes, "edges": edges}


# ---------------- 图操作（ops）应用：前端 applyOps 与此处语义一致 ----------------

def apply_ops(graph: dict, ops: list[dict]) -> tuple[list[dict], list[str], list[str]]:
    """在 graph 上就地应用一批操作。返回 (成功应用的 ops, 错误, 警告)。
    出错的 op 跳过不中断；错误/警告文本回给模型自纠（如未命名节点）。"""
    applied: list[dict] = []
    errors: list[str] = []
    warnings: list[str] = []
    nodes: list[dict] = graph["nodes"]
    edges: list[dict] = graph["edges"]

    def find(nid: str | None) -> dict | None:
        return next((n for n in nodes if n.get("id") == nid), None)

    for i, op in enumerate(ops or []):
        kind = op.get("op")
        try:
            if kind == "add_node":
                ntype = op.get("node_type") or op.get("type")
                if ntype not in VALID_TYPES:
                    raise ValueError(f"未知节点类型 {ntype!r}")
                if ntype == "start" and any(n.get("type") == "start" for n in nodes):
                    raise ValueError("已存在开始节点，不能再加")
                if ntype not in ("start", "end") and not (op.get("title") or "").strip():
                    raise ValueError("add_node 必须带业务语义的 title（如「收集联系方式」），请补上 title 重新提交该节点")
                nid = (op.get("id") or "").strip() or f"n_{ntype}_{uuid.uuid4().hex[:6]}"
                if find(nid):
                    raise ValueError(f"节点 id {nid!r} 已存在")
                fields = {**deepcopy(DEFAULT_FIELDS.get(ntype, {})), **(op.get("fields") or {})}
                node: dict[str, Any] = {"id": nid, "type": ntype, "x": 0, "y": 0, "fields": fields}
                if op.get("title"):
                    node["title"] = op["title"]
                if op.get("desc"):
                    node["desc"] = op["desc"]
                nodes.append(node)
                applied.append({**op, "id": nid, "node_type": ntype, "fields": fields})
            elif kind == "update_node":
                node = find(op.get("id"))
                if node is None:
                    raise ValueError(f"节点 {op.get('id')!r} 不存在")
                if op.get("fields"):
                    node["fields"] = {**(node.get("fields") or {}), **op["fields"]}
                if op.get("title") is not None and op.get("title") != "":
                    node["title"] = op["title"]
                if op.get("desc") is not None and op.get("desc") != "":
                    node["desc"] = op["desc"]
                applied.append(op)
            elif kind == "delete_node":
                node = find(op.get("id"))
                if node is None:
                    raise ValueError(f"节点 {op.get('id')!r} 不存在")
                if node.get("type") == "start":
                    raise ValueError("不能删除开始节点")
                nodes.remove(node)
                graph["edges"] = edges = [e for e in edges if e.get("from") != node["id"] and e.get("to") != node["id"]]
                applied.append(op)
            elif kind == "connect":
                src, dst, port = op.get("from"), op.get("to"), op.get("port")
                a, b = find(src), find(dst)
                if a is None or b is None:
                    raise ValueError(f"连线端点不存在：{src!r} → {dst!r}")
                if b.get("type") == "start":
                    raise ValueError("不能连入开始节点")
                if a.get("type") == "end":
                    raise ValueError("结束节点没有出口")
                branchy = a.get("type") in ("cond", "intent")
                if branchy and port is None:
                    raise ValueError(f"{a.get('type')} 节点出边必须带 port（分支序号）")
                if branchy:
                    edges[:] = [e for e in edges if not (e.get("from") == src and e.get("port") == port)]
                    edges.append({"from": src, "to": dst, "port": port})
                else:
                    # 普通节点只有一个出口：新连线替换旧出边
                    edges[:] = [e for e in edges if e.get("from") != src]
                    edges.append({"from": src, "to": dst})
                applied.append(op)
            elif kind == "disconnect":
                src, dst, port = op.get("from"), op.get("to"), op.get("port")
                before = len(edges)
                edges[:] = [
                    e for e in edges
                    if not (e.get("from") == src and e.get("to") == dst and (port is None or e.get("port") == port))
                ]
                if len(edges) == before:
                    raise ValueError(f"连线不存在：{src!r} → {dst!r}")
                applied.append(op)
            else:
                raise ValueError(f"未知操作 {kind!r}")
        except ValueError as exc:
            errors.append(f"ops[{i}] {kind}: {exc}")
    return applied, errors, warnings


# ---------------- 图 lint：用法/结构体检（确定性护栏，不靠提示词自觉） ----------------

def lint_graph(graph: dict) -> list[str]:
    """每次 edit_graph 后运行，结果回灌模型自纠。规则：
    分支连线完整性 / 断头 / 不可达 / reply 滥用 / llm+cond 冒充意图识别。"""
    issues: list[str] = []
    nodes = {n["id"]: n for n in graph.get("nodes", [])}
    out: dict[str, list[dict]] = {}
    for e in graph.get("edges", []):
        out.setdefault(e.get("from"), []).append(e)

    def label(n: dict) -> str:
        return n.get("title") or _node_label(n.get("type"))

    for nid, n in nodes.items():
        t = n.get("type")
        f = n.get("fields") or {}
        if t in ("cond", "intent"):
            bs = f.get("branches") or []
            need = len(bs) + 1 if t == "cond" else len(bs)
            ports = {e.get("port") for e in out.get(nid, []) if e.get("port") is not None}
            missing = []
            for i in range(need):
                if i not in ports:
                    missing.append("默认分支" if (t == "cond" and i >= len(bs)) else (bs[i].get("name") or f"分支{i+1}"))
            if missing:
                issues.append(f"「{label(n)}」({nid}) 有分支未连线：{'、'.join(missing)}（不匹配时流程会断头）")
        if t not in ("end", "human") and not out.get(nid):
            issues.append(f"「{label(n)}」({nid}) 没有出边（断头），请连到下游或 end")
        if t == "reply" and len(str(f.get("content") or "")) > 40:
            issues.append(f"「{label(n)}」({nid}) 是 reply 节点但话术较长，疑似业务回复——应改用 llm 节点生成")
        # 反模式：llm 分类器（只输出关键词）接 cond(来源=大模型) 冒充意图识别
        if t == "llm":
            prompt = str(f.get("prompt") or "")
            if any(k in prompt for k in ("只输出", "仅输出", "只回答", "输出其中一个", "只返回")):
                for e in out.get(nid, []):
                    tgt = nodes.get(e.get("to"))
                    if tgt and tgt.get("type") == "cond" and "大模型" in json.dumps((tgt.get("fields") or {}).get("branches") or [], ensure_ascii=False):
                        issues.append(f"「{label(n)}」+「{label(tgt)}」是 llm分类器+cond 组合——语义意图分流请改用一个 intent 节点（自带 history、更稳更省）")
    # 不可达节点
    start = next((n for n in graph.get("nodes", []) if n.get("type") == "start"), None)
    if start:
        seen: set[str] = set()
        stack = [start["id"]]
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            stack += [e.get("to") for e in out.get(x, [])]
        for nid, n in nodes.items():
            if nid not in seen:
                issues.append(f"「{label(n)}」({nid}) 从开始节点不可达")
    return issues


def _node_label(t: str | None) -> str:
    return {"llm": "大模型", "reply": "直接回答", "cond": "条件分支", "intent": "意图识别", "kb": "知识库",
            "variable": "变量", "voice": "语音播报", "human": "转人工", "skill": "技能", "app": "应用",
            "code": "代码", "start": "开始", "end": "结束"}.get(t or "", t or "?")


# ---------------- 实验预演：跑实验图（与文字预演同语义，技能跳过副作用） ----------------

def _shape_steps(trace: list[dict]) -> list[dict]:
    """与 completion_service.sse_stream 的 trace 整形保持同构，前端 RunSteps 直接可用。"""
    return [
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


def _brief_steps(steps: list[dict]) -> list[dict]:
    """喂给模型的精简 trace：保留路由决策、变量写入、输出摘要、错误。"""
    out = []
    for s in steps:
        b: dict[str, Any] = {"node": s["node"], "type": s["type"]}
        if s.get("title"):
            b["title"] = s["title"]
        if s.get("branch_label"):
            b["branch"] = s["branch_label"]
        if s.get("note"):
            b["note"] = s["note"]
        if s["type"] in ("reply", "llm", "voice", "kb"):
            b["output"] = (s.get("output") or "")[:200]
        if s.get("error"):
            b["error"] = s["error"]
        out.append(b)
    return out


async def run_exp_turn(
    graph: dict,
    content: str,
    store: dict[str, Any],
) -> tuple[str, list[dict], dict, dict[str, Any]]:
    """跑实验图一轮。store 需已含 history/text。返回 (回复, steps, summary, 持久化变量)。"""
    from app.services.completion_service import _run_agent_bot, _run_skill
    from app.workflows.engine import run_workflow

    async def _noop_skill(skill_id: str, args: dict) -> str:
        return "（实验预演·跳过技能副作用）"

    output, trace, wf_vars = await run_workflow(
        graph, content,
        run_agent=_run_agent_bot, run_skill=_run_skill, invoke_skill=_noop_skill,
        variables=store,
    )
    merged = {**store, **{k: (v if isinstance(v, str) else str(v)) for k, v in wf_vars.items()}}
    merged.pop("history", None)
    merged.pop("text", None)
    steps = _shape_steps(trace)
    total_ms = sum(int(s.get("elapsed_ms") or 0) for s in steps)
    summary = {"total_ms": total_ms, "node_count": len(steps), "ok": all(s["ok"] for s in steps)}
    return output, steps, summary, merged


async def run_exp_dialogue_stream(
    graph: dict,
    messages: list[str],
    session_vars: dict[str, Any],
    bot_variables: list[Any],
):
    """run_preview 工具：模拟一段多轮对话（每轮从 start 重入、变量跨轮持久）。
    异步生成器，逐轮产出 ("turn_start", 进度) / ("turn", 结果)，供 SSE 实时直播自测过程。"""
    from app.services import context_service as ctxs

    conv_vars = {(k if "." in k else f"session.{k}"): v for k, v in (session_vars or {}).items()}
    store = ctxs.build_var_store(bot_variables or [], conv_vars, channel="实验调试")
    hist: list[str] = []
    msgs = (messages or [])[:8]
    for i, msg in enumerate(msgs):
        yield "turn_start", {"i": i + 1, "total": len(msgs), "user": msg}
        store["history"] = "\n".join(hist[-12:])
        store["text"] = msg
        try:
            output, steps, summary, store = await run_exp_turn(graph, msg, store)
        except Exception as exc:  # noqa: BLE001 —— 图不完整时让模型看到错误去修
            yield "turn", {"user": msg, "error": f"{type(exc).__name__}: {exc}", "steps": [], "summary": None, "reply": ""}
            return
        hist += [f"用户：{msg}", f"助手：{output}"]
        yield "turn", {
            "user": msg, "reply": output, "steps": steps, "summary": summary,
            "variables": {k: v for k, v in store.items() if not k.startswith("sys.")},
        }


# ---------------- Copilot 工具定义（OpenAI function 格式，DeepSeek 兼容） ----------------

_OP_SCHEMA = {
    "type": "object",
    "properties": {
        "op": {"type": "string", "enum": ["add_node", "update_node", "delete_node", "connect", "disconnect"]},
        "id": {"type": "string", "description": "节点 id（add_node 可省略自动生成；update/delete 必填）"},
        "node_type": {"type": "string", "description": "add_node 必填：节点类型"},
        "title": {"type": "string", "description": "节点的业务语义名称（add_node 必填，否则被拒绝；下游可用 {{标题.字段}} 引用）"},
        "desc": {"type": "string", "description": "节点一句话描述"},
        "fields": {"type": "object", "description": "节点配置字段（见系统提示的节点规范）"},
        "from": {"type": "string", "description": "connect/disconnect：源节点 id"},
        "to": {"type": "string", "description": "connect/disconnect：目标节点 id"},
        "port": {"type": "integer", "description": "cond/intent 出边的分支序号（cond 默认分支= branches 长度）"},
    },
    "required": ["op"],
}

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "edit_graph",
            "description": "对当前实验工作流图应用一批操作（加/改/删节点、连/断线）。一次调用尽量批量完成一个完整改动。",
            "parameters": {
                "type": "object",
                "properties": {"ops": {"type": "array", "items": _OP_SCHEMA}},
                "required": ["ops"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_plan",
            "description": "向用户展示/更新本次任务的计划清单（渲染为待办卡片）。复杂任务（建图+自测+修复）开始前先列 3~6 步；每步开始置 doing、完成置 done 并再次调用更新。简单小改不必使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "步骤描述（业务语言，给用户看）"},
                                "status": {"type": "string", "enum": ["pending", "doing", "done"]},
                            },
                            "required": ["text", "status"],
                        },
                    }
                },
                "required": ["steps"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_variables",
            "description": "管理本智能体「全局配置→变量管理」里的变量定义（定义/更新默认值/删除）。需要跨轮状态标志位、计数器时直接定义，不要让用户手动去加。定义后立即可在 variable 节点和 {{scope.name}} 中使用。注意：变量是智能体级共享配置（正式工作流也可见），删除被正式工作流引用的变量会被拒绝。",
            "parameters": {
                "type": "object",
                "properties": {
                    "ops": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "action": {"type": "string", "enum": ["define", "update", "remove"]},
                                "name": {"type": "string", "description": "变量名（不含 scope 前缀），如 stage"},
                                "scope": {"type": "string", "enum": ["session", "global"], "description": "session=每个会话独立（跨轮状态用这个）；global=智能体级共享"},
                                "label": {"type": "string", "description": "中文显示名（可选）"},
                                "value": {"type": "string", "description": "默认值（可选，会话开始时的初值）"},
                            },
                            "required": ["action", "name"],
                        },
                    }
                },
                "required": ["ops"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_preview",
            "description": "在当前实验图上模拟一段多轮对话做自测：每轮从开始节点重入、变量跨轮持久，返回每轮回复与执行 trace（含分支命中、变量写入）。技能节点跳过真实副作用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "messages": {"type": "array", "items": {"type": "string"}, "description": "依次发送的用户消息（最多 8 条）"},
                    "session_variables": {"type": "object", "description": "可选：模拟创建会话时带入的 session 变量初值，如 {\"candidate_id\": \"2\"}"},
                },
                "required": ["messages"],
            },
        },
    },
]


# ---------------- 变量管理工具：直写 Bot.variables（全局配置→变量管理） ----------------

async def apply_variable_ops(
    bot_id: uuid.UUID,
    variables: list[Any],
    ops: list[dict],
    official_definition_text: str,
) -> tuple[list[Any], list[str], list[str]]:
    """应用变量定义操作并落库。返回 (新变量列表, 操作说明, 错误)。
    删除保护：变量仍被工作流图引用时拒绝删除。"""
    from app.core.db import SessionLocal
    from app.models.bot import Bot

    vars_ = [dict(v) for v in (variables or [])]
    notes: list[str] = []
    errors: list[str] = []
    for i, op in enumerate(ops or []):
        action = op.get("action")
        name = (op.get("name") or "").strip().removeprefix("session.").removeprefix("global.")
        scope = op.get("scope") or "session"
        if not name:
            errors.append(f"ops[{i}]: 缺少变量名")
            continue
        if scope not in ("session", "global"):
            errors.append(f"ops[{i}]: scope 只能是 session/global")
            continue
        hit = next((v for v in vars_ if (v.get("name") or "").strip() == name and (v.get("scope") or "global") == scope), None)
        if action in ("define", "update"):
            if hit is None:
                row: dict[str, Any] = {"name": name, "scope": scope, "type": "字符串", "value": op.get("value") or ""}
                if op.get("label"):
                    row["label"] = op["label"]
                vars_.append(row)
                notes.append(f"已定义 {scope}.{name}")
            else:
                if op.get("label") is not None:
                    hit["label"] = op["label"]
                if op.get("value") is not None:
                    hit["value"] = op["value"]
                notes.append(f"已更新 {scope}.{name}")
        elif action == "remove":
            if hit is None:
                errors.append(f"ops[{i}]: 变量 {scope}.{name} 不存在")
                continue
            if f"{scope}.{name}" in official_definition_text:
                errors.append(f"ops[{i}]: 工作流仍引用着 {scope}.{name}，先移除引用再删除")
                continue
            vars_.remove(hit)
            notes.append(f"已删除 {scope}.{name}")
        else:
            errors.append(f"ops[{i}]: 未知 action {action!r}")
    if notes:  # 有实际变更才落库
        async with SessionLocal() as session:
            bot = await session.get(Bot, bot_id)
            if bot is None:
                return variables, [], ["智能体不存在"]
            bot.variables = vars_
            await session.commit()
    return vars_, notes, errors


# ---------------- 系统提示：节点 DSL 规范（从 engine.py 真实行为写成） ----------------

SYSTEM_SPEC = """你是 Runke 的工作流编排副驾驶（Workflow Copilot）。用户用自然语言描述业务流程，\
你通过 edit_graph 工具直接搭建/修改工作流图，通过 run_preview 工具自测验证。你改的就是该智能体的\
工作流（实时生效、自动保存），run_preview 预演不产生真实副作用；用户每轮改动可一键回滚，放心编排。

# 图结构
graph = {"nodes": [...], "edges": [...]}。节点 = {id, type, title?, desc?, fields}。\
边 = {from, to, port?}。坐标由前端自动排版，你不用管。
- 整图恒有且只有一个 start 节点；流程末端连到 end 节点。
- 普通节点只有一个出口（重复 connect 会替换旧出边）；cond/intent 是多出口，出边必须带 port。
- 引擎每轮对话都【从 start 重新进入】整张图，跑到 end/转人工/无后继为止。跨轮记忆全靠变量。

# 节点类型与 fields
- start：入口。fields.welcome = 开场白（建议设置）。
- llm 大模型：fields.prompt（支持占位符）、model（默认 "RunkeAI 4.0"）、output_json（true 时只输出 JSON）。\
输出 = 模型回复。用途：生成对话回复、提取结构化字段（output_json）。\
【不要用 llm+cond 组合模拟意图识别】——那是 intent 节点的活。
- reply 直接回答：fields.content 固定话术模板（支持占位符）。不调模型、零延迟。\
【仅限真正固定的系统话术】（如转人工提示、合规声明、菜单导航）；任何面向用户的业务对话回复\
【必须用 llm 节点】——硬编码话术无法理解上下文、千篇一律，没有意义。拿不准时选 llm。
- voice 语音播报：fields.content 同 reply，外加 voiceId/voiceMode，仅语音通道有差异。
- kb 知识库：fields.items = [{"id": "<知识库uuid>"}]。把检索结果拼到输入后透传给下游（通常下游接 llm 总结）。
- variable 变量：fields.rows = [{"var": "session.x", "op": "赋值|递增|递减|追加|清空", "value": "...", "step": "1"}]。\
var 必须是「可用变量」里列出的全限定名（session./global.）。这是做跨轮标志位/计数器的唯一手段。
- cond 条件分支：fields.branches = [{"name": "分支名", "match": "所有|任一", "conds": [{"src", "op", "val"}]}]。\
  - src 可取："开始节点的输出"（本轮用户输入）、"大模型"（最近一个 llm 节点输出）、"{{session.x}}" 或含点变量名（未设置读作空串）。
  - op：等于|不等于|包含|不包含|大于|小于|大于等于|小于等于|为空|非空。
  - 出边 port：branches[i] → port=i；【隐式默认分支 → port=len(branches)】，默认分支必须连线，否则不匹配时流程断头。
- intent 意图识别：fields.branches = [{"name", "desc"}]，内置分类器结合【对话 history + 最新输入】\
按语义选分支（desc 写清判别标准）。出边 port=i 对应 branches[i]，最后留一个「默认/其他」分支。\
【判断用户的话属于哪类意图 → 一律用 intent】；cond 只用于判断变量/标志位/数值/提取结果等确定性条件。
- human 转人工：终止本轮并提示已转人工。fields.channel。
- skill 技能：fields.skillId = 可用技能里的 uuid。
- app 应用：fields.botId = 调用另一个已编排的单 Agent。
- code 代码：fields.code（Python，读 inputs dict、赋值 output）、fields.inputs=[{"name","ref"}]。
- end 结束：无 fields。

# 占位符（llm.prompt / reply.content / variable.value / cond 的 src 都支持）
{{上一个节点的输出内容}}、{{history}}（最近12条对话）、{{text}}（本轮用户输入）、\
{{session.x}}/{{global.x}}（变量）、{{节点标题.字段}}（上游节点结构化输出，如 {{提取信息.data}}；\
llm 节点字段为 text/data，kb 为 text/count，cond/intent 为 branch）。

# 跨轮状态机套路（重要）
每轮从 start 重入 → 想让流程「记住进行到哪一步」：cond 按 {{session.阶段标志}} 路由到对应阶段，\
各阶段末尾用 variable 节点改写标志位/计数器。计数上限（如"最多追问3轮"）用 variable 递增 + cond 大于等于 判断。

# 工作准则
0. 复杂任务（建整条流程、建图+自测、多处联动修改）先调 set_plan 列 3~6 步计划，\
每步开始置 doing、完成置 done 实时更新；单点小改不必列计划。
1. 先用一两句话说思路，再调 edit_graph 批量落地；不要把 JSON 图贴给用户看。
2. 【每个节点必须设置业务语义的 title】（如「分诊」「收集联系方式」），不许留空用默认类型名；\
id 用 n_类型_语义（如 n_cond_stage）。edit_graph 返回的 warnings 必须当场补齐。\
给已有节点改名时，同步更新所有引用它的 {{旧名.字段}} 占位符（下游按 title 引用结构化输出）。
3. 每条 cond/intent 的【每个分支（含默认分支）都必须连线】；流程不能有断头节点。\
edit_graph 返回的 lint 是确定性体检（断头/未连分支/不可达/误用模式）：建设中途的临时项可先放着，\
但【run_preview 之前和收工之前 lint 必须清零】。
4. 建完或大改后，主动 run_preview 自测 2~4 条有代表性的消息（含边界路径），发现路由错/输出怪就继续修，修完再测。
5. 变量节点只能写「可用变量」清单里的变量；清单里没有时，用 manage_variables 工具自己定义（跨轮状态/计数器用 scope=session），不要让用户手动去全局配置加。不再需要的实验变量也可用它清理（正式工作流引用的删不掉）。
6. 知识库/技能/应用的 id 只能从下方资源清单里选，绝不编造。
7. 回复用户要简洁，说明你改了什么、测了什么、结果如何。
8. 面向用户的对话回复一律用 llm 节点；reply 只承担固定系统话术。

当前工作流图会以系统消息形式注入在对话末尾；edit_graph 的返回里也始终带最新图。
"""


def build_system_prompt(
    bot_variables: list[Any],
    skills: list[dict],
    kbs: list[dict],
    bot_name: str,
) -> str:
    """静态规范 + 半静态资源清单。当前图【不在此处】——图每次都变，拼进前缀会
    打掉 DeepSeek 的前缀缓存（TTFT 与成本都翻倍）；图以末尾系统消息注入。"""
    vars_lines = []
    for v in bot_variables or []:
        name = (v.get("name") or "").strip()
        if not name:
            continue
        scope = v.get("scope") or "global"
        label = (v.get("label") or "").strip()
        vars_lines.append(f"- {scope}.{name}" + (f"（{label}）" if label else ""))
    parts = [
        SYSTEM_SPEC,
        f"\n# 当前智能体：{bot_name}",
        "\n# 可用变量（variable 节点只能写这些；{{}} 可引用）",
        "\n".join(vars_lines) if vars_lines else "（暂无，可让用户在全局配置→变量管理添加）",
        "\n# 可用技能（skill 节点 skillId）",
        "\n".join(f"- {s['id']}：{s['name']}" + (f" —— {s['desc']}" if s.get("desc") else "") for s in skills) if skills else "（暂无）",
        "\n# 可用知识库（kb 节点 items[].id）",
        "\n".join(f"- {k['id']}：{k['name']}" for k in kbs) if kbs else "（暂无）",
    ]
    return "\n".join(parts)


# ---------------- Copilot SSE 主循环 ----------------

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


# SSE 注释行（冒号开头）：前端 onEvent 会忽略（非 data:），但收到字节即重置空闲看门狗。
# 用于在等首 token / 工具长耗时期间保活，把「连接活着」与「首 token 到没到」解耦。
_HEARTBEAT = ": hb\n\n"
_HEARTBEAT_INTERVAL = 10.0  # 秒；远小于前端 IDLE_TIMEOUT


async def _astream_with_heartbeat(aiter: AsyncIterator, interval: float = _HEARTBEAT_INTERVAL) -> AsyncIterator:
    """包装大模型 astream：等下一个 chunk 期间每 interval 秒产出一个 None 作为心跳信号，
    chunk 到达后原样产出。首 token 延迟尖刺（实测可达 80s+）期间不再触发前端看门狗。"""
    it = aiter.__aiter__()
    while True:
        nxt = asyncio.ensure_future(it.__anext__())
        while True:
            done, _ = await asyncio.wait({nxt}, timeout=interval)
            if done:
                break
            yield None  # 心跳
        try:
            yield nxt.result()
        except StopAsyncIteration:
            return


async def copilot_stream(
    *,
    bot_id: uuid.UUID,
    bot_name: str,
    bot_variables: list[Any],
    skills: list[dict],
    kbs: list[dict],
    messages: list[dict],
    graph: dict | None,
    official_definition: dict | None = None,
) -> AsyncIterator[str]:
    """SSE 事件：delta（文字）/ ops（图操作）/ vars（变量定义变更）/ run（自测）/ done（最终图）/ error。"""
    work = ensure_graph(graph)
    bot_variables = [dict(v) for v in (bot_variables or [])]  # 工作副本：manage_variables 会更新它
    official_text = json.dumps(official_definition or {}, ensure_ascii=False)
    # 前缀缓存友好：静态规范在前（稳定前缀吃 DeepSeek 缓存，TTFT 大降），动态的当前图放消息末尾
    lc_msgs: list[Any] = [SystemMessage(content=build_system_prompt(bot_variables, skills, kbs, bot_name))]
    for m in (messages or [])[-20:]:  # 长会话截断
        content = str(m.get("content") or "")
        if not content:
            continue
        lc_msgs.append(HumanMessage(content=content) if m.get("role") == "user" else AIMessage(content=content))
    lc_msgs.append(SystemMessage(content="【当前工作流图 · 系统注入的最新状态】\n" + json.dumps(compact_graph(work), ensure_ascii=False)))

    llm = build_chat_model(streaming=True).bind_tools(TOOLS)
    try:
        yield _HEARTBEAT  # 连接一建立即回字节，等首 token 期间前端看门狗不空转
        for _round in range(12):
            acc = None
            announced: set[int] = set()  # 本轮已通告的工具调用序号
            async for chunk in _astream_with_heartbeat(llm.astream(lc_msgs)):
                if chunk is None:
                    yield _HEARTBEAT
                    continue
                if isinstance(chunk.content, str) and chunk.content:
                    yield _sse({"type": "delta", "content": chunk.content})
                # 思考模式：推理内容（如 deepseek-reasoner 的 reasoning_content）透传为折叠思考块
                think = (getattr(chunk, "additional_kwargs", None) or {}).get("reasoning_content")
                if think:
                    yield _sse({"type": "think", "content": think})
                # 工具调用一出现就通告（模型生成参数期间前端即可显示进行中状态条）
                for tcc in getattr(chunk, "tool_call_chunks", None) or []:
                    idx = tcc.get("index")
                    if tcc.get("name") and idx not in announced:
                        announced.add(idx)
                        yield _sse({"type": "tool_start", "tool": tcc["name"]})
                acc = chunk if acc is None else acc + chunk
            if acc is None:
                break
            tool_calls = getattr(acc, "tool_calls", None) or []
            if not tool_calls:
                break
            lc_msgs.append(acc)
            for tc in tool_calls:
                name = tc.get("name")
                args = tc.get("args") or {}
                if name == "edit_graph":
                    applied, errors, warnings = apply_ops(work, args.get("ops") or [])
                    if applied:
                        yield _sse({"type": "ops", "ops": applied})
                    result: dict[str, Any] = {
                        "applied": len(applied),
                        "errors": errors,
                        "warnings": warnings,
                        "lint": lint_graph(work),  # 体检结果：收工前必须清干净
                        "graph": compact_graph(work),
                    }
                elif name == "manage_variables":
                    # 删除保护按「当前编辑中的图 + 落库定义」共同判断引用
                    ref_text = official_text + json.dumps(compact_graph(work), ensure_ascii=False)
                    bot_variables, notes, verrs = await apply_variable_ops(
                        bot_id, bot_variables, args.get("ops") or [], ref_text,
                    )
                    if notes:
                        yield _sse({"type": "vars", "variables": bot_variables})
                    result = {
                        "done": notes,
                        "errors": verrs,
                        "可用变量": [f"{v.get('scope')}.{v.get('name')}" for v in bot_variables if v.get("name")],
                    }
                elif name == "set_plan":
                    steps = args.get("steps") or []
                    yield _sse({"type": "plan", "steps": steps})
                    result = {"ok": True, "steps": len(steps)}
                elif name == "run_preview":
                    # 自测逐轮直播：每轮先报进度，跑完即推结果（前端实时渲染 + 画布点亮）
                    turns: list[dict] = []
                    async for kind, payload in run_exp_dialogue_stream(
                        work, args.get("messages") or [], args.get("session_variables") or {}, bot_variables,
                    ):
                        if kind == "turn_start":
                            yield _sse({"type": "run_turn_start", **payload})
                        else:
                            turns.append(payload)
                            yield _sse({"type": "run_turn", "turn": payload})
                    result = {
                        "turns": [
                            {
                                "user": t.get("user"),
                                "reply": (t.get("reply") or "")[:400],
                                "error": t.get("error"),
                                "steps": _brief_steps(t.get("steps") or []),
                                "variables": t.get("variables") or {},
                            }
                            for t in turns
                        ],
                        "note": "技能节点已跳过真实副作用",
                    }
                else:
                    result = {"error": f"未知工具 {name!r}"}
                lc_msgs.append(ToolMessage(content=json.dumps(result, ensure_ascii=False), tool_call_id=tc.get("id") or ""))
                yield _sse({"type": "tool_end", "tool": name})  # 每次工具执行完成都显式收尾（前端状态条打勾）
        yield _sse({"type": "done", "graph": {"nodes": work["nodes"], "edges": work["edges"]}})
    except Exception as exc:  # noqa: BLE001
        yield _sse({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
