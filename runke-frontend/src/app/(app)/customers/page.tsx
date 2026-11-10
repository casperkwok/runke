"use client";

/* 客户管理（移植自 Runke产品原型）。数据接真实后端 /customers。
   跟进记录/标签/AI 标记内嵌于客户，整体保存（PATCH）。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { IcChevDown, IcCheck, IcClose, IcPencil, IcPlus, IcTrash, Svg, type IcProps } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { SelectBox } from "@/components/rk/Select";
import { api, exportCustomers, importCustomerPack } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import {
  CUST_STATUS,
  CUST_STATUS_DEFS,
  FOLLOW_STAGES,
  INTENT_DEFS,
  INTENT_LV,
  type CustStatus,
} from "@/lib/rk/data";

type Customer = components["schemas"]["CustomerOut"];
interface CustRecord { type: string; text: string; time: string }
interface PackCond { field: string; op: string; value: string }
interface PackRule { match?: "all" | "any"; conditions?: PackCond[] }
interface Pack { id: string; name: string; kind: string; count: number; rule?: PackRule }

const CIcUsers = (p: IcProps) => <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.3a3 3 0 0 1 0 5.4M17.5 14.6a5.5 5.5 0 0 1 3 4.4" /></Svg>;
const CIcPhone = (p: IcProps) => <Svg {...p}><path d="M6 4h3l1.5 4-2 1.3a11 11 0 0 0 4.2 4.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6 4Z" /></Svg>;
const CIcChat = (p: IcProps) => <Svg {...p}><path d="M5 5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3V6a1 1 0 0 1 1-1Z" /></Svg>;
const CIcUpload = (p: IcProps) => <Svg {...p}><path d="M12 16V5m0 0L8 9m4-4 4 4" /><path d="M5 19h14" /></Svg>;
const CIcDownload = (p: IcProps) => <Svg {...p}><path d="M12 5v11m0 0 4-4m-4 4-4-4" /><path d="M5 19h14" /></Svg>;
const CIcFilter = (p: IcProps) => <Svg {...p}><path d="M4 5h16l-6 7v6l-4-2v-4L4 5Z" /></Svg>;
const CIcGroup = (p: IcProps) => <Svg {...p}><path d="M4 7a1 1 0 0 1 1-1h3.5l1.5 1.6H19a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" /></Svg>;
const CIcCollapse = (p: IcProps) => <Svg {...p}><path d="m14 6-6 6 6 6" /></Svg>;
const CIcSearch = (p: IcProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></Svg>;
const CIcUserMini = () => <Svg s={13} style={{ color: "var(--ink-2)" }}><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></Svg>;
const packIcon = (kind: string) => (kind === "rule" ? CIcFilter : kind === "manual" ? CIcGroup : CIcUpload);
const PACK_KIND_LABEL: Record<string, string> = { file: "文件导入", rule: "条件筛选", manual: "手动指定" };

const AiBadge = () => <span className="ai-badge">AI</span>;
const Avatar = ({ name, color }: { name: string; color?: string }) => (
  <span className="cust-av" style={{ background: color || "#EEF1F8", color: "#5A6275" }}>{name.slice(0, 1)}</span>
);
const StatusPill = ({ s }: { s: string }) => {
  const t = CUST_STATUS[s as CustStatus] ?? CUST_STATUS.lead;
  return <span className="cust-pill" style={{ color: t.color, background: t.soft }}><span className="dot" style={{ background: t.color }} />{t.label}</span>;
};
const IntentTag = ({ lv }: { lv: string | null }) => {
  if (!lv) return <span className="muted">–</span>;
  const t = INTENT_LV[lv];
  return <span className="intent-ring" style={{ color: t.color, borderColor: t.color }}>{lv}</span>;
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}\n${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function MiniSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return <SelectBox small value={value} onChange={onChange} options={options} />;
}

export default function CustomersPage() {
  const [tab, setTab] = useState<"list" | "field">("list");
  return (
    <div className="cust-root">
      <div className="cust-tabs-bar">
        <button className={"cust-tab" + (tab === "list" ? " on" : "")} onClick={() => setTab("list")}>客户列表</button>
        <button className={"cust-tab" + (tab === "field" ? " on" : "")} onClick={() => setTab("field")}>字段配置</button>
      </div>
      {tab === "list" ? <CustomerList /> : <FieldConfig />}
    </div>
  );
}

function CustomerList() {
  const qc = useQueryClient();
  const [activePack, setActivePack] = useState("all");
  const { data: packs = [] } = useQuery({
    queryKey: ["customer-packs"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/customers/packs");
      if (error) throw error;
      return data.data as unknown as Pack[];
    },
  });
  const refreshPacks = () => { qc.invalidateQueries({ queryKey: ["customer-packs"] }); qc.invalidateQueries({ queryKey: ["customers"] }); };
  const delPack = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/v1/customers/packs/{pack_id}", { params: { path: { pack_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => { setActivePack("all"); refreshPacks(); },
  });
  const addMembers = useMutation({
    mutationFn: async ({ packId, ids }: { packId: string; ids: string[] }) => {
      const { error } = await api.POST("/api/v1/customers/packs/{pack_id}/members", { params: { path: { pack_id: packId } }, body: { customer_ids: ids } });
      if (error) throw error;
    },
    onSuccess: refreshPacks,
  });
  const removeMembers = useMutation({
    mutationFn: async ({ packId, ids }: { packId: string; ids: string[] }) => {
      const { error } = await api.DELETE("/api/v1/customers/packs/{pack_id}/members", { params: { path: { pack_id: packId } }, body: { customer_ids: ids } });
      if (error) throw error;
    },
    onSuccess: refreshPacks,
  });
  const [status, setStatus] = useState("全部");
  const [stage, setStage] = useState("全部");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);          // 新建资源包·类型选择
  const [importPack, setImportPack] = useState<Pack | "new" | null>(null);  // 文件导入(new)/重新导入(已有包)
  const [editPack, setEditPack] = useState<Pack | null>(null);  // 重命名/改规则
  const [addCust, setAddCust] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());  // 列表多选
  const [batchAdd, setBatchAdd] = useState(false);               // 批量加入手动包
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const activeObj = packs.find((p) => p.id === activePack) ?? null;

  const { data: allCustomers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/customers");
      if (error) throw error;
      return data.data as Customer[];
    },
  });
  const { data: packCustomers } = useQuery({
    queryKey: ["customers", activePack],
    enabled: activePack !== "all",
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/customers", { params: { query: { pack_id: activePack } } });
      if (error) throw error;
      return data.data as Customer[];
    },
  });
  const allList = allCustomers ?? [];
  const list = activePack === "all" ? allList : (packCustomers ?? []);
  const sel = list.find((c) => c.id === selId) ?? null;

  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: components["schemas"]["CustomerUpdate"] }) => {
      const { error } = await api.PATCH("/api/v1/customers/{cid}", { params: { path: { cid: id } }, body });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
  const create = useMutation({
    mutationFn: async (body: components["schemas"]["CustomerCreate"]) => {
      const { error } = await api.POST("/api/v1/customers", { body });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });

  const filtered = list.filter(
    (c) =>
      (status === "全部" || (CUST_STATUS[c.status as CustStatus]?.label ?? "") === status) &&
      (stage === "全部" || c.stage === stage) &&
      (!q || c.name.includes(q) || c.phone.includes(q) || (c.company || "").includes(q)),
  );

  const saveCustomer = (u: Customer) =>
    patch.mutate({
      id: u.id,
      body: {
        name: u.name, phone: u.phone, company: u.company, title: u.title, gender: u.gender, email: u.email,
        status: u.status, intent: u.intent, agent: u.agent, agent_type: u.agent_type, stage: u.stage,
        owner: u.owner, summary: u.summary, tags: u.tags, ai: u.ai, records: u.records,
      },
    });

  return (
    <div className="cust-list-wrap">
      {!collapsed ? (
        <div className="cust-dir">
          <div className="cust-dir-head"><b>客户目录</b><button className="icon-btn" onClick={() => setCollapsed(true)}><CIcCollapse s={16} style={{ color: "var(--ink-3)" }} /></button></div>
          <button className={"dir-all" + (activePack === "all" ? " on" : "")} onClick={() => setActivePack("all")}>
            <CIcUsers s={19} /> <span>全部客户</span> <b className="dir-count">{allList.length}</b>
          </button>
          <div className="dir-section" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>资源包</span>
            <button className="dir-add" title="新建资源包" onClick={() => setCreateOpen(true)}><IcPlus s={14} sw={2} style={{ color: "var(--ink-3)" }} /></button>
          </div>
          {packs.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, padding: "4px 12px 8px" }}>点 + 新建：文件导入 / 条件筛选 / 手动指定</div>
          ) : (
            <div className="dir-packs">
              {packs.map((p) => {
                const Ic = packIcon(p.kind);
                return (
                  <button key={p.id} className={"dir-pack" + (activePack === p.id ? " on" : "")} onClick={() => setActivePack(p.id)}>
                    <Ic s={18} style={{ color: "var(--ink-3)" }} />
                    <span className="dir-pack-text"><b>{p.name}</b><i>{PACK_KIND_LABEL[p.kind] ?? p.kind} · {p.count} 人</i></span>
                    <span className="dir-pack-del" role="button" title="编辑" onClick={(e) => { e.stopPropagation(); setEditPack(p); }}><IcPencil s={14} style={{ color: "var(--ink-3)" }} /></span>
                    <span className="dir-pack-del" role="button" title="删除资源包" onClick={(e) => { e.stopPropagation(); if (confirm(`删除资源包「${p.name}」？（客户本身保留）`)) delPack.mutate(p.id); }}><IcTrash s={14} style={{ color: "var(--ink-3)" }} /></span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <button className="cust-dir-collapsed" onClick={() => setCollapsed(false)}><CIcUsers s={20} style={{ color: "var(--ink-2)" }} /></button>
      )}

      <div className="cust-main">
        <div className="cust-toolbar">
          <div className="cust-filter"><span className="cf-lbl">状态</span><MiniSelect value={status} onChange={setStatus} options={["全部", "线索", "意向", "成交", "流失"]} /></div>
          <div className="cust-filter"><span className="cf-lbl">跟进阶段</span><MiniSelect value={stage} onChange={setStage} options={["全部", ...FOLLOW_STAGES]} /></div>
          <div className="cust-search"><CIcSearch s={18} /><input placeholder="搜索客户姓名、公司或手机号" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn-outline" title={activeObj ? `导出「${activeObj.name}」` : "导出全部客户"} onClick={() => exportCustomers(activePack === "all" ? undefined : activePack).catch((e) => alert(e instanceof Error ? e.message : "导出失败"))}><CIcDownload s={16} style={{ color: "var(--ink-2)" }} /> 导出</button>
          <button className="btn-create" onClick={() => setAddCust(true)}><IcPlus s={17} sw={2.2} style={{ color: "#fff" }} /> 添加新客户</button>
        </div>
        <div className={"cust-actionbar" + (picked.size > 0 ? " batch" : "")}>
          {picked.size > 0 ? (
            <>
              <span><b>{picked.size}</b> 项已选</span>
              <button className="link-blue" onClick={() => setBatchAdd(true)}>加入手动分组</button>
              {activeObj?.kind === "manual" && <button className="link-blue" onClick={() => { removeMembers.mutate({ packId: activeObj.id, ids: [...picked] }); setPicked(new Set()); }}>移出本包</button>}
              <button className="link-muted" onClick={() => setPicked(new Set())}>清空选择</button>
            </>
          ) : (
            <span>共 <b>{filtered.length}</b> 个客户{activeObj && <span className="muted">（{PACK_KIND_LABEL[activeObj.kind]}{activeObj.kind === "rule" ? "·成员按规则实时计算" : ""}）</span>}</span>
          )}
        </div>
        <div className="cust-table">
          <div className="ct-head">
            <span className="ct-head-info">
              {(() => { const allOn = filtered.length > 0 && filtered.every((c) => picked.has(c.id)); const some = filtered.some((c) => picked.has(c.id)); return (
                <span className={"ct-check" + (allOn ? " on" : some ? " some" : "")} role="checkbox" aria-checked={allOn} title={allOn ? "取消全选" : "全选"} onClick={() => setPicked(allOn ? new Set() : new Set(filtered.map((c) => c.id)))}>{allOn ? <IcCheck s={12} sw={2.6} style={{ color: "#fff" }} /> : some ? <span className="ct-check-dash" /> : null}</span>
              ); })()}
              客户信息
            </span><span>手机号</span><span>状态</span><span>意向</span><span>最后触达智能体</span><span>跟进阶段</span><span>负责人</span><span>更新时间</span>
          </div>
          <div className="ct-body">
            {filtered.length === 0 && <div className="muted" style={{ padding: "28px 20px", fontSize: 13 }}>暂无客户，点右上角「添加新客户」。</div>}
            {filtered.map((c) => {
              const named = !/^\d+$/.test(c.name);
              return (
                <div className={"ct-row" + (sel && sel.id === c.id ? " active" : "") + (picked.has(c.id) ? " picked" : "")} key={c.id} onClick={() => setSelId(c.id)}>
                  <span className="ct-info">
                    <span className={"ct-check" + (picked.has(c.id) ? " on" : "")} role="checkbox" aria-checked={picked.has(c.id)} onClick={(e) => { e.stopPropagation(); togglePick(c.id); }}>{picked.has(c.id) && <IcCheck s={12} sw={2.6} style={{ color: "#fff" }} />}</span>
                    {named ? <Avatar name={c.name} /> : <span className="ct-phone-ic"><CIcPhone s={18} style={{ color: "var(--ink-3)" }} /></span>}
                    <span className="ct-id">{named ? <><b>{c.name}</b><i>{c.phone}</i></> : <b className="mono">{c.name}</b>}</span>
                  </span>
                  <span className="muted mono">{c.phone}</span>
                  <span><StatusPill s={c.status} /></span>
                  <span><IntentTag lv={c.intent} /></span>
                  <span className="ct-agent">{c.agent ? <><span className="agent-ic">{c.agent_type === "chat" ? <CIcChat s={15} style={{ color: "#1FA85A" }} /> : <CIcPhone s={15} style={{ color: "#2D6FF7" }} />}</span>{c.agent}</> : <span className="muted">–</span>}</span>
                  <span className="muted">{c.stage}</span>
                  <span>{c.owner ? <span className="ct-owner"><Avatar name={c.owner} />{c.owner}</span> : <span className="muted">–</span>}</span>
                  <span className="muted ct-time" style={{ whiteSpace: "pre-line" }}>{fmtTime(c.updated_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {sel && <CustomerDrawer customer={sel} onClose={() => setSelId(null)} onSave={saveCustomer} />}
      {createOpen && (
        <CreatePackChooser
          onClose={() => setCreateOpen(false)}
          onFile={() => { setCreateOpen(false); setImportPack("new"); }}
          onRule={() => { setCreateOpen(false); setEditPack({ id: "", name: "", kind: "rule", count: 0, rule: { match: "all", conditions: [{ field: "status", op: "eq", value: "intent" }] } }); }}
          onManual={() => { setCreateOpen(false); setEditPack({ id: "", name: "", kind: "manual", count: 0 }); }}
        />
      )}
      {importPack !== null && (
        <ResourcePackModal
          pack={importPack === "new" ? null : importPack}
          onClose={() => setImportPack(null)}
          onImported={refreshPacks}
        />
      )}
      {editPack && (
        <EditPackModal
          pack={editPack}
          onClose={() => setEditPack(null)}
          onReimport={(p) => { setEditPack(null); setImportPack(p); }}
          onSaved={(id) => { setEditPack(null); refreshPacks(); if (id) setActivePack(id); }}
        />
      )}
      {batchAdd && (
        <BatchAddModal
          packs={packs.filter((p) => p.kind === "manual")}
          onClose={() => setBatchAdd(false)}
          onAdd={async (packId) => { await addMembers.mutateAsync({ packId, ids: [...picked] }); setPicked(new Set()); setBatchAdd(false); }}
          onCreate={async (name) => {
            const { data, error } = await api.POST("/api/v1/customers/packs", { body: { name, kind: "manual", customer_ids: [...picked] } });
            if (error) throw error;
            setPicked(new Set()); setBatchAdd(false); refreshPacks();
            return (data.data as { id: string }).id;
          }}
        />
      )}
      {addCust && (
        <AddCustomerModal
          onClose={() => setAddCust(false)}
          onConfirm={(c) => {
            create.mutate({ name: c.name, phone: c.phone, company: c.company, status: c.status, owner: c.owner, stage: "线索生成" });
            setAddCust(false);
          }}
        />
      )}
    </div>
  );
}

function CustomerDrawer({ customer: c, onClose, onSave }: { customer: Customer; onClose: () => void; onSave: (c: Customer) => void }) {
  const t = CUST_STATUS[c.status as CustStatus] ?? CUST_STATUS.lead;
  const records = (c.records as CustRecord[]) ?? [];
  const tags = (c.tags as string[]) ?? [];
  const ai = (c.ai as Record<string, boolean>) ?? {};
  const [newRecord, setNewRecord] = useState("");
  const [adding, setAdding] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editRec, setEditRec] = useState(-1);
  const [recDraft, setRecDraft] = useState("");
  const owners = ["陈销售", "林运营", "王主管"];
  const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

  const addRecord = () => {
    if (!newRecord.trim()) { setAdding(false); return; }
    onSave({ ...c, records: [...records, { type: "human", text: newRecord.trim(), time: now() }] });
    setNewRecord(""); setAdding(false);
  };
  const delRecord = (i: number) => onSave({ ...c, records: records.filter((_, j) => j !== i) });
  const saveRecord = (i: number) => { onSave({ ...c, records: records.map((r, j) => (j === i ? { ...r, text: recDraft } : r)) }); setEditRec(-1); };
  const startEdit = (key: string, cur: string) => { setEditKey(key); setDraft(cur === "–" ? "" : cur); };
  const commit = (key: string) => {
    const nai = { ...ai };
    if (nai[key]) delete nai[key];
    onSave({ ...c, [key]: draft.trim(), ai: nai } as Customer);
    setEditKey(null);
  };

  const Field = ({ label, fkey, value, aiFlag, copy, last }: { label: string; fkey: string; value: string; aiFlag?: boolean; copy?: boolean; last?: boolean }) => {
    const editing = editKey === fkey;
    return (
      <div className={"df-row" + (last ? " last" : "")}>
        <span className="df-label">{label}</span>
        {editing ? (
          <input className="df-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commit(fkey); if (e.key === "Escape") setEditKey(null); }} onBlur={() => commit(fkey)} />
        ) : (
          <span className="df-value">{value}</span>
        )}
        <span className="df-actions">
          {aiFlag && !editing && <AiBadge />}
          {copy && !editing && <button className="df-ic" title="复制" onClick={() => navigator.clipboard?.writeText(value)}><Svg s={15} style={{ color: "var(--ink-3)" }}><rect x="8" y="8" width="12" height="12" rx="2.2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg></button>}
          {editing ? (
            <button className="df-ic ok" title="保存" onMouseDown={(e) => { e.preventDefault(); commit(fkey); }}><IcCheck s={16} sw={2.2} style={{ color: "#1FA85A" }} /></button>
          ) : (
            <button className="df-ic" title="编辑" onClick={() => startEdit(fkey, value)}><IcPencil s={15} style={{ color: "var(--ink-3)" }} /></button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="cust-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cd-head">
          <Avatar name={c.name} color="#E3E9FF" />
          <div className="cd-head-id"><b>{c.name}</b><i>{c.company || c.phone}</i></div>
          <button className="icon-btn" onClick={onClose}><IcClose s={20} style={{ color: "var(--ink-3)" }} /></button>
        </div>
        <div className="cd-scroll">
          <div className="cd-chips">
            <StatusPill s={c.status} />
            {c.intent && <span className="intent-pill" style={{ color: INTENT_LV[c.intent].color, borderColor: INTENT_LV[c.intent].color }}>{INTENT_LV[c.intent].label}</span>}
            {c.agent && <span className="cd-agent-chip">{c.agent_type === "chat" ? <CIcChat s={15} style={{ color: "#1FA85A" }} /> : <CIcPhone s={15} style={{ color: "#2D6FF7" }} />}{c.agent}</span>}
          </div>
          {c.summary && <div className="cd-ai-summary"><AiBadge />{c.summary}</div>}

          <div className="cd-sec-title">基本信息</div>
          <div className="cd-group">
            <Field label="姓名" fkey="name" value={c.name} />
            <Field label="公司" fkey="company" value={c.company || "–"} aiFlag={ai.company} />
            <Field label="职位" fkey="title" value={c.title || "–"} aiFlag={ai.title} />
            <Field label="性别" fkey="gender" value={c.gender || "–"} last />
          </div>

          <div className="cd-sec-title">联系方式</div>
          <div className="cd-group">
            <Field label="手机号" fkey="phone" value={c.phone} aiFlag={ai.phone} copy />
            <Field label="邮箱" fkey="email" value={c.email || "–"} copy last />
          </div>

          <div className="cd-sec-title">关联员工</div>
          <div className="cd-group">
            <div className="df-row last emp-row">
              {editKey === "owner" ? (
                <SelectBox block value={c.owner || ""} ph="未分配" options={[{ value: "", label: "未分配" }, ...owners.map((o) => ({ value: o }))]} onChange={(v) => { onSave({ ...c, owner: v }); setEditKey(null); }} />
              ) : (
                <span className="emp-info">{c.owner ? <><Avatar name={c.owner} /><b>{c.owner}</b></> : <span className="muted">未分配</span>}</span>
              )}
              {editKey !== "owner" && <button className="df-ic" onClick={() => setEditKey("owner")}><IcPencil s={15} style={{ color: "var(--ink-3)" }} /></button>}
            </div>
          </div>

          <div className="cd-sec-title">状态和标签</div>
          <div className="cd-group">
            <div className="df-row">
              <span className="df-label">状态</span>
              {editKey === "status" ? (
                <SelectBox block value={c.status} options={Object.entries(CUST_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} onChange={(v) => { onSave({ ...c, status: v }); setEditKey(null); }} />
              ) : <span className="df-value"><StatusPill s={c.status} /></span>}
              {editKey !== "status" && <button className="df-ic" onClick={() => setEditKey("status")}><IcPencil s={15} style={{ color: "var(--ink-3)" }} /></button>}
            </div>
            <div className="df-row last">
              <span className="df-label">标签</span>
              <span className="df-value tags">
                {tags.map((tg) => <span key={tg} className="cd-tag">{tg}<button className="tag-x" onClick={() => onSave({ ...c, tags: tags.filter((x) => x !== tg) })}><IcClose s={11} sw={2.2} style={{ color: "var(--ink-3)" }} /></button></span>)}
                {editKey === "tag" ? (
                  <input className="tag-add-input" autoFocus value={draft} placeholder="标签名" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { onSave({ ...c, tags: [...tags, draft.trim()] }); setDraft(""); setEditKey(null); } if (e.key === "Escape") setEditKey(null); }} onBlur={() => { if (draft.trim()) onSave({ ...c, tags: [...tags, draft.trim()] }); setDraft(""); setEditKey(null); }} />
                ) : <button className="tag-add" onClick={() => { setDraft(""); setEditKey("tag"); }}><IcPlus s={13} sw={2} /> 标签</button>}
              </span>
            </div>
          </div>

          <div className="cd-sec-title row-between">跟进记录 <button className="cd-add-rec" onClick={() => setAdding(true)}><IcPlus s={15} /> 添加</button></div>
          <div className="cd-records">
            {records.map((r, i) => (
              <div className={"rec-card" + (r.type === "ai" ? " ai" : "") + (editRec === i ? " editing" : "")} key={i}>
                <div className="rec-head">
                  {r.type === "ai" ? <><AiBadge /><b>AI 记录</b></> : <><span className="rec-human"><CIcUserMini /></span><b>人工记录</b></>}
                  {r.type === "human" && editRec !== i && <span className="rec-ops"><button className="df-ic" onClick={() => { setEditRec(i); setRecDraft(r.text); }}><IcPencil s={14} style={{ color: "var(--ink-3)" }} /></button><button className="df-ic" onClick={() => delRecord(i)}><IcTrash s={14} style={{ color: "var(--ink-3)" }} /></button></span>}
                </div>
                {editRec === i ? (
                  <>
                    <textarea autoFocus value={recDraft} onChange={(e) => setRecDraft(e.target.value)} />
                    <div className="rec-edit-foot"><button className="btn-text sm" onClick={() => setEditRec(-1)}>取消</button><button className="btn-primary sm" onClick={() => saveRecord(i)}>保存</button></div>
                  </>
                ) : (
                  <>
                    <div className="rec-text">{r.text}</div>
                    <div className="rec-time">{r.time}</div>
                  </>
                )}
              </div>
            ))}
            {adding && (
              <div className="rec-card editing">
                <textarea autoFocus value={newRecord} onChange={(e) => setNewRecord(e.target.value)} placeholder="补充一条跟进记录…" />
                <div className="rec-edit-foot"><button className="btn-text sm" onClick={() => { setAdding(false); setNewRecord(""); }}>取消</button><button className="btn-primary sm" onClick={addRecord}>保存</button></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldConfig() {
  const [sub, setSub] = useState<"status" | "intent">("status");
  const [statuses, setStatuses] = useState(CUST_STATUS_DEFS);
  const [intents, setIntents] = useState(INTENT_DEFS);
  return (
    <div className="field-config">
      <div className="fc-seg">
        <button className={"fc-seg-btn" + (sub === "status" ? " on" : "")} onClick={() => setSub("status")}>客户状态</button>
        <button className={"fc-seg-btn" + (sub === "intent" ? " on" : "")} onClick={() => setSub("intent")}>意向等级</button>
      </div>
      <div className="fc-note">{sub === "status" ? "客户状态用于区分客户所处的销售阶段。系统内置的状态无法删除，但可以修改名称和颜色。" : "意向等级用于标记客户的成交可能性。系统内置等级无法删除，但可以修改名称、颜色和说明。"}</div>
      <div className="fc-cards">
        {sub === "status"
          ? statuses.map((s, i) => {
              const t = CUST_STATUS[s.key as CustStatus];
              return <FcCard key={s.key} pill={<span className="cust-pill" style={{ color: t.color, background: t.soft }}><span className="dot" style={{ background: t.color }} />{t.label}</span>} desc={s.desc} system={s.system} onDelete={() => setStatuses((st) => st.filter((_, j) => j !== i))} />;
            })
          : intents.map((s, i) => {
              const t = INTENT_LV[s.key];
              return <FcCard key={s.key} pill={<span className="intent-pill" style={{ color: t.color, borderColor: t.color }}>{t.label}</span>} desc={s.desc} system={s.system} onDelete={() => setIntents((it) => it.filter((_, j) => j !== i))} />;
            })}
        <button className="fc-add" onClick={() => (sub === "status" ? setStatuses((st) => [...st, { key: "custom" + Date.now(), desc: "自定义状态说明", system: false }]) : setIntents((it) => [...it, { key: "E" + Date.now(), desc: "自定义等级说明", system: false }]))}><IcPlus s={17} /> 添加{sub === "status" ? "状态" : "等级"}</button>
      </div>
    </div>
  );
}

function FcCard({ pill, desc, system, onDelete }: { pill: React.ReactNode; desc: string; system: boolean; onDelete: () => void }) {
  return (
    <div className="fc-card">
      <div className="fc-pill">{pill}</div>
      <div className="fc-desc">{desc}</div>
      <div className="fc-card-ops">
        <button className="df-ic"><IcPencil s={16} style={{ color: "var(--ink-2)" }} /></button>
        {system ? <span className="fc-sys">系统</span> : <button className="df-ic" onClick={onDelete}><IcTrash s={16} style={{ color: "var(--ink-3)" }} /></button>}
      </div>
    </div>
  );
}

type ImportResult = { pack_name: string; total: number; created: number; updated: number; skipped: number; members: number };

function ResourcePackModal({ pack, onClose, onImported }: { pack: Pack | null; onClose: () => void; onImported: () => void }) {
  const editing = pack !== null;
  const [name, setName] = useState(pack?.name ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"append" | "overwrite">("append");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    if (!f) return;
    setFile(f);
    setErr("");
    if (!name.trim()) setName(f.name.replace(/\.(csv|xlsx|xls)$/i, ""));
  };

  const submit = async () => {
    if (!file || !name.trim()) return;
    if (editing && mode === "overwrite" && !confirm(`覆盖导入将清空资源包「${pack!.name}」现有的 ${pack!.count} 位成员，以新文件内容重建。确定继续？`)) return;
    setBusy(true); setErr("");
    try {
      const data = await importCustomerPack(name.trim(), file, editing ? { packId: pack!.id, mode } : undefined);
      setResult(data as ImportResult);
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <RkModal title="导入完成" w={520} onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>完成</button>}>
        <div className="imp-done">
          <div className="imp-done-t">资源包「{result.pack_name}」已生成，共 {result.members} 位客户</div>
          <div className="imp-stats">
            <div className="imp-stat"><b>{result.total}</b><i>解析行数</i></div>
            <div className="imp-stat ok"><b>{result.created}</b><i>新建</i></div>
            <div className="imp-stat upd"><b>{result.updated}</b><i>更新(去重)</i></div>
            <div className="imp-stat skip"><b>{result.skipped}</b><i>跳过(无效)</i></div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>同手机号客户已自动合并去重，仅更新非空字段。</div>
        </div>
      </RkModal>
    );
  }

  return (
    <RkModal title={editing ? `重新导入 · ${pack!.name}` : "新建资源包 · 文件导入"} w={620} onClose={onClose}
      footer={<><button className="btn-text" onClick={onClose}>取消</button><button className={"btn-primary" + (name.trim() && file && !busy ? "" : " dis")} disabled={!name.trim() || !file || busy} onClick={submit}>{busy ? "导入中…" : "开始导入"}</button></>}>
      <div className="fld-lbl">资源包名称 <span className="req">*</span></div>
      <div className="fld-wrap"><input className="fld" maxLength={20} placeholder="请输入资源包名称" value={name} onChange={(e) => setName(e.target.value)} disabled={editing} /><span className="fld-count">{name.length}/20</span></div>
      <div className="fld-lbl" style={{ marginTop: 16 }}>客户文件 <span className="req">*</span></div>
      <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      <button className="rp-drop" onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] ?? null); }}>
        <CIcUpload s={34} style={{ color: "var(--ink-3)" }} />
        <div className="rp-drop-t">{file ? file.name : "点击或拖拽上传 CSV / Excel"}</div>
        <div className="rp-drop-s">{file ? "已选择，点「开始导入」" : "支持 .xlsx, .xls, .csv；表头需含「姓名」或「手机号」"}</div>
      </button>
      {editing && (
        <>
          <div className="fld-lbl" style={{ marginTop: 16 }}>导入方式</div>
          <div className="rp-radio-group">
            <label className={"rp-radio" + (mode === "append" ? " on" : "")} onClick={() => setMode("append")}><span className="rp-dot" /><span><b>追加新客户</b><i>新客户新增、已存在的更新字段，原有成员保留</i></span></label>
            <label className={"rp-radio" + (mode === "overwrite" ? " on" : "")} onClick={() => setMode("overwrite")}><span className="rp-dot" /><span><b>覆盖现有名单</b><i>清空本包现有成员，以新文件内容重建</i></span></label>
          </div>
        </>
      )}
      <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>可识别列：姓名 / 手机号 / 公司 / 职务 / 性别 / 邮箱 / 城市 / 状态 / 意向 / 负责人 / 标签 / 备注。导入时按手机号自动去重，已存在则更新。</div>
      {err && <div style={{ color: "var(--danger, #E5484D)", fontSize: 13, marginTop: 10 }}>{err}</div>}
    </RkModal>
  );
}

/* ---------- 新建资源包：类型选择 ---------- */
function CreatePackChooser({ onClose, onFile, onRule, onManual }: { onClose: () => void; onFile: () => void; onRule: () => void; onManual: () => void }) {
  return (
    <RkModal title="新建资源包" w={620} onClose={onClose} footer={<button className="btn-text" onClick={onClose}>取消</button>}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>每个资源包是一条查询规则，成员由规则实时计算。选择规则的定义方式：</div>
      <div className="pack-type-pick">
        <button className="pack-type-card" onClick={onFile}><CIcUpload s={26} style={{ color: "#2D6FF7" }} /><b>文件导入</b><i>上传 CSV/Excel，按导入批次成包</i></button>
        <button className="pack-type-card" onClick={onRule}><CIcFilter s={26} style={{ color: "#7A2BF5" }} /><b>条件筛选</b><i>设条件(标签/意向/状态…)动态匹配</i></button>
        <button className="pack-type-card" onClick={onManual}><CIcGroup s={26} style={{ color: "#1FA85A" }} /><b>手动指定</b><i>手动勾选客户组成固定名单</i></button>
      </div>
    </RkModal>
  );
}

