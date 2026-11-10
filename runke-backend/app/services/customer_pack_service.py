"""客户资源包服务：资源包 = 一条查询规则，成员由规则引擎实时计算（count 亦派生）。

三种类型（系统内置「全部客户」不落库，由前端虚拟项表示）：
- file  ：文件导入批次。成员 = customer_pack_members 中显式关联（批次即资源包本身）
- manual：手动指定。成员 = customer_pack_members 中显式集合
- rule  ：条件筛选。rule={"match":"all|any","conditions":[{field,op,value}]}，成员实时匹配，无显式关联

约定：file/manual 用 join 表存显式成员；rule 不写 join，完全由条件驱动。
"""
import csv
import io
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.tools.crm_tool import normalize_phone
from app.models.customer import Customer
from app.models.customer_pack import CustomerPack, customer_pack_members

# ---------------- 文件导入：表头别名 ----------------
_HEADER_ALIASES: dict[str, list[str]] = {
    "name": ["姓名", "客户姓名", "名字", "name"],
    "phone": ["手机号", "手机", "电话", "联系电话", "phone", "mobile", "tel"],
    "company": ["公司", "单位", "公司名称", "company"],
    "title": ["职务", "职位", "title"],
    "gender": ["性别", "gender"],
    "email": ["邮箱", "邮件", "email"],
    "status": ["状态", "客户状态", "status"],
    "intent": ["意向", "意向等级", "intent"],
    "owner": ["负责人", "owner", "销售"],
    "city": ["城市", "所在城市", "常住地", "city"],
    "summary": ["备注", "摘要", "描述", "remark", "summary", "note"],
    "tags": ["标签", "tags", "tag"],
}
_STATUS_MAP = {"线索": "lead", "意向": "intent", "成交": "deal", "流失": "lost",
               "lead": "lead", "intent": "intent", "deal": "deal", "lost": "lost"}


# ================= 规则引擎 =================
def _cust_field(c: Customer, field: str) -> Any:
    return {
        "status": c.status, "intent": c.intent or "", "stage": c.stage, "owner": c.owner,
        "company": c.company, "name": c.name, "phone": c.phone, "email": c.email,
        "title": c.title, "gender": c.gender, "tags": list(c.tags or []),
    }.get(field)


def _match_one(c: Customer, cond: dict[str, Any]) -> bool:
    field = cond.get("field") or ""
    op = cond.get("op") or "eq"
    val = cond.get("value")
    cur = _cust_field(c, field)
    if field == "tags":
        tags = cur or []
        if op == "contains":
            return val in tags
        if op == "not_contains":
            return val not in tags
        if op == "empty":
            return len(tags) == 0
        if op == "not_empty":
            return len(tags) > 0
        return False
    s = "" if cur is None else str(cur)
    sv = "" if val is None else str(val)
    if op == "eq":
        return s == sv
    if op == "ne":
        return s != sv
    if op == "contains":
        return sv in s
    if op == "not_contains":
        return sv not in s
    if op == "empty":
        return s == ""
    if op == "not_empty":
        return s != ""
    return False


def _match_rule(c: Customer, rule: dict[str, Any]) -> bool:
    conds = (rule or {}).get("conditions") or []
    if not conds:
        return True  # 无条件 = 全部
    results = [_match_one(c, cond) for cond in conds]
    return all(results) if (rule.get("match") or "all") == "all" else any(results)


# ================= 成员解析（统一入口） =================
async def _all_customers(session: AsyncSession, owner_id: uuid.UUID) -> list[Customer]:
    return list((await session.execute(
        select(Customer).where(Customer.owner_id == owner_id).order_by(Customer.updated_at.desc())
    )).scalars().all())


async def _explicit_member_ids(session: AsyncSession, pack_id: uuid.UUID) -> set[uuid.UUID]:
    return set((await session.execute(
        select(customer_pack_members.c.customer_id).where(customer_pack_members.c.pack_id == pack_id)
    )).scalars().all())


