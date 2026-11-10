"""内置工具：把对话中核实到的客户信息回写到客户管理(CRM)。

单 Agent 开启「登记到客户管理」能力后挂载；对话中由模型在核实到资质或客户表达意向时调用。
按 phone（优先）/ name 在该 owner 下 upsert 客户，资质明细折叠进摘要 + 一条 AI 跟进记录。
"""
import re
import uuid
from datetime import datetime
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import create_model
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.db import SessionLocal
from app.models.customer import Customer


def normalize_phone(raw: str) -> str:
    """手机号规范化：仅留数字，去掉国码 86 前缀。用于去重匹配与落库。"""
    d = re.sub(r"\D", "", raw or "")
    if len(d) > 11 and d.startswith("86"):
        d = d[2:]
    return d

# 直接落到 Customer 列的字段：参数名 → 列名
_COLUMN_FIELDS = [
    ("phone", "phone"),
    ("company", "company"),
    ("title", "title"),
    ("gender", "gender"),
    ("email", "email"),
]
# 无独立列、折叠进「资质摘要」的纵向字段：参数名 → 展示标签
_DETAIL_FIELDS = [
    ("city", "城市"),
    ("occupation", "职业"),
    ("provident_fund", "公积金"),
    ("has_house", "房产"),
    ("has_car", "车产"),
    ("car_info", "车辆"),
    ("has_overdue", "逾期"),
    ("demand", "需求"),
]
# 工具入参（含必填 name、意向等级、整体摘要）
_FIELDS = (
    [("name", "客户姓名", True)]
    + [(k, lbl, False) for k, lbl in [("phone", "手机号"), ("company", "单位"), ("title", "职务"), ("gender", "性别"), ("email", "邮箱")]]
    + [(k, lbl, False) for k, lbl in _DETAIL_FIELDS]
    + [("intent_level", "意向等级(A/B/C/D)", False), ("summary", "整体摘要", False)]
)


def _merge_summary(old: str, additions: list[str]) -> str:
    """把新核实到的资质片段并入已有摘要，去重、不丢失历史信息。"""
    old = (old or "").strip()
    parts = [p.strip() for p in old.split("；") if p.strip()] if old else []
    seen = set(parts)
    for frag in additions:
        if frag and frag not in seen:
            parts.append(frag)
            seen.add(frag)
    return "；".join(parts)


async def upsert_customer(owner_id: uuid.UUID, agent_name: str, data: dict[str, Any]) -> str:
    """按 phone/name 在该 owner 下查找客户：存在则用对话新信息回写更新，不存在才新建。

    单 Agent 工具与工作流登记节点共用。只用「非空」的新值覆盖对应列，资质明细并入摘要(去重)，
    status 只升不降(已成交/已流失保持不变)。
    """
    name = (data.get("name") or "").strip()
    if not name:
        return "缺少客户姓名，未登记"
    phone = normalize_phone(data.get("phone") or "")
    il = (data.get("intent_level") or "").strip().upper()
    # 纵向资质片段
    detail = [f"{lbl}:{(data.get(k) or '').strip()}" for k, lbl in _DETAIL_FIELDS if (data.get(k) or "").strip()]
    new_summary = (data.get("summary") or "").strip()

    # 规范化手机号表达式（对历史未规范化数据也成立）
    norm_phone_col = func.regexp_replace(Customer.phone, r"\D", "", "g")

    async def _find(s, *, phone_only: bool):
        if phone:
            c = (await s.execute(select(Customer).where(Customer.owner_id == owner_id, norm_phone_col == phone))).scalars().first()
            if c is not None:
                return c
        if phone_only:
            return None
        # 仅在「没有手机号」时退化到按姓名匹配，避免重名误并；有手机号时姓名不作为匹配键
        if not phone:
            return (await s.execute(select(Customer).where(Customer.owner_id == owner_id, Customer.name == name))).scalars().first()
        return None

    def _apply(cust: Customer, created: bool):
        if not created:
            cust.name = name  # 名字也允许在已有记录上修正
        if phone:
            cust.phone = phone  # 落库统一存规范化手机号
        for arg, col in _COLUMN_FIELDS:
            if arg == "phone":
                continue
            v = (data.get(arg) or "").strip()
            if v and getattr(cust, col, "") != v:
                setattr(cust, col, v)
        if il in ("A", "B", "C", "D"):
            cust.intent = il
        # status 只升不降；已成交/已流失不动
        if cust.status not in ("deal", "lost"):
            cust.status = "intent"
            cust.stage = "需求确认"
        if agent_name:
            cust.agent = agent_name
            cust.agent_type = "phone"
        additions = ([new_summary] if new_summary else []) + detail
        merged = _merge_summary(cust.summary, additions)
        if merged:
            cust.summary = merged
        note = new_summary or "；".join(detail) or "电话核实"
        recs = list(cust.records or [])
        recs.append({"type": "ai", "text": ("更新：" if not created else "") + note, "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
        cust.records = recs

    async with SessionLocal() as s:
        cust = await _find(s, phone_only=False)
        created = cust is None
        if cust is None:
            cust = Customer(owner_id=owner_id, name=name)
            s.add(cust)
        _apply(cust, created)
        try:
            await s.commit()
        except IntegrityError:
            # 并发下另一调用已抢先建好同手机号客户：回滚→按手机号重查→改为更新
            await s.rollback()
            cust = await _find(s, phone_only=True)
            if cust is None:
                raise
            _apply(cust, created=False)
            await s.commit()
            created = False
    verb = "登记" if created else "更新"
    return f"已{verb}客户「{name}」到客户管理。"


def make_crm_register_tool(owner_id: uuid.UUID, agent_name: str = "") -> StructuredTool:
    fields: dict[str, Any] = {k: (str, ... if req else "") for k, _lbl, req in _FIELDS}
    Args = create_model("register_customer_args", **fields)

    async def run(**kw: Any) -> str:
        return await upsert_customer(owner_id, agent_name, kw)

    return StructuredTool.from_function(
        coroutine=run,
        name="register_customer",
        description=(
            "把对话中核实到的客户信息回写「客户管理」：系统按手机号/姓名自动匹配，"
            "已存在则更新（只覆盖你这次提供的非空字段，其余保留），不存在才新建客户。"
            "当核实到任意客户信息（手机/单位/职务/性别/邮箱/城市/职业/公积金/房产/车产/逾期/需求等）"
            "或客户表达意向时调用；可多次调用持续补全。姓名必填，其余只填你确认到的，其余留空。"
        ),
        args_schema=Args,
    )
