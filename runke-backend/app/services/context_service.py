"""全局配置运行时：变量存储 + 数据钩子调用 + 上下文注入。

数据流（确定性、非模型决策）：
    创建会话(带入 candidate_id 等会话变量)
      → 变量存储 = 系统变量 + Bot 全局变量默认值 + 会话已存变量
      → 按时机执行 Bot.data_hooks（调用连接器，把返回字段映射进变量存储）
      → 上下文注入模板用变量存储渲染，拼到 system 提示词前
与「技能/工具」（模型自主调用、按需）互补，不重复。
"""
import re
from datetime import datetime
from typing import Any

from sqlalchemy import select

from app.agents.tools.skill_tool import call_connector
from app.core.db import SessionLocal
from app.models.skill import Connector

_VAR = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")


_SCOPES = ("session", "global", "customer", "sys")


def _lookup(store: dict[str, Any], key: str) -> Any:
    """先精确匹配；裸名(如 name)再回退到 session./global./customer./sys. 作用域。"""
    if key in store:
        return store[key]
    if "." not in key:
        for sc in _SCOPES:
            sk = f"{sc}.{key}"
            if sk in store:
                return store[sk]
    return None


def substitute(text: str, store: dict[str, Any]) -> str:
    """把 {{scope.name}} 或裸 {{name}} 占位替换为变量值；缺失则原样保留。"""
    def repl(m: "re.Match[str]") -> str:
        v = _lookup(store, m.group(1).strip())
        return str(v) if v is not None else m.group(0)
    return _VAR.sub(repl, text or "")


def _get_path(obj: Any, path: str) -> Any:
    """按点路径取值，支持 dict 键与 list 下标，如 data.orders.0.id。"""
    cur = obj
    for seg in path.split("."):
        seg = seg.strip()
        if isinstance(cur, dict):
            cur = cur.get(seg)
        elif isinstance(cur, list):
            try:
                cur = cur[int(seg)]
            except (ValueError, IndexError):
                return None
        else:
            return None
        if cur is None:
            return None
    return cur


def build_var_store(
    variables: list[Any], conv_variables: dict[str, Any], channel: str = "调试"
) -> dict[str, Any]:
    """组装变量存储：系统变量 + 全局变量默认值 + 会话已存变量。"""
    store: dict[str, Any] = {
        "sys.time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "sys.channel": channel,
    }
    for v in variables or []:
        name = (v.get("name") or "").strip()
        if not name:
            continue
        scope = v.get("scope") or "global"
        val = v.get("value")
        if scope == "system":
            continue  # 系统变量只读，不接受用户定义覆盖
        if val not in (None, "", "—", "运行时写入", "自动注入"):
            store[f"{scope}.{name}"] = val
    # 会话已持久化变量（含创建会话带入的、上一轮钩子写入的）覆盖默认值
    store.update(conv_variables or {})
    return store


async def run_due_hooks(
    data_hooks: list[Any], owner_id: Any, store: dict[str, Any], when: str
) -> bool:
    """执行匹配 trigger 的数据钩子：调用连接器、按 mapping 把返回字段写入变量存储。

    返回是否有变量被更新（用于决定是否回写会话）。
    """
    hooks = [h for h in (data_hooks or []) if (h.get("trigger") or "session_start") == when]
    if not hooks:
        return False
    # 收集需要的连接器
    conn_ids: set[str] = {str(h.get("connector_id")) for h in hooks if h.get("connector_id")}
    if not conn_ids:
        return False
    import uuid as _uuid

    valid_ids = []
    for cid in conn_ids:
        try:
            valid_ids.append(_uuid.UUID(cid))
        except ValueError:
            continue
    if not valid_ids:
        return False
    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(Connector).where(
                    Connector.id.in_(valid_ids), Connector.owner_id == owner_id
                )
            )
        ).scalars().all()
    conn_by_id = {str(c.id): c for c in rows}

    changed = False
    for h in hooks:
        conn = conn_by_id.get(str(h.get("connector_id")))
        if conn is None or not conn.enabled:
            continue
        res = call_connector(conn, dict(store), send_args=False)
        if not res.get("ok"):
            continue
        body = res.get("result")
        for m in h.get("mapping") or []:
            frm = (m.get("from") or "").strip()
            to = (m.get("to") or "").strip()
            if not to:
                continue
            val = _get_path(body, frm) if frm else body
            if val is None:
                continue
            store[to] = val if isinstance(val, str) else _stringify(val)
            changed = True
    return changed


def _stringify(val: Any) -> str:
    import json

    if isinstance(val, (dict, list)):
        return json.dumps(val, ensure_ascii=False)
    return str(val)


def render_context(context_enabled: bool, context_template: str, store: dict[str, Any]) -> str:
    """渲染上下文注入模板（启用时），返回拼到 system 提示词前的文本块。"""
    if not context_enabled:
        return ""
    tpl = (context_template or "").strip()
    if not tpl:
        return ""
    return substitute(tpl, store)


async def persist_conv_variables(conv_id: Any, store: dict[str, Any]) -> None:
    """把变量存储中“非系统”的部分回写到会话（系统变量每轮重算，不持久化）。"""
    persistable = {k: v for k, v in store.items() if not k.startswith("sys.")}
    async with SessionLocal() as session:
        from app.models.bot import Conversation

        conv = await session.get(Conversation, conv_id)
        if conv is None:
            return
        conv.variables = persistable
        await session.commit()