async def _owned_pack(session: AsyncSession, pack_id: uuid.UUID, owner_id: uuid.UUID) -> CustomerPack:
    pack = await session.get(CustomerPack, pack_id)
    if pack is None or pack.owner_id != owner_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="资源包不存在")
    return pack


async def resolve_members(session: AsyncSession, pack: CustomerPack, owner_id: uuid.UUID) -> list[Customer]:
    customers = await _all_customers(session, owner_id)
    if pack.kind == "rule":
        return [c for c in customers if _match_rule(c, pack.rule or {})]
    ids = await _explicit_member_ids(session, pack.id)
    return [c for c in customers if c.id in ids]


async def list_pack_member_ids(session: AsyncSession, pack_id: uuid.UUID, owner_id: uuid.UUID) -> list[str]:
    pack = await _owned_pack(session, pack_id, owner_id)
    return [str(c.id) for c in await resolve_members(session, pack, owner_id)]


# ---------------- 导出 Excel ----------------
_EXPORT_COLS = [
    ("name", "姓名"), ("phone", "手机号"), ("company", "公司"), ("title", "职务"),
    ("gender", "性别"), ("email", "邮箱"), ("status", "状态"), ("intent", "意向等级"),
    ("stage", "跟进阶段"), ("owner", "负责人"), ("tags", "标签"), ("summary", "摘要"),
]
_STATUS_LABEL = {"lead": "线索", "intent": "意向", "deal": "成交", "lost": "流失"}


async def export_xlsx(session: AsyncSession, owner_id: uuid.UUID, pack_id: uuid.UUID | None) -> tuple[bytes, str]:
    """导出客户为 .xlsx；pack_id 为空导出全部，否则导出该资源包(规则实时计算)成员。"""
    import io

    import openpyxl

    if pack_id is None:
        customers = await _all_customers(session, owner_id)
        title = "全部客户"
    else:
        pack = await _owned_pack(session, pack_id, owner_id)
        customers = await resolve_members(session, pack, owner_id)
        title = pack.name

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = (title or "客户")[:28]
    ws.append([lbl for _k, lbl in _EXPORT_COLS])
    for c in customers:
        row = []
        for key, _lbl in _EXPORT_COLS:
            if key == "status":
                row.append(_STATUS_LABEL.get(c.status, c.status))
            elif key == "tags":
                row.append("、".join(c.tags or []))
            else:
                row.append(getattr(c, key, "") or "")
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), title


# ================= 资源包 CRUD =================
async def list_packs(session: AsyncSession, owner_id: uuid.UUID) -> list[dict[str, Any]]:
    packs = (await session.execute(
        select(CustomerPack).where(CustomerPack.owner_id == owner_id).order_by(CustomerPack.created_at.desc())
    )).scalars().all()
    customers = await _all_customers(session, owner_id)
    # 显式成员计数（file/manual）一次性聚合
    explicit_counts = dict((await session.execute(
        select(customer_pack_members.c.pack_id, func.count()).group_by(customer_pack_members.c.pack_id)
    )).all())
    out = []
    for p in packs:
        if p.kind == "rule":
            cnt = sum(1 for c in customers if _match_rule(c, p.rule or {}))
        else:
            cnt = int(explicit_counts.get(p.id, 0))
        out.append({"id": str(p.id), "name": p.name, "kind": p.kind, "rule": p.rule or {}, "count": cnt})
    return out


async def create_pack(session: AsyncSession, owner_id: uuid.UUID, *, name: str, kind: str, rule: dict | None = None, customer_ids: list[str] | None = None) -> dict:
    if kind not in ("rule", "manual"):
        raise HTTPException(status_code=400, detail="该接口仅创建条件筛选/手动指定包；文件导入请用 /import")
    pack = CustomerPack(owner_id=owner_id, name=name.strip() or "未命名分组", kind=kind, rule=rule or {})
    session.add(pack)
    await session.flush()
    if kind == "manual" and customer_ids:
        await _add_members(session, pack.id, owner_id, customer_ids)
    await session.commit()
    return {"id": str(pack.id), "name": pack.name, "kind": pack.kind}