/* ---------- 编辑资源包：重命名 / 改规则 / 重新导入 ---------- */
const RULE_FIELDS: { key: string; label: string; type: "select" | "text"; options?: { v: string; l: string }[] }[] = [
  { key: "status", label: "客户状态", type: "select", options: [{ v: "lead", l: "线索" }, { v: "intent", l: "意向" }, { v: "deal", l: "成交" }, { v: "lost", l: "流失" }] },
  { key: "intent", label: "意向等级", type: "select", options: [{ v: "A", l: "A" }, { v: "B", l: "B" }, { v: "C", l: "C" }, { v: "D", l: "D" }] },
  { key: "stage", label: "跟进阶段", type: "text" },
  { key: "tags", label: "标签", type: "text" },
  { key: "company", label: "公司", type: "text" },
  { key: "owner", label: "负责人", type: "text" },
];
const RULE_OPS_TEXT = [{ v: "eq", l: "等于" }, { v: "ne", l: "不等于" }, { v: "contains", l: "包含" }, { v: "not_contains", l: "不包含" }, { v: "empty", l: "为空" }, { v: "not_empty", l: "非空" }];
const RULE_OPS_TAGS = [{ v: "contains", l: "包含" }, { v: "not_contains", l: "不包含" }, { v: "empty", l: "为空" }, { v: "not_empty", l: "非空" }];

