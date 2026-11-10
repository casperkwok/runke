"""技能工具执行：把 tool 技能（连接器 + 入参）封装为可被 agent 调用的 LangChain 工具，
并真实发起 HTTP 调用。SOP 技能不在此（作为提示词注入 + 其关联工具）。
"""
import json
import re
from typing import Any

import httpx
from langchain_core.tools import StructuredTool
from pydantic import create_model

_VAR = re.compile(r"\{\{\s*([^}]+?)\s*\}\}")


def _subst(text: str, args: dict[str, Any]) -> str:
    return _VAR.sub(lambda m: str(args.get(m.group(1).strip(), m.group(0))), text or "")


def call_connector(connector: Any, args: dict[str, Any], send_args: bool = True) -> dict[str, Any]:
    """按连接器定义真实发起 HTTP 调用。

    send_args=True（工具调用）：args 作为 GET params / 非 GET body 发送；
    send_args=False（数据钩子）：args 仅用于 {{变量}} 占位替换，不作为参数发送。
    """
    method = (connector.method or "GET").upper()
    url = _subst(connector.url or "", args)
    headers = {k: _subst(str(v), args) for k, v in (connector.headers or {}).items()}
    if not url:
        return {"ok": False, "status": None, "error": "连接器未配置 URL"}
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as c:
            if method == "GET":
                r = c.get(url, params=args if send_args else None, headers=headers)
            else:
                r = c.request(method, url, json=args if send_args else None, headers=headers)
        try:
            body: Any = r.json()
        except Exception:  # noqa: BLE001
            body = r.text
        return {"ok": r.is_success, "status": r.status_code, "result": body}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "status": None, "error": f"{type(exc).__name__}: {exc}"}


def _safe_name(skill: Any) -> str:
    return "skill_" + str(skill.id).replace("-", "")[:12]


def make_skill_tool(skill: Any, connector: Any) -> StructuredTool:
    """根据 tool 技能与其连接器，构造一个可调用的 LangChain 工具。"""
    fields: dict[str, Any] = {}
    for p in skill.inputs or []:
        name = (p.get("name") or "").strip()
        if not name:
            continue
        # 必填 → 无默认；选填 → 默认 None
        fields[name] = (str, ... if p.get("req") else None)
    ArgsSchema = create_model(f"{_safe_name(skill)}_args", **fields)

    def run(**kwargs: Any) -> str:
        if connector is None:
            return "（该技能未关联可用连接器，无法调用）"
        res = call_connector(connector, kwargs)
        payload = res.get("result") if res.get("ok") else res.get("error")
        return json.dumps(payload, ensure_ascii=False) if not isinstance(payload, str) else payload

    desc = skill.description or skill.name
    if skill.inputs:
        params = "，".join(f"{p.get('name')}({'必填' if p.get('req') else '选填'})" for p in skill.inputs if p.get("name"))
        desc = f"{desc}。入参：{params}"

    return StructuredTool.from_function(func=run, name=_safe_name(skill), description=desc, args_schema=ArgsSchema)
