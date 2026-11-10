"""Workflow 引擎：执行画布图（前端 WorkflowCanvas 持久化的格式）。

图格式（来自 workflow_definition）：
    {
      "nodes": [{"id", "type", "x", "y", "fields": {...}}, ...],
      "edges": [{"from", "to"}, ...]
    }

节点类型与执行语义：
- start    : output = 用户输入
- llm      : 渲染 fields.prompt(支持 {{上一个节点的输出内容}}/{{变量}}) → 调模型 → output
- kb       : 若提供真实 kb_id 则 rag 检索拼接，否则透传（节点内 items 为示例知识，跳过）
- reply    : output = 渲染 fields.content（直接回答）
- intent   : LLM 对 output 做分类，选中分支 → 对应出边
- cond     : 按 fields.branches 的条件对 output 求值，命中分支 → 对应出边
- variable : 把 fields.rows 写入运行变量，output 不变
- human    : 转人工，输出提示并结束
- skill    : 调用技能（占位，透传）
- app      : 运行一个「已编排好的单 Agent」(另一个 bot)——通过 run_agent 回调
- end      : 结束，最终输出 = 当前 output

返回 (最终输出, trace)。trace 为每个节点的执行记录，可用于可视化逐节点点亮。
"""
import re
import uuid
from collections.abc import Awaitable, Callable
from time import perf_counter
from typing import Any

import anyio.to_thread

from langchain_core.messages import HumanMessage, SystemMessage

from app.agents.models import build_chat_model


def _is_uuid(v: Any) -> bool:
    try:
        uuid.UUID(str(v))
        return True
    except (ValueError, TypeError):
        return False

# app 节点回调：给定 bot_id 与输入，运行该单 Agent 返回文本
RunAgent = Callable[[str, str], Awaitable[str]]
# skill 节点回调（agentic）：给定 skill_id 与文本输入，让临时 agent 自行推参调用，返回文本
RunSkill = Callable[[str, str], Awaitable[str]]
# skill 节点回调（确定性）：给定 skill_id 与显式参数 dict，直接调用该技能工具，返回文本
InvokeSkill = Callable[[str, dict], Awaitable[str]]

_VAR_RE = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")

_TYPE_LABELS = {
    "start": "开始", "llm": "大模型", "kb": "知识库", "variable": "变量", "reply": "直接回复",
    "intent": "意图识别", "cond": "条件分支", "human": "转人工", "skill": "技能", "app": "应用", "end": "结束",
}


def _type_label(t: str | None) -> str:
    return _TYPE_LABELS.get(t or "", t or "节点")


def _to_text(v: Any) -> str:
    """把任意类型值转为可嵌入文本/比较的字符串（对象/数组转 JSON）。"""
    import json as _json
    if isinstance(v, str):
        return v
    if isinstance(v, (dict, list)):
        return _json.dumps(v, ensure_ascii=False)
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _coerce(s: str) -> Any:
    """把字符串尽量还原为 JSON 类型（数字/布尔/对象/数组）；否则保留字符串。"""
    import json as _json
    t = (s or "").strip()
    if t == "":
        return ""
    try:
        return _json.loads(t)
    except Exception:  # noqa: BLE001
        return s