function EditPackModal({ pack, onClose, onReimport, onSaved }: { pack: Pack; onClose: () => void; onReimport: (p: Pack) => void; onSaved: (activateId?: string) => void }) {
  const creating = pack.id === "";
  const [name, setName] = useState(pack.name);
  const [match, setMatch] = useState<"all" | "any">(pack.rule?.match ?? "all");
  const [conds, setConds] = useState<PackCond[]>(pack.rule?.conditions ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const title = creating ? (pack.kind === "rule" ? "新建条件筛选包" : "新建手动分组") : `编辑 · ${PACK_KIND_LABEL[pack.kind]}`;

  const setCond = (i: number, patch: Partial<PackCond>) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const opsFor = (field: string) => (field === "tags" ? RULE_OPS_TAGS : RULE_OPS_TEXT);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    try {
      const rule = pack.kind === "rule" ? { match, conditions: conds.filter((c) => c.field && c.op) } : undefined;
      if (creating) {
        const { data, error } = await api.POST("/api/v1/customers/packs", { body: { name: name.trim(), kind: pack.kind, rule } });
        if (error) throw error;
        onSaved((data.data as { id: string }).id);
      } else {
        const { error } = await api.PATCH("/api/v1/customers/packs/{pack_id}", { params: { path: { pack_id: pack.id } }, body: { name: name.trim(), rule } });
        if (error) throw error;
        onSaved();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <RkModal title={title} w={640} onClose={onClose}
      footer={<><button className="btn-text" onClick={onClose}>取消</button><button className={"btn-primary" + (name.trim() && !busy ? "" : " dis")} disabled={!name.trim() || busy} onClick={save}>{busy ? "保存中…" : "保存"}</button></>}>
      <div className="fld-lbl">资源包名称 <span className="req">*</span></div>
      <div className="fld-wrap"><input className="fld" maxLength={20} placeholder="请输入资源包名称" value={name} onChange={(e) => setName(e.target.value)} /><span className="fld-count">{name.length}/20</span></div>

      {pack.kind === "rule" && (
        <>
          <div className="fld-lbl" style={{ marginTop: 16 }}>匹配方式</div>
          <div className="rp-seg" style={{ marginTop: 0 }}>
            <button className={"rp-seg-btn" + (match === "all" ? " on" : "")} onClick={() => setMatch("all")}>满足全部条件 (AND)</button>
            <button className={"rp-seg-btn" + (match === "any" ? " on" : "")} onClick={() => setMatch("any")}>满足任一条件 (OR)</button>
          </div>
          <div className="fld-lbl" style={{ marginTop: 16 }}>筛选条件</div>
          {conds.map((c, i) => {
            const fdef = RULE_FIELDS.find((f) => f.key === c.field);
            const needVal = c.op !== "empty" && c.op !== "not_empty";
            return (
              <div className="rp-cond-row" key={i}>
                <MiniSelect value={fdef?.label ?? "客户状态"} onChange={(lbl) => { const f = RULE_FIELDS.find((x) => x.label === lbl)!; setCond(i, { field: f.key, op: opsFor(f.key)[0].v, value: "" }); }} options={RULE_FIELDS.map((f) => f.label)} />
                <MiniSelect value={opsFor(c.field).find((o) => o.v === c.op)?.l ?? "等于"} onChange={(lbl) => setCond(i, { op: opsFor(c.field).find((o) => o.l === lbl)!.v })} options={opsFor(c.field).map((o) => o.l)} />
                {needVal && (fdef?.type === "select"
                  ? <MiniSelect value={fdef.options!.find((o) => o.v === c.value)?.l ?? fdef.options![0].l} onChange={(lbl) => setCond(i, { value: fdef.options!.find((o) => o.l === lbl)!.v })} options={fdef.options!.map((o) => o.l)} />
                  : <input className="fld rp-cond-val" placeholder="值" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} />)}
                <button className="df-ic" onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button>
              </div>
            );
          })}
          <button className="link-blue" style={{ marginTop: 8 }} onClick={() => setConds((cs) => [...cs, { field: "status", op: "eq", value: "intent" }])}><IcPlus s={14} /> 添加条件</button>
          {conds.length === 0 && <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>无条件 = 匹配全部客户。</div>}
        </>
      )}

      {pack.kind === "file" && !creating && (
        <div style={{ marginTop: 16 }}>
          <button className="btn-outline" onClick={() => onReimport(pack)}><CIcUpload s={16} style={{ color: "var(--ink-2)" }} /> 重新导入文件（追加/覆盖）</button>
        </div>
      )}
      {pack.kind === "manual" && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>手动分组成员通过客户列表多选「加入手动分组 / 移出本包」管理。</div>
      )}
      {err && <div style={{ color: "var(--danger, #E5484D)", fontSize: 13, marginTop: 10 }}>{err}</div>}
    </RkModal>
  );
}