async def update_pack(session: AsyncSession, pack_id: uuid.UUID, owner_id: uuid.UUID, *, name: str | None = None, rule: dict | None = None) -> None:
    pack = await _owned_pack(session, pack_id, owner_id)
    if name is not None:
        pack.name = name.strip() or pack.name
    if rule is not None:
        if pack.kind != "rule":
            raise HTTPException(status_code=400, detail="仅条件筛选包可修改规则")
        pack.rule = rule
    await session.commit()


async def delete_pack(session: AsyncSession, pack_id: uuid.UUID, owner_id: uuid.UUID) -> None:
    pack = await _owned_pack(session, pack_id, owner_id)
    await session.delete(pack)  # 成员关联 ON DELETE CASCADE；客户实体保留
    await session.commit()


# ================= 手动指定：成员增删 =================
async def _add_members(session: AsyncSession, pack_id: uuid.UUID, owner_id: uuid.UUID, customer_ids: list[str]) -> int:
    valid = set((await session.execute(
        select(Customer.id).where(Customer.owner_id == owner_id, Customer.id.in_([uuid.UUID(str(i)) for i in customer_ids]))
    )).scalars().all())
    existing = await _explicit_member_ids(session, pack_id)
    rows = [{"pack_id": pack_id, "customer_id": cid} for cid in valid if cid not in existing]
    if rows:
        await session.execute(customer_pack_members.insert(), rows)
    return len(rows)


async def add_members(session: AsyncSession, pack_id: uuid.UUID, owner_id: uuid.UUID, customer_ids: list[str]) -> int:
    pack = await _owned_pack(session, pack_id, owner_id)
    if pack.kind not in ("manual", "file"):
        raise HTTPException(status_code=400, detail="条件筛选包成员由规则决定，不能手动增删")
    n = await _add_members(session, pack_id, owner_id, customer_ids)
    await session.commit()
    return n


async def remove_members(session: AsyncSession, pack_id: uuid.UUID, owner_id: uuid.UUID, customer_ids: list[str]) -> None:
    pack = await _owned_pack(session, pack_id, owner_id)
    if pack.kind not in ("manual", "file"):
        raise HTTPException(status_code=400, detail="条件筛选包成员由规则决定，不能手动增删")
    cids = [uuid.UUID(str(i)) for i in customer_ids]
    await session.execute(
        customer_pack_members.delete().where(
            customer_pack_members.c.pack_id == pack_id, customer_pack_members.c.customer_id.in_(cids)
        )
    )
    await session.commit()


# ================= 文件导入（追加/覆盖） =================
def _build_header_map(headers: list[str]) -> dict[int, str]:
    out: dict[int, str] = {}
    for idx, h in enumerate(headers):
        key = (h or "").strip().lower()
        for field, aliases in _HEADER_ALIASES.items():
            if key in [a.lower() for a in aliases]:
                out[idx] = field
                break
    return out


def _parse_rows(filename: str, raw: bytes) -> list[dict[str, str]]:
    name = (filename or "").lower()
    rows: list[list[str]] = []
    if name.endswith((".xlsx", ".xls")):
        try:
            import openpyxl
        except ImportError as e:  # pragma: no cover
            raise HTTPException(status_code=400, detail="服务器缺少 openpyxl，无法解析 Excel") from e
        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        for r in ws.iter_rows(values_only=True):
            rows.append(["" if c is None else str(c).strip() for c in r])
        wb.close()
    else:
        text = None
        for enc in ("utf-8-sig", "utf-8", "gbk"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            raise HTTPException(status_code=400, detail="无法识别文件编码，请用 UTF-8 或 GBK")
        rows = [[(c or "").strip() for c in row] for row in csv.reader(io.StringIO(text))]

    rows = [r for r in rows if any(c for c in r)]
    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="文件没有数据行（需要表头 + 至少一行）")
    hmap = _build_header_map(rows[0])
    if "name" not in hmap.values() and "phone" not in hmap.values():
        raise HTTPException(status_code=400, detail="未识别到「姓名」或「手机号」列，请检查表头")
    out: list[dict[str, str]] = []
    for r in rows[1:]:
        rec: dict[str, str] = {}
        for idx, field in hmap.items():
            if idx < len(r) and r[idx]:
                rec[field] = r[idx]
        if rec:
            out.append(rec)
    return out