def _try_json(s: str) -> Any:
    """尝试把 LLM 文本解析为 JSON（去掉 ```json 围栏）；失败返回 None。"""
    import json as _json
    t = (s or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(json)?\s*|\s*```$", "", t, flags=re.IGNORECASE).strip()
    try:
        v = _json.loads(t)
        return v if isinstance(v, (dict, list)) else None
    except Exception:  # noqa: BLE001
        return None


def _subst(text: str, output: str, variables: dict[str, str]) -> str:
    """把 {{上一个节点的输出内容}}/{{output}}/{{input}}/{{var}} 替换为实际值。"""
    if not text:
        return ""

    def repl(m: "re.Match[str]") -> str:
        key = m.group(1).strip()
        if key in ("上一个节点的输出内容", "上一个节点的输入内容", "output", "input"):
            return output
        if key in variables:
            return variables[key]
        if "." not in key:  # 裸名回退到作用域
            for sc in ("session", "global", "customer", "sys"):
                if f"{sc}.{key}" in variables:
                    return variables[f"{sc}.{key}"]
        return m.group(0)

    return _VAR_RE.sub(repl, text)


def _index(graph: dict) -> tuple[dict[str, dict], dict[str, list[str]]]:
    nodes = {n["id"]: n for n in graph.get("nodes", [])}
    out: dict[str, list[str]] = {}
    for e in graph.get("edges", []):
        out.setdefault(e["from"], []).append(e["to"])
    return nodes, out


async def _classify(prompt_input: str, branches: list[dict], model: str | None, history: str = "") -> int:
    """用 LLM 在分支中选一个，返回索引；失败回退 0。"""
    options = "\n".join(
        f"{i}. {b.get('name') or '分支'+str(i)}：{b.get('desc','')}" for i, b in enumerate(branches)
    )
    sys = "你是一个意图/场景分类器。结合对话记录与用户最新输入，从给定分支中选择最匹配的一个，只输出其编号数字。"
    ctx = f"对话记录：\n{history}\n\n" if history else ""
    usr = f"{ctx}用户最新输入：{prompt_input}\n\n可选分支：\n{options}\n\n只回答编号数字："
    try:
        # 只要一个编号数字：限制输出长度，省生成时延
        model_ = build_chat_model(model, streaming=False, params={"max_tokens": 8})
        resp = await model_.ainvoke([SystemMessage(content=sys), HumanMessage(content=usr)])
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        m = re.search(r"\d+", text)
        if m:
            idx = int(m.group(0))
            if 0 <= idx < len(branches):
                return idx
    except Exception:  # noqa: BLE001
        pass
    return 0


def _src_value(
    src: str | None, node_input: str, start_output: str, type_output: dict[str, str], variables: dict[str, str]
) -> str:
    """把条件里的「来源」解析为实际比较值。支持变量：{{x}} 占位 或 直接变量名。"""
    s = src or ""
    if "{{" in s:  # 含占位 → 用变量替换
        return _subst(s, node_input, variables)
    if "." in s:  # 视为变量名（scope.name，如 session.call_doctor）；未设置读作空
        return variables.get(s, "")
    if s in variables:
        return variables[s]
    if "开始" in s or "用户输入" in s:
        return start_output
    if "大模型" in s:
        return type_output.get("llm", "")
    if "知识库" in s:
        return type_output.get("kb", "")
    return node_input


def _eval_cond(output: str, cond: dict) -> bool:
    val = str(cond.get("val", ""))
    op = cond.get("op", "等于")
    o = output.strip()
    if op == "等于":
        return o == val
    if op == "不等于":
        return o != val
    if op == "包含":
        return val in output
    if op == "不包含":
        return val not in output
    if op in ("大于", "小于", "大于等于", "小于等于"):
        try:
            a, b = float(o or 0), float(val or 0)
        except ValueError:
            return False
        return {"大于": a > b, "小于": a < b, "大于等于": a >= b, "小于等于": a <= b}[op]
    if op == "为空":
        return o == ""
    if op == "非空":
        return o != ""
    return False


async def run_workflow(
    graph: dict,
    user_input: str,
    *,
    run_agent: RunAgent | None = None,
    run_skill: RunSkill | None = None,
    invoke_skill: InvokeSkill | None = None,
    variables: dict[str, Any] | None = None,
    on_delta: Callable[[str], None] | None = None,
    model_override: str | None = None,
    reply_max_tokens: int | None = None,
    intent_memo: dict[str, dict] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """on_delta：终端回复 llm 节点（下游只剩 variable/end）的 token 级回调，供语音预演把
    首句尽早送 TTS；非终端 llm（分类/中间提取）不回调。model_override / reply_max_tokens
    为语音低延迟覆写：意图分类与口语回复节点换快模型、限输出长度（output_json 节点不覆写）。
    intent_memo：同一轮语音投机会以"前缀增长"的候选文本反复预演，意图分类几乎不变——
    传入跨次 memo（node_id → {text, idx}），候选是上次文本的小幅扩展(≤8字)时直接复用分支，
    把分类 LLM 调用从改押的关键路径上拿掉。提交后由调用方清掉。"""
    nodes, out_edges = _index(graph)
    start = next((n for n in graph.get("nodes", []) if n.get("type") == "start"), None)
    if start is None:
        raise ValueError("工作流缺少开始节点")

    def _is_terminal_reply(nid: str) -> bool:
        """该节点产出之后是否原样流到终点（路径上只有 variable/end）→ 输出即最终回复，可流式。"""
        seen: set[str] = set()
        stack = list(out_edges.get(nid, []))
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            nx = nodes.get(x)
            if nx is None:
                continue
            if nx.get("type") not in ("variable", "end"):
                return False
            stack.extend(out_edges.get(x, []))
        return True

    output = user_input
    start_output = user_input  # 「开始节点的输出 / 用户输入」恒为初始输入
    type_output: dict[str, str] = {}  # 各类型节点的最近一次输出（供条件分支按源取值）
    # 初始变量来自全局配置（会话变量 + 数据钩子写入的变量 + 系统变量），节点用 {{scope.name}} 引用
    variables: dict[str, str] = {
        k: (v if isinstance(v, str) else str(v)) for k, v in (variables or {}).items()
    }
    # 节点结构化输出（对标 Dify）：以 "节点标题.字段" 暴露，供下游 {{标题.字段}} 引用；不持久化
    node_outs: dict[str, str] = {}

    def rv() -> dict[str, str]:  # 解析视图：节点输出 + 变量（变量优先）
        return {**node_outs, **variables}

    titles: dict[str, str] = {}
    for n in graph.get("nodes", []):
        t = (n.get("title") or "").strip() or _type_label(n.get("type"))
        titles[n["id"]] = t

    trace: list[dict[str, Any]] = []
    visited: set[str] = set()
    cur: str | None = start["id"]
    steps = 0

    def _snap() -> dict[str, str]:
        return {k: v for k, v in variables.items() if k not in ("history", "text")}

    while cur and steps < 100:
        steps += 1
        node = nodes.get(cur)
        if node is None:
            break
        ntype = node.get("type")
        fields = node.get("fields", {})
        nexts = out_edges.get(cur, [])
        next_id: str | None = nexts[0] if nexts else None

        # 「节点输入」来源：开始节点输出 / 用户输入 → start_output；否则取上一个节点输出
        finput = str(fields.get("input", ""))
        node_input = start_output if ("开始" in finput or "用户输入" in finput) else output
        note = ""           # 过程说明（路由决策 / 变量写入 / 调用对象等）
        detail: dict[str, Any] = {}  # 节点专属结构化调试信息
        branch_idx: int | None = None
        branch_label: str | None = None
        status = "ok"
        error = ""
        terminal = False
        t0 = perf_counter()

        try:
            if ntype == "start":
                output = user_input
            elif ntype == "end":
                terminal = True
            elif ntype == "llm":
                prompt = _subst(fields.get("prompt", "{{上一个节点的输出内容}}"), node_input, rv())
                want_json = bool(fields.get("output_json"))
                sys_msgs = []
                if want_json:
                    sys_msgs = [SystemMessage(content="只输出一个 JSON 对象，不要输出任何解释或代码围栏。")]
                # JSON 提取节点保持节点自带模型（结构化质量优先）；口语回复节点可被覆写为快模型
                use_model = fields.get("model") if want_json else (model_override or fields.get("model"))
                model_name = use_model or ""
                params = {"max_tokens": reply_max_tokens} if (reply_max_tokens and not want_json) else None
                msgs = sys_msgs + [HumanMessage(content=prompt or node_input)]
                um: dict = {}
                if on_delta is not None and not want_json and _is_terminal_reply(cur):
                    # 终端回复节点：token 级流式回调（首句尽早进 TTS），最终 output 不变
                    model_ = build_chat_model(use_model, params=params, streaming=True)
                    parts: list[str] = []
                    async for chunk in model_.astream(msgs):
                        delta = chunk.content if isinstance(chunk.content, str) else str(chunk.content)
                        if delta:
                            parts.append(delta)
                            on_delta(delta)
                        um = getattr(chunk, "usage_metadata", None) or um
                    output = "".join(parts)
                else:
                    model_ = build_chat_model(use_model, params=params, streaming=False)
                    resp = await model_.ainvoke(msgs)
                    output = resp.content if isinstance(resp.content, str) else str(resp.content)
                    um = getattr(resp, "usage_metadata", None) or {}
                detail = {"model": model_name, "prompt": prompt,
                          "tokens": {"input": um.get("input_tokens"), "output": um.get("output_tokens"), "total": um.get("total_tokens")} if um else None}
                if want_json:
                    detail["json"] = _try_json(output)
            elif ntype == "reply":
                rendered = _subst(fields.get("content", ""), node_input, rv())
                output = rendered or node_input
                detail = {"template": fields.get("content", "")}
            elif ntype == "voice":
                # 语音节点：把文案作为本节点输出（与 reply 同），并携带音色/通道元数据。
                # 文本预览时等同播报文案；接 VoiceAgent 时由所选音色 TTS 合成。
                rendered = _subst(fields.get("content", ""), node_input, rv())
                output = rendered or node_input
                detail = {"template": fields.get("content", ""), "voice_id": fields.get("voiceId"),
                          "voice_mode": fields.get("voiceMode") or "speak"}
                note = "语音播报" + (f"（音色 {fields.get('voiceId')}）" if fields.get("voiceId") else "")
            elif ntype == "kb":
                from app.agents.tools.rag_search import retrieve_text

                kb_ids = [it.get("id") for it in fields.get("items", []) if _is_uuid(it.get("id"))]
                if fields.get("kb_id") and _is_uuid(fields.get("kb_id")):
                    kb_ids.append(str(fields["kb_id"]))
                ctxs = [t for kid in kb_ids if (t := retrieve_text(str(kid), node_input))]
                output = f"{node_input}\n\n[知识库检索]\n" + "\n\n".join(ctxs) if ctxs else node_input
                detail = {"kb_ids": [str(k) for k in kb_ids], "hits": len(ctxs)}
                note = f"检索 {len(kb_ids)} 个知识库，命中 {len(ctxs)} 段"
            elif ntype == "variable":
                # 新格式：变量在全局配置统一定义，节点选择已定义变量做操作
                # rows=[{var:"session.x", op:"赋值|递增|递减|追加|清空", value, step}]；
                # 旧格式 rows=[{name, value, inc:"递增|不递增", step}] 继续兼容（存量工作流不迁移也能跑）。
                writes: dict[str, str] = {}
                for row in fields.get("rows", []):
                    key = (row.get("var") or row.get("name") or "").strip()
                    if not key:
                        continue
                    op = row.get("op") or ("递增" if row.get("inc") == "递增" else "赋值")
                    before = variables.get(key)
                    if op in ("递增", "递减"):
                        try:
                            base = float(variables.get(key, "0") or 0)
                        except ValueError:
                            base = 0.0
                        try:
                            stp = float(row.get("step") or 1)
                        except ValueError:
                            stp = 1.0
                        nv = base + stp if op == "递增" else base - stp
                        variables[key] = str(int(nv)) if nv.is_integer() else str(nv)
                    elif op == "清空":
                        variables[key] = ""
                    elif op == "追加":
                        variables[key] = (variables.get(key) or "") + _subst(str(row.get("value", "")), node_input, rv())
                    else:  # 赋值
                        variables[key] = _subst(str(row.get("value", "")), node_input, rv())
                    writes[key] = f"{before if before is not None else '∅'} → {variables[key]}"
                note = "写入变量：" + "；".join(f"{k}={variables[k]}" for k in writes) if writes else ""
                detail = {"writes": writes}
                output = node_input
            elif ntype == "human":
                output = "【已转人工】已通知人工客服介入，请稍候。"
                terminal = True
            elif ntype == "skill":
                skill_id = fields.get("skillId")
                arg_rows = [a for a in (fields.get("args") or []) if a.get("name")]
                if skill_id and arg_rows and invoke_skill:
                    resolved = {a["name"]: _subst(str(a.get("value", "")), node_input, rv()) for a in arg_rows}
                    detail = {"skill_id": skill_id, "args": resolved}
                    note = "调用技能（参数映射）"
                    output = await invoke_skill(str(skill_id), resolved)
                elif skill_id and run_skill:
                    detail = {"skill_id": skill_id}
                    note = "调用技能（自动推参）"
                    output = await run_skill(str(skill_id), node_input)
                else:
                    note = "未配置技能，透传"
                    output = node_input
            elif ntype == "app":
                bot_id = fields.get("botId") or fields.get("bot_id")
                note = f"运行子 Agent {bot_id}" if bot_id else "未配置应用，透传"
                detail = {"bot_id": bot_id}
                output = await run_agent(str(bot_id), node_input) if (bot_id and run_agent) else node_input
            elif ntype == "code":
                from app.workflows.code_exec import run_user_code

                code_inputs: dict[str, Any] = {}
                for m in fields.get("inputs", []):
                    nm = (m.get("name") or "").strip()
                    if not nm:
                        continue
                    ref = (m.get("ref") or "").strip()
                    raw = _subst("{{" + ref + "}}", node_input, rv()) if ref else node_input
                    code_inputs[nm] = _coerce(raw)
                result = await anyio.to_thread.run_sync(lambda: run_user_code(fields.get("code", ""), code_inputs))
                detail = {"code_inputs": code_inputs, "result": result}
                note = "代码执行完成"
                output = _to_text(result)
            elif ntype in ("intent", "cond"):
                output = node_input
                branches = fields.get("branches", [])
                if ntype == "intent":
                    memo = (intent_memo or {}).get(cur)
                    reused = bool(
                        memo and node_input.startswith(memo["text"])
                        and len(node_input) - len(memo["text"]) <= 8
                    )
                    if reused:
                        idx = memo["idx"]
                    else:
                        idx = await _classify(node_input, branches, model_override or fields.get("model"), variables.get("history", "")) if branches else 0
                    if intent_memo is not None:
                        intent_memo[cur] = {"text": node_input, "idx": idx}
                    detail = {"candidates": [b.get("name") or f"分支{i+1}" for i, b in enumerate(branches)], "chosen_index": idx, "reused": reused}
                else:
                    idx = len(branches)  # 默认分支
                    evals = []
                    for i, b in enumerate(branches):
                        conds = b.get("conds", [])
                        match = b.get("match", "所有")
                        crows = []
                        for c in conds:
                            sv = _src_value(c.get("src"), node_input, start_output, type_output, rv())
                            crows.append({"src": c.get("src"), "src_value": sv, "op": c.get("op", "等于"), "val": c.get("val", ""), "result": _eval_cond(sv, c)})
                        ok = (all(r["result"] for r in crows) if match == "所有" else any(r["result"] for r in crows)) if crows else False
                        evals.append({"name": b.get("name") or f"分支{i+1}", "match": match, "conds": crows, "matched": bool(conds and ok)})
                        if conds and ok and idx == len(branches):
                            idx = i
                    detail = {"evaluations": evals}
                port_edges = [e for e in graph.get("edges", []) if e.get("from") == cur and e.get("port") is not None]
                chosen = next((e for e in port_edges if e.get("port") == idx), None)
                next_id = chosen.get("to") if chosen is not None else (nexts[idx] if idx < len(nexts) else (nexts[0] if nexts else None))
                if ntype == "cond":
                    branch_label = "默认分支" if idx >= len(branches) else (branches[idx].get("name") or f"分支{idx + 1}")
                else:
                    branch_label = (branches[idx].get("name") if idx < len(branches) else None) or f"分支{idx + 1}"
                branch_idx = idx
                note = f"命中分支：{branch_label}"
        except Exception as exc:  # noqa: BLE001
            status = "error"
            error = f"{type(exc).__name__}: {exc}"
            terminal = True

        if status == "ok":
            type_output[ntype] = output

        # 结构化 inputs / outputs（对标 Dify 的节点 IO）
        if ntype == "start":
            inputs_obj: dict[str, Any] = {"query": user_input}
            outputs_obj: dict[str, Any] = {"query": output}
        elif ntype == "llm":
            inputs_obj = {"model": detail.get("model"), "prompt": detail.get("prompt")}
            outputs_obj = {"text": output}
            if detail.get("json") is not None:
                outputs_obj["data"] = detail["json"]
        elif ntype == "reply":
            inputs_obj = {"input": node_input}
            outputs_obj = {"text": output}
        elif ntype == "voice":
            inputs_obj = {"input": node_input, "voice_id": detail.get("voice_id"), "mode": detail.get("voice_mode")}
            outputs_obj = {"text": output}
        elif ntype == "kb":
            inputs_obj = {"query": node_input}
            outputs_obj = {"text": output, "count": detail.get("hits")}
        elif ntype == "variable":
            inputs_obj = {"input": node_input}
            outputs_obj = {k: variables.get(k) for k in (detail.get("writes") or {})}
        elif ntype in ("intent", "cond"):
            inputs_obj = {"value": node_input}
            outputs_obj = {"branch": branch_label}
        elif ntype == "skill":
            inputs_obj = dict(detail.get("args") or {"input": node_input})
            outputs_obj = {"text": output}
        elif ntype == "code":
            inputs_obj = dict(detail.get("code_inputs") or {})
            res = detail.get("result")
            outputs_obj = res if isinstance(res, dict) else {"output": res}
        else:
            inputs_obj = {"input": node_input}
            outputs_obj = {"text": output}

        # 暴露为「节点标题.字段」供下游 {{标题.字段}} 引用（对象再展开一层）
        title = titles.get(cur, _type_label(ntype))
        for k, v in outputs_obj.items():
            node_outs[f"{title}.{k}"] = _to_text(v)
            if isinstance(v, dict):
                for sk, sv in v.items():
                    node_outs[f"{title}.{k}.{sk}"] = _to_text(sv)

        step: dict[str, Any] = {
            "node": cur, "type": ntype, "title": node.get("title") or "",
            "status": status, "elapsed_ms": int((perf_counter() - t0) * 1000),
            "input": node_input, "output": output, "note": note, "detail": detail,
            "inputs": inputs_obj, "outputs": outputs_obj, "vars": _snap(),
        }
        if error:
            step["error"] = error
        if branch_idx is not None:
            step["branch"] = branch_idx
            step["branch_label"] = branch_label
        trace.append(step)

        if terminal:
            break
        if cur in visited:
            break
        visited.add(cur)
        cur = next_id

    return output, trace, variables
