"""飞书多维表格回写：用「个人授权码(personal_base_token)」直连 Base 开放平台，更新候选人记录。

凭证与字段映射存在 Skill.config（技能定义时填写，不走单独连接器）：
config = {
  "url": "<多维表格链接>",          # 解析出 app_token + table_id
  "app_token": "...", "table_id": "...",
  "personal_base_token": "...",
  "fields": [{"arg": "stage", "field": "当前阶段", "type": "text"}, ...]  # 入参 → 表字段
}
运行时入参：record_id + 各 arg 值；只回写非空字段。
"""
from typing import Any
from urllib.parse import parse_qs, urlparse

from langchain_core.tools import StructuredTool
from pydantic import create_model


def parse_bitable_url(url: str) -> tuple[str, str]:
    """从多维表格链接解析 (app_token, table_id)。支持 /base/<tok> 与 /wiki/<tok>?table=..."""
    p = urlparse(url or "")
    parts = [seg for seg in p.path.split("/") if seg]
    app_token = ""
    for i, seg in enumerate(parts):
        if seg in ("base", "wiki") and i + 1 < len(parts):
            app_token = parts[i + 1]
            break
    if not app_token and parts:
        app_token = parts[-1]
    table_id = (parse_qs(p.query).get("table", [""]) or [""])[0]
    return app_token, table_id


def _client(app_token: str, token: str):
    from baseopensdk import BaseClient

    return BaseClient.builder().app_token(app_token).personal_base_token(token).build()


def _coerce(value: str, ftype: str) -> Any:
    v = (value or "").strip()
    if not v:
        return None
    if ftype == "datetime":
        # 接受毫秒时间戳 或 YYYY-MM-DD[ HH:MM]
        if v.isdigit():
            return int(v)
        from datetime import datetime

        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
            try:
                return int(datetime.strptime(v, fmt).timestamp() * 1000)
            except ValueError:
                continue
        return None
    return v  # text / singleselect 直接用字符串


def test_connection(url: str, token: str) -> dict[str, Any]:
    """测试连接：列一条记录验证 app_token/table_id/授权码。"""
    app_token, table_id = parse_bitable_url(url)
    if not app_token or not table_id:
        return {"ok": False, "error": "链接解析失败，需含 app_token 和 ?table=表ID"}
    try:
        from baseopensdk.api.base.v1 import ListAppTableRecordRequest

        client = _client(app_token, token)
        req = ListAppTableRecordRequest.builder().table_id(table_id).page_size(1).build()
        resp = client.base.v1.app_table_record.list(req)
        if not resp.success():
            return {"ok": False, "error": f"{resp.code}: {resp.msg}"}
        total = getattr(resp.data, "total", None)
        return {"ok": True, "app_token": app_token, "table_id": table_id, "total": total}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


_FTYPE = {"text": 1, "datetime": 5}  # 多维表格字段类型：1=多行文本, 5=日期


def _ensure_fields(client, table_id: str, needed: dict[str, str]) -> None:
    """needed: {字段名: type(text/datetime)}。不存在的自动创建（文本/日期）。"""
    from baseopensdk.api.base.v1 import (
        AppTableField,
        CreateAppTableFieldRequest,
        ListAppTableFieldRequest,
    )

    resp = client.base.v1.app_table_field.list(
        ListAppTableFieldRequest.builder().table_id(table_id).page_size(100).build()
    )
    have = {f.field_name for f in (resp.data.items or [])} if resp.success() else set()
    for fname, ftype in needed.items():
        if fname in have:
            continue
        client.base.v1.app_table_field.create(
            CreateAppTableFieldRequest.builder().table_id(table_id)
            .request_body(AppTableField.builder().field_name(fname).type(_FTYPE.get(ftype, 1)).build())
            .build()
        )


def update_record(config: dict[str, Any], record_id: str, values: dict[str, str]) -> str:
    """按 config 的字段映射，更新某条记录的字段（只写非空；字段不存在自动创建）。"""
    app_token = config.get("app_token") or parse_bitable_url(config.get("url", ""))[0]
    table_id = config.get("table_id") or parse_bitable_url(config.get("url", ""))[1]
    token = config.get("personal_base_token", "")
    rid = (record_id or "").strip()
    if not (app_token and table_id and token):
        return "回写未配置完整（缺 app_token/table_id/授权码）"
    if not rid:
        return "缺少 record_id，无法定位候选人记录"
    fmap = config.get("fields") or []
    fields: dict[str, Any] = {}
    need_create: dict[str, str] = {}
    for m in fmap:
        arg, fname, ftype = m.get("arg"), m.get("field"), m.get("type", "text")
        if not arg or not fname:
            continue
        cv = _coerce(str(values.get(arg, "")), ftype)
        if cv is not None:
            fields[fname] = cv
            need_create[fname] = ftype
    if not fields:
        return "没有要回写的内容"
    from baseopensdk.api.base.v1 import AppTableRecord, UpdateAppTableRecordRequest

    client = _client(app_token, token)
    try:
        _ensure_fields(client, table_id, need_create)
    except Exception:  # noqa: BLE001 建字段失败不阻断（字段可能已存在）
        pass
    req = (
        UpdateAppTableRecordRequest.builder()
        .table_id(table_id).record_id(rid)
        .request_body(AppTableRecord.builder().fields(fields).build())
        .build()
    )
    resp = client.base.v1.app_table_record.update(req)
    if not resp.success():
        return f"回写失败 {resp.code}: {resp.msg}"
    return f"已回写多维表格：{'、'.join(fields.keys())}"


def make_bitable_tool(skill) -> StructuredTool:
    """把 bitable 技能编译成 agent 工具：args = record_id + 各映射入参。"""
    config = dict(skill.config or {})
    fmap = config.get("fields") or []
    arg_fields: dict[str, Any] = {"record_id": (str, "")}
    for m in fmap:
        if m.get("arg"):
            arg_fields[m["arg"]] = (str, "")
    Args = create_model(f"bitable_{skill.id}".replace("-", "_"), **arg_fields)

    async def run(**kw: Any) -> str:
        import anyio

        rid = kw.pop("record_id", "")
        return await anyio.to_thread.run_sync(lambda: update_record(config, rid, kw))

    desc = (skill.description or "把对话结论回写到飞书多维表格对应候选人记录") + \
        "。需提供 record_id（候选人记录id）以及要回写的字段值。"
    return StructuredTool.from_function(coroutine=run, name=f"bitable_writeback_{str(skill.id)[:8]}", description=desc, args_schema=Args)