/* ---------- 批量加入手动分组 ---------- */
function BatchAddModal({ packs, onClose, onAdd, onCreate }: { packs: Pack[]; onClose: () => void; onAdd: (packId: string) => Promise<void>; onCreate: (name: string) => Promise<string> }) {
  const [mode, setMode] = useState<"exist" | "new">(packs.length ? "exist" : "new");
  const [target, setTarget] = useState(packs[0]?.id ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { if (mode === "new") await onCreate(name.trim()); else await onAdd(target); }
    finally { setBusy(false); }
  };
  const ok = mode === "new" ? name.trim() : target;
  return (
    <RkModal title="加入手动分组" w={480} onClose={onClose}
      footer={<><button className="btn-text" onClick={onClose}>取消</button><button className={"btn-primary" + (ok && !busy ? "" : " dis")} disabled={!ok || busy} onClick={go}>{busy ? "处理中…" : "确定"}</button></>}>
      <div className="rp-seg" style={{ marginTop: 0 }}>
        <button className={"rp-seg-btn" + (mode === "exist" ? " on" : "")} onClick={() => setMode("exist")} disabled={!packs.length}>加入已有分组</button>
        <button className={"rp-seg-btn" + (mode === "new" ? " on" : "")} onClick={() => setMode("new")}>新建分组</button>
      </div>
      {mode === "exist" ? (
        <div style={{ marginTop: 14 }}>
          {packs.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>暂无手动分组，请新建。</div> :
            <SelectBox block value={target} onChange={setTarget} options={packs.map((p) => ({ value: p.id, label: `${p.name}（${p.count}）` }))} />}
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div className="fld-wrap"><input className="fld" maxLength={20} placeholder="新分组名称" value={name} onChange={(e) => setName(e.target.value)} /><span className="fld-count">{name.length}/20</span></div>
        </div>
      )}
    </RkModal>
  );
}

function AddCustomerModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (c: { name: string; phone: string; company: string; status: string; owner: string }) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState("lead");
  const owners = ["陈销售", "林运营", "王主管"];
  const [owner, setOwner] = useState("");
  const ok = name.trim() && /^\d{7,}$/.test(phone.trim());
  return (
    <RkModal title="添加新客户" w={520} onClose={onClose} footer={<><button className="btn-text" onClick={onClose}>取消</button><button className={"btn-primary" + (ok ? "" : " dis")} disabled={!ok} onClick={() => onConfirm({ name: name.trim(), phone: phone.trim(), company: company.trim(), status, owner })}>确定</button></>}>
      <div className="fld-lbl">客户姓名 <span className="req">*</span></div>
      <input className="fld" placeholder="请输入客户姓名" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="fld-lbl">手机号 <span className="req">*</span></div>
      <input className="fld" placeholder="请输入手机号" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
      <div className="fld-lbl">公司</div>
      <input className="fld" placeholder="请输入公司名称（选填）" value={company} onChange={(e) => setCompany(e.target.value)} />
      <div className="fld-lbl">客户状态</div>
      <div className="addc-status">
        {Object.entries(CUST_STATUS).map(([k, tt]) => (
          <button key={k} className={"addc-pill" + (status === k ? " on" : "")} style={status === k ? { color: tt.color, background: tt.soft, borderColor: tt.color } : {}} onClick={() => setStatus(k)}>
            <span className="dot" style={{ background: tt.color }} />{tt.label}
          </button>
        ))}
      </div>
      <div className="fld-lbl">负责人</div>
      <SelectBox block value={owner} ph="未分配" options={[{ value: "", label: "未分配" }, ...owners.map((o) => ({ value: o }))]} onChange={setOwner} />
    </RkModal>
  );
}