async def _import_upsert_one(session: AsyncSession, owner_id: uuid.UUID, rec: dict[str, str]) -> tuple[Customer | None, bool]:
    name = (rec.get("name") or "").strip()
    phone = normalize_phone(rec.get("phone") or "")
    if not name and not phone:
        return None, False
    norm_phone_col = func.regexp_replace(Customer.phone, r"\D", "", "g")
    cust = None
    if phone:
        cust = (await session.execute(select(Customer).where(Customer.owner_id == owner_id, norm_phone_col == phone))).scalars().first()
    if cust is None and name and not phone:
        cust = (await session.execute(select(Customer).where(Customer.owner_id == owner_id, Customer.name == name))).scalars().first()
    created = cust is None
    if cust is None:
        cust = Customer(owner_id=owner_id, name=name or "未命名客户")
        session.add(cust)
    if name:
        cust.name = name
    if phone:
        cust.phone = phone
    for f in ("company", "title", "gender", "email", "owner"):
        v = (rec.get(f) or "").strip()
        if v:
            setattr(cust, f, v)
    st = _STATUS_MAP.get((rec.get("status") or "").strip())
    if st:
        cust.status = st
    il = (rec.get("intent") or "").strip().upper()
    if il in ("A", "B", "C", "D"):
        cust.intent = il
    tags_raw = (rec.get("tags") or "").strip()
    if tags_raw:
        new_tags = [t.strip() for t in tags_raw.replace("，", ",").replace("；", ",").replace(";", ",").split(",") if t.strip()]
        cust.tags = list(dict.fromkeys(list(cust.tags or []) + new_tags))
    summ = [(rec.get("summary") or "").strip()]
    if (rec.get("city") or "").strip():
        summ.append(f"城市:{rec['city'].strip()}")
    add = "；".join(s for s in summ if s)
    if add and add not in (cust.summary or ""):
        cust.summary = (cust.summary + "；" + add).strip("；") if cust.summary else add
    return cust, created


async def import_customers(
    session: AsyncSession, owner_id: uuid.UUID, filename: str, raw: bytes,
    *, name: str = "", pack_id: uuid.UUID | None = None, mode: str = "append",
) -> dict[str, Any]:
    """文件导入：新建 file 包或编辑已有 file 包；mode=append 追加 / overwrite 覆盖。"""
    records = _parse_rows(filename, raw)
    if pack_id is not None:
        pack = await _owned_pack(session, pack_id, owner_id)
        if pack.kind != "file":
            raise HTTPException(status_code=400, detail="仅文件导入包可再次导入")
        if mode == "overwrite":
            await session.execute(customer_pack_members.delete().where(customer_pack_members.c.pack_id == pack.id))
    else:
        pack = CustomerPack(owner_id=owner_id, name=name.strip() or "导入名单", kind="file")
        session.add(pack)
        await session.flush()

    created = updated = skipped = 0
    member_ids: set[uuid.UUID] = set()
    for rec in records:
        cust, was_created = await _import_upsert_one(session, owner_id, rec)
        if cust is None:
            skipped += 1
            continue
        await session.flush()
        if was_created:
            created += 1
        else:
            updated += 1
        member_ids.add(cust.id)

    if member_ids:
        existing = await _explicit_member_ids(session, pack.id)
        rows = [{"pack_id": pack.id, "customer_id": cid} for cid in member_ids if cid not in existing]
        if rows:
            await session.execute(customer_pack_members.insert(), rows)
    await session.commit()
    return {
        "pack_id": str(pack.id), "pack_name": pack.name, "mode": mode if pack_id else "create",
        "total": len(records), "created": created, "updated": updated, "skipped": skipped,
        "members": len(member_ids),
    }
