"use client";

/* 技能库（接真实后端 /skills + /connectors）。工具技能可真实调用/测试，SOP 技能固化流程。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { IcClose, IcEditMenu, IcKnowledge, IcPlus, IcTrash, Svg, type IcProps } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { RowMenu } from "@/components/rk/RowMenu";
import { api } from "@/lib/api/client";
import { SK_TYPES, SkIcBitable, SkIcBuiltin, SkIcSop, SkIcTool, skillMeta, useSkills, type SkType, type Skill } from "@/lib/rk/skills";
import { SelectBox } from "@/components/rk/Select";
import type { components } from "@/lib/api/schema";

type Connector = components["schemas"]["ConnectorOut"];
type SkillInput = { name: string; type: string; req: boolean; desc: string };

const SkIcApi = (p: IcProps) => <Svg {...p}><path d="M10 3v4M14 3v4" /><path d="M7 7h10v4a5 5 0 0 1-10 0V7Z" /><path d="M12 16v5" /></Svg>;
const SkIcBolt = (p: IcProps) => <Svg {...p}><path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" /></Svg>;
const SkIcSearch = (p: IcProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></Svg>;
const SkIcPlay = (p: IcProps) => <Svg {...p}><path d="M7 5l11 7-11 7V5Z" /></Svg>;

function useConnectors() {
  return useQuery({
    queryKey: ["connectors"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/connectors");
      if (error) throw error;
      return data.data as Connector[];
    },
  });
}

export default function SkillsPage() {
  const qc = useQueryClient();
  const { data: skills } = useSkills();
  const [tab, setTab] = useState<"all" | SkType>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Skill | null>(null);
  const [create, setCreate] = useState(false);

  const all = skills || [];
  const counts = { all: all.length, tool: all.filter((s) => s.skill_type === "tool").length, sop: all.filter((s) => s.skill_type === "sop").length, builtin: all.filter((s) => s.skill_type === "builtin").length, bitable: all.filter((s) => s.skill_type === "bitable").length };
  const list = all.filter((s) => (tab === "all" || s.skill_type === tab) && (!q || s.name.includes(q) || s.description.includes(q)));

  const toggle = useMutation({
    mutationFn: async (s: Skill) => {
      const { error } = await api.PATCH("/api/v1/skills/{sid}", { params: { path: { sid: s.id } }, body: { enabled: !s.enabled } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/v1/skills/{sid}", { params: { path: { sid: id } } });
      if (error) throw error;
    },
    onSuccess: () => { setSel(null); qc.invalidateQueries({ queryKey: ["skills"] }); },
  });

  return (
    <div className="page sk-page">
      <div className="page-head">
        <h1>技能库</h1>
        <div className="row" style={{ gap: 14 }}>
          <div className="kb-search"><SkIcSearch s={17} style={{ color: "var(--ink-3)" }} /><input placeholder="搜索技能" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn-create" onClick={() => setCreate(true)}><IcPlus s={17} sw={2.2} style={{ color: "#fff" }} /> 创建技能</button>
        </div>
      </div>

      <div className="sk-intro">
        <span className="sk-intro-ic"><SkIcBolt s={18} style={{ color: "var(--primary)" }} /></span>
        把<b>业务 API 拆解成「工具」</b>、把<b>标准流程固化成「SOP 技能」</b>，智能体在对话/工作流中按需调用——和「全局配置 · 数据接入」里注册的连接器打通。
      </div>

      <div className="sk-tabs">
        {([["all", "全部"], ["builtin", "内置技能"], ["tool", "工具"], ["sop", "SOP 技能"], ["bitable", "飞书多维表格"]] as const).map(([k, label]) => (
          <button key={k} className={"sk-tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
            {label} <span className="sk-tab-n">{counts[k]}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="empty-state fade-in">
          <div className="empty-illus"><SkIcTool s={64} style={{ color: "#C3CBDC" }} /></div>
          <h3>还没有技能</h3><p>创建工具或 SOP 技能，让智能体学会调用业务系统</p>
          <button className="btn-ghost lg" onClick={() => setCreate(true)}>创建技能</button>
        </div>
      ) : (
        <div className="sk-grid fade-in">
          {list.map((s) => <SkillCard key={s.id} s={s} onOpen={() => setSel(s)} onToggle={() => toggle.mutate(s)} onDelete={() => { if (confirm(`确认删除技能「${s.name}」？`)) del.mutate(s.id); }} />)}
        </div>
      )}

      {sel && <SkillDrawer skill={sel} onClose={() => setSel(null)} onToggle={() => { toggle.mutate(sel); setSel({ ...sel, enabled: !sel.enabled }); }} onDelete={() => { if (confirm(`确认删除技能「${sel.name}」？`)) del.mutate(sel.id); }} />}
      {create && <CreateSkillModal onClose={() => setCreate(false)} onCreated={() => { setCreate(false); qc.invalidateQueries({ queryKey: ["skills"] }); }} />}
    </div>
  );
}

function SkillCard({ s, onOpen, onToggle, onDelete }: { s: Skill; onOpen: () => void; onToggle: () => void; onDelete: () => void }) {
  const t = SK_TYPES[s.skill_type as SkType] ?? SK_TYPES.tool;
  return (
    <div className="sk-card" onClick={onOpen}>
      <div className="sk-card-top">
        <span className="sk-ic" style={{ background: t.soft }}><t.Icon s={22} style={{ color: t.color }} /></span>
        <div className="sk-card-id">
          <div className="sk-card-name">{s.name}</div>
          <span className="sk-type-tag" style={{ color: t.color, background: t.soft }}>{t.label}</span>
        </div>
        <span onClick={(e) => e.stopPropagation()}>
          <RowMenu items={[{ label: "查看", icon: IcEditMenu, onClick: onOpen }, ...(s.skill_type === "builtin" ? [] : [{ label: "删除", icon: IcTrash, danger: true, onClick: onDelete }])]} />
        </span>
      </div>
      <div className="sk-card-desc">{s.description || "（暂无描述）"}</div>
      <div className="sk-card-foot">
        <span className="sk-meta">{s.skill_type === "tool" ? <SkIcApi s={14} style={{ color: "var(--ink-3)" }} /> : <SkIcSop s={14} style={{ color: "var(--ink-3)" }} />} {skillMeta(s)}</span>
        <span className="sk-toggle" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
          <span className={"tg" + (s.enabled ? " on" : "")}><span className="tg-dot" /></span>
        </span>
      </div>
    </div>
  );
}

function SkillDrawer({ skill: s, onClose, onToggle, onDelete }: { skill: Skill; onClose: () => void; onToggle: () => void; onDelete: () => void }) {
  const t = SK_TYPES[s.skill_type as SkType] ?? SK_TYPES.tool;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="sk-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="skd-head">
          <span className="sk-ic lg" style={{ background: t.soft }}><t.Icon s={26} style={{ color: t.color }} /></span>
          <div className="skd-head-id">
            <div className="skd-name">{s.name} <span className="sk-type-tag" style={{ color: t.color, background: t.soft }}>{t.label}</span></div>
            <div className="skd-sub">{s.description}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><IcClose s={20} style={{ color: "var(--ink-3)" }} /></button>
        </div>
        <div className="skd-bar">
          <span className="skd-stat">{s.skill_type === "tool" ? "工具技能" : s.skill_type === "builtin" ? "内置技能" : s.skill_type === "bitable" ? "飞书多维表格回写" : "SOP 技能"}</span>
          <span className="spacer" />
          <span className="skd-enable">启用<button className="tg-wrap" onClick={onToggle}><span className={"tg" + (s.enabled ? " on" : "")}><span className="tg-dot" /></span></button></span>
        </div>
        <div className="skd-scroll">{s.skill_type === "tool" ? <ToolDetail s={s} /> : s.skill_type === "builtin" ? <div className="skd-sec" style={{ paddingTop: 4 }}>平台内置动作：<b>{s.builtin}</b><div className="muted" style={{ marginTop: 8, fontSize: 13 }}>{s.description || "绑定到单 Agent（技能区）或工作流（技能节点）即可调用。"}</div></div> : s.skill_type === "bitable" ? <BitableDetail s={s} /> : <SopDetail s={s} />}</div>
        <div className="skd-foot">
          {s.skill_type === "builtin" ? <span className="muted" style={{ fontSize: 13 }}>内置技能不可删除</span> : <button className="btn-text danger" onClick={onDelete}>删除技能</button>}
          <span className="spacer" />
          <button className="btn-outline" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function BitableDetail({ s }: { s: Skill }) {
  const qc = useQueryClient();
  const cfg = (s.config || {}) as { url?: string; personal_base_token?: string; fields?: { arg: string; field: string; type: string }[] };
  const [url, setUrl] = useState(cfg.url ?? "");
  const [token, setToken] = useState(cfg.personal_base_token ?? "");
  const [fields, setFields] = useState<{ arg: string; field: string; type: string }[]>(cfg.fields?.length ? cfg.fields : [{ arg: "notes", field: "AI沟通纪要", type: "text" }]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = url !== (cfg.url ?? "") || token !== (cfg.personal_base_token ?? "") || JSON.stringify(fields) !== JSON.stringify(cfg.fields ?? []);

  const doTest = async () => {
    setTesting(true); setTest(null);
    try {
      const { data, error } = await api.POST("/api/v1/skills/bitable/test", { body: { url: url.trim(), personal_base_token: token.trim() } });
      if (error) throw error;
      const r = data.data as { ok: boolean; error?: string; total?: number };
      setTest(r.ok ? { ok: true, msg: `连接成功，共 ${r.total ?? "?"} 条记录` } : { ok: false, msg: r.error || "连接失败" });
    } catch (e) { setTest({ ok: false, msg: e instanceof Error ? e.message : "连接失败" }); }
    finally { setTesting(false); }
  };
  const save = async () => {
    setBusy(true); setSaved(false);
    try {
      const fs = fields.filter((f) => f.arg.trim() && f.field.trim());
      const { error } = await api.PATCH("/api/v1/skills/{sid}", { params: { path: { sid: s.id } }, body: {
        config: { url: url.trim(), personal_base_token: token.trim(), fields: fs },
        inputs: [{ name: "record_id", desc: "候选人记录ID", req: true }, ...fs.map((f) => ({ name: f.arg, desc: f.field, req: false }))],
      } });
      if (error) throw error;
      setSaved(true); qc.invalidateQueries({ queryKey: ["skills"] });
    } finally { setBusy(false); }
  };

  return (
    <div className="skd-form">
      <div className="fld-lbl">表格链接 <span className="req">*</span></div>
      <input className="fld" placeholder=".../base/<token>?table=..." value={url} onChange={(e) => { setUrl(e.target.value); setTest(null); }} />
      <div className="fld-lbl">授权码 (personal_base_token) <span className="req">*</span></div>
      <input className="fld" type="password" placeholder="多维表格高级权限/插件生成的个人授权码" value={token} onChange={(e) => { setToken(e.target.value); setTest(null); }} />
      <div className="row" style={{ gap: 12, alignItems: "center", marginTop: 10 }}>
        <button className={"btn-outline sm" + (url.trim() && token.trim() && !testing ? "" : " dis")} disabled={!url.trim() || !token.trim() || testing} onClick={doTest}>{testing ? "测试中…" : "测试连接"}</button>
        {test && <span style={{ fontSize: 13, color: test.ok ? "#1FA85A" : "var(--danger,#E5484D)" }}>{test.ok ? "✓ " : "✕ "}{test.msg}</span>}
      </div>
      <div className="fld-lbl" style={{ marginTop: 18 }}>字段映射 <span className="muted" style={{ fontWeight: 400 }}>· 入参名 → 表格字段名</span></div>
      {fields.map((f, i) => (
        <div className="cond-row" key={i} style={{ gridTemplateColumns: "1fr 1fr 0.8fr auto", marginTop: i ? 8 : 0 }}>
          <input className="vin" placeholder="入参名(如 notes)" value={f.arg} onChange={(e) => setFields((a) => a.map((x, j) => (j === i ? { ...x, arg: e.target.value } : x)))} />
          <input className="vin" placeholder="表格字段名" value={f.field} onChange={(e) => setFields((a) => a.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} />
          <SelectBox small value={f.type} options={[{ value: "text", label: "文本" }, { value: "datetime", label: "日期" }]} onChange={(v) => setFields((a) => a.map((x, j) => (j === i ? { ...x, type: v } : x)))} />
          <button className="df-ic" onClick={() => setFields((a) => a.filter((_, j) => j !== i))}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button>
        </div>
      ))}
      <button className="link-blue" style={{ marginTop: 8 }} onClick={() => setFields((a) => [...a, { arg: "", field: "", type: "text" }])}>+ 添加字段</button>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>运行时还需 <b>record_id</b>（候选人记录ID）——在工作流技能节点里映射为 {"{{session.record_id}}"}。</div>
      <div className="row" style={{ gap: 12, alignItems: "center", marginTop: 18 }}>
        <button className={"btn-primary" + (dirty && url.trim() && token.trim() && !busy ? "" : " dis")} disabled={!dirty || !url.trim() || !token.trim() || busy} onClick={save}>{busy ? "保存中…" : "保存修改"}</button>
        {saved && !dirty && <span style={{ fontSize: 13, color: "#1FA85A" }}>✓ 已保存</span>}
      </div>
    </div>
  );
}

function ToolDetail({ s }: { s: Skill }) {
  const { data: connectors } = useConnectors();
  const conn = connectors?.find((c) => c.id === s.connector_id);
  const inputs = (s.inputs || []) as SkillInput[];
  const outputs = (s.outputs || []) as { name: string; type: string; desc: string }[];
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runTest = async () => {
    setBusy(true);
    try {
      const { data, error } = await api.POST("/api/v1/skills/{sid}/test", { params: { path: { sid: s.id } }, body: { args } });
      if (error) throw error;
      const r = data.data;
      setResult(r.ok ? JSON.stringify(r.result, null, 2) : (r.error || `失败 (${r.status})`));
    } catch (e) {
      setResult(e instanceof Error ? e.message : "调用失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="skd-sec">关联接口</div>
      <div className="skd-api">
        {conn ? <><span className={"method m-" + (conn.method || "get").toLowerCase()}>{conn.method}</span><b>{conn.name}</b><span className="muted" style={{ fontSize: 12.5, marginLeft: 8 }}>{conn.url}</span></> : <span className="muted">未关联连接器（去「全局配置 · 数据接入」创建）</span>}
      </div>
      <div className="skd-sec">输入参数</div>
      <div className="param-table">
        <div className="pt-head tool"><span>参数名</span><span>类型</span><span>必填</span><span>说明</span></div>
        {inputs.length === 0 && <div className="pt-row tool"><span className="muted" style={{ gridColumn: "1/-1" }}>无</span></div>}
        {inputs.map((p, i) => (
          <div className="pt-row tool" key={i}>
            <span><code>{p.name}</code></span><span className="muted">{p.type}</span>
            <span>{p.req ? <span className="req-yes">必填</span> : <span className="muted">选填</span>}</span>
            <span className="muted">{p.desc}</span>
          </div>
        ))}
      </div>
      {outputs.length > 0 && (
        <>
          <div className="skd-sec">输出参数</div>
          <div className="param-table">
            <div className="pt-head out"><span>字段</span><span>类型</span><span>说明</span></div>
            {outputs.map((p, i) => <div className="pt-row out" key={i}><span><code>{p.name}</code></span><span className="muted">{p.type}</span><span className="muted">{p.desc}</span></div>)}
          </div>
        </>
      )}
      <div className="skd-sec">调试（真实调用）</div>
      <div className="skd-test">
        <div className="skd-test-in">
          {inputs.map((p, i) => (
            <div className="skd-test-row" key={i}>
              <span className="skd-test-lbl">{p.name}</span>
              <input className="vin" placeholder={p.desc} value={args[p.name] || ""} onChange={(e) => setArgs((a) => ({ ...a, [p.name]: e.target.value }))} />
            </div>
          ))}
        </div>
        <button className="btn-outline sm" disabled={busy} onClick={runTest}><SkIcPlay s={15} style={{ color: "var(--primary)" }} /> {busy ? "调用中…" : "运行测试"}</button>
        {result !== null && <pre className="skd-result fade-in">{result}</pre>}
      </div>
    </>
  );
}

function SopDetail({ s }: { s: Skill }) {
  const steps = (s.steps || []) as string[];
  const { data: allSkills } = useSkills();
  const { data: kbs } = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/knowledge-bases");
      if (error) throw error;
      return data.data;
    },
  });
  const toolName = (id: unknown) => allSkills?.find((x) => x.id === String(id))?.name || "工具";
  const kbName = (id: unknown) => kbs?.find((x) => x.id === String(id))?.name || "知识库";
  return (
    <>
      <div className="skd-sec">触发条件 <span className="skd-sec-cap">何时使用此技能</span></div>
      <div className="sop-trigger"><SkIcBolt s={16} style={{ color: "var(--primary)" }} /> {s.trigger || "（未设置）"}</div>
      <div className="skd-sec">执行步骤</div>
      <ol className="sop-steps">
        {steps.length === 0 && <li><span className="sop-text muted">（未设置步骤）</span></li>}
        {steps.map((st, i) => <li key={i}><span className="sop-n">{i + 1}</span><span className="sop-text">{st}</span></li>)}
      </ol>
      <div className="skd-sec">关联工具/知识库</div>
      <div className="sop-chips">
        {(s.tool_ids || []).length === 0 && (s.kb_ids || []).length === 0 ? <span className="muted" style={{ fontSize: 13 }}>无</span> : (
          <>
            {(s.tool_ids || []).map((tn) => <span key={String(tn)} className="sop-chip tool"><SkIcTool s={14} style={{ color: "#3B5BFF" }} /> {toolName(tn)}</span>)}
            {(s.kb_ids || []).map((k) => <span key={String(k)} className="sop-chip kb"><IcKnowledge s={14} style={{ color: "#FF5436" }} /> {kbName(k)}</span>)}
          </>
        )}
      </div>
    </>
  );
}

function CreateSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: connectors } = useConnectors();
  const { data: allSkills } = useSkills();
  const { data: kbs } = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/knowledge-bases");
      if (error) throw error;
      return data.data;
    },
  });
  const toolSkills = (allSkills || []).filter((s) => s.skill_type === "tool");
  const [type, setType] = useState<SkType>("tool");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [connId, setConnId] = useState("");
  const [inputs, setInputs] = useState<SkillInput[]>([{ name: "", type: "string", req: true, desc: "" }]);
  const [trigger, setTrigger] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [kbIds, setKbIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // 飞书多维表格回写配置
  const [bUrl, setBUrl] = useState("");
  const [bToken, setBToken] = useState("");
  const [bFields, setBFields] = useState<{ arg: string; field: string; type: string }[]>([
    { arg: "stage", field: "当前阶段", type: "text" },
    { arg: "note", field: "AI沟通纪要", type: "text" },
    { arg: "follow_time", field: "下次跟进时间", type: "datetime" },
  ]);
  const [bTesting, setBTesting] = useState(false);
  const [bTest, setBTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const toggleId = (set: React.Dispatch<React.SetStateAction<string[]>>, id: string) =>
    set((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const ok = name.trim() && (type === "sop" ? trigger.trim() : type === "bitable" ? (bUrl.trim() && bToken.trim()) : true);

  const testBitable = async () => {
    setBTesting(true); setBTest(null);
    try {
      const { data, error } = await api.POST("/api/v1/skills/bitable/test", { body: { url: bUrl.trim(), personal_base_token: bToken.trim() } });
      if (error) throw error;
      const r = data.data as { ok: boolean; error?: string; total?: number };
      setBTest(r.ok ? { ok: true, msg: `连接成功，共 ${r.total ?? "?"} 条记录` } : { ok: false, msg: r.error || "连接失败" });
    } catch (e) {
      setBTest({ ok: false, msg: e instanceof Error ? e.message : "连接失败" });
    } finally {
      setBTesting(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const body =
        type === "tool"
          ? { name: name.trim(), description: desc, skill_type: "tool", connector_id: connId || null, inputs: inputs.filter((i) => i.name.trim()) }
          : type === "bitable"
          ? { name: name.trim(), description: desc, skill_type: "bitable",
              config: { url: bUrl.trim(), personal_base_token: bToken.trim(), fields: bFields.filter((f) => f.arg.trim() && f.field.trim()) },
              inputs: [{ name: "record_id", desc: "候选人记录ID", req: true }, ...bFields.filter((f) => f.arg.trim()).map((f) => ({ name: f.arg, desc: f.field, req: false }))] }
          : { name: name.trim(), description: desc, skill_type: "sop", trigger: trigger.trim(), steps: steps.filter((s) => s.trim()), tool_ids: toolIds, kb_ids: kbIds };
      const { error } = await api.POST("/api/v1/skills", { body });
      if (error) throw error;
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <RkModal title="创建技能" w={600} onClose={onClose}
      footer={<><button className="btn-text" onClick={onClose}>取消</button><button className={"btn-primary" + (ok && !busy ? "" : " dis")} disabled={!ok || busy} onClick={submit}>{busy ? "创建中…" : "创建"}</button></>}>
      <div className="sk-type-pick">
        <button className={"sk-type-card" + (type === "tool" ? " on" : "")} onClick={() => setType("tool")}><SkIcTool s={26} style={{ color: type === "tool" ? "#3B5BFF" : "var(--ink-3)" }} /><b>工具</b><i>把一个连接器封装成可调用工具</i></button>
        <button className={"sk-type-card" + (type === "sop" ? " on" : "")} onClick={() => setType("sop")}><SkIcSop s={26} style={{ color: type === "sop" ? "#7A2BF5" : "var(--ink-3)" }} /><b>SOP 技能</b><i>把标准作业流程固化成技能</i></button>
        <button className={"sk-type-card" + (type === "bitable" ? " on" : "")} onClick={() => setType("bitable")}><SkIcBitable s={26} style={{ color: type === "bitable" ? "#00A6A6" : "var(--ink-3)" }} /><b>飞书多维表格</b><i>把对话结论回写到多维表格</i></button>
      </div>
      <div className="sk-intro" style={{ marginBottom: 16 }}>
        <span className="sk-intro-ic"><SkIcBuiltin s={16} style={{ color: "#1FA85A" }} /></span>
        <span>内置技能（联网搜索、图片理解、长期记忆、登记客户等）为平台预置，无需创建，可直接在「内置技能」分类中绑定使用。</span>
      </div>
      <div className="fld-lbl">技能名称 <span className="req">*</span></div>
      <input className="fld" placeholder={type === "tool" ? "如：查询订单状态" : type === "builtin" ? "如：登记客户" : "如：退款处理 SOP"} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="fld-lbl">描述</div>
      <textarea className="fld ta" placeholder="一句话说明这个技能做什么" value={desc} onChange={(e) => setDesc(e.target.value)} />
      {type === "builtin" ? null : type === "tool" ? (
        <>
          <div className="fld-lbl">关联连接器 <span className="req">*</span></div>
          <select className="fld" value={connId} onChange={(e) => setConnId(e.target.value)}>
            <option value="">{(connectors || []).length ? "请选择连接器" : "暂无连接器（去全局配置·数据接入创建）"}</option>
            {(connectors || []).map((c) => <option key={c.id} value={c.id}>{c.name}（{c.method} {c.url}）</option>)}
          </select>
          <div className="fld-lbl">入参</div>
          {inputs.map((p, i) => (
            <div className="cond-row" key={i} style={{ gridTemplateColumns: "1.2fr 1fr auto auto", marginTop: i ? 8 : 0 }}>
              <input className="vin" placeholder="参数名" value={p.name} onChange={(e) => setInputs((a) => a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="vin" placeholder="说明" value={p.desc} onChange={(e) => setInputs((a) => a.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)))} />
              <button className={"ghost-pill" + (p.req ? " on" : "")} onClick={() => setInputs((a) => a.map((x, j) => (j === i ? { ...x, req: !x.req } : x)))}>{p.req ? "必填" : "选填"}</button>
              <button className="df-ic" onClick={() => setInputs((a) => a.filter((_, j) => j !== i))}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button>
            </div>
          ))}
          <button className="link-blue" style={{ marginTop: 8 }} onClick={() => setInputs((a) => [...a, { name: "", type: "string", req: false, desc: "" }])}>+ 添加入参</button>
        </>
      ) : type === "bitable" ? (
        <>
          <div className="fld-lbl">多维表格链接 <span className="req">*</span></div>
          <input className="fld" placeholder="打开多维表格(Base) → 复制链接，形如 .../base/<token>?table=..." value={bUrl} onChange={(e) => { setBUrl(e.target.value); setBTest(null); }} />
          <div className="fld-lbl">授权码 (personal_base_token) <span className="req">*</span></div>
          <input className="fld" placeholder="多维表格右上角 …更多 → 高级权限/插件 生成的个人授权码" value={bToken} onChange={(e) => { setBToken(e.target.value); setBTest(null); }} />
          <div className="row" style={{ gap: 12, alignItems: "center", marginTop: 10 }}>
            <button className={"btn-outline sm" + (bUrl.trim() && bToken.trim() && !bTesting ? "" : " dis")} disabled={!bUrl.trim() || !bToken.trim() || bTesting} onClick={testBitable}>{bTesting ? "测试中…" : "测试连接"}</button>
            {bTest && <span style={{ fontSize: 13, color: bTest.ok ? "#1FA85A" : "var(--danger,#E5484D)" }}>{bTest.ok ? "✓ " : "✕ "}{bTest.msg}</span>}
          </div>
          <div className="fld-lbl" style={{ marginTop: 16 }}>字段映射 <span className="muted" style={{ fontWeight: 400 }}>· 入参名 → 表格字段名</span></div>
          {bFields.map((f, i) => (
            <div className="cond-row" key={i} style={{ gridTemplateColumns: "1fr 1fr 0.8fr auto", marginTop: i ? 8 : 0 }}>
              <input className="vin" placeholder="入参名(如 stage)" value={f.arg} onChange={(e) => setBFields((a) => a.map((x, j) => (j === i ? { ...x, arg: e.target.value } : x)))} />
              <input className="vin" placeholder="表格字段名(如 当前阶段)" value={f.field} onChange={(e) => setBFields((a) => a.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} />
              <SelectBox small value={f.type} options={[{ value: "text", label: "文本" }, { value: "datetime", label: "日期" }]} onChange={(v) => setBFields((a) => a.map((x, j) => (j === i ? { ...x, type: v } : x)))} />
              <button className="df-ic" onClick={() => setBFields((a) => a.filter((_, j) => j !== i))}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button>
            </div>
          ))}
          <button className="link-blue" style={{ marginTop: 8 }} onClick={() => setBFields((a) => [...a, { arg: "", field: "", type: "text" }])}>+ 添加字段</button>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>运行时还需提供 <b>record_id</b>（候选人记录ID）——在工作流技能节点的参数里映射为 {"{{session.record_id}}"}。绑定该技能后，AI 会把对应入参回写到表格里这一行。</div>
        </>
      ) : (
        <>
          <div className="fld-lbl">触发条件 <span className="req">*</span></div>
          <textarea className="fld ta" placeholder="描述客户在什么情况下应触发此 SOP" value={trigger} onChange={(e) => setTrigger(e.target.value)} />
          <div className="fld-lbl">执行步骤</div>
          {steps.map((st, i) => (
            <div className="cond-row" key={i} style={{ gridTemplateColumns: "1fr auto", marginTop: i ? 8 : 0 }}>
              <input className="vin" placeholder={`步骤 ${i + 1}`} value={st} onChange={(e) => setSteps((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
              <button className="df-ic" onClick={() => setSteps((a) => a.filter((_, j) => j !== i))}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button>
            </div>
          ))}
          <button className="link-blue" style={{ marginTop: 8 }} onClick={() => setSteps((a) => [...a, ""])}>+ 添加步骤</button>
          <div className="fld-lbl">关联工具</div>
          <div className="sop-pick">
            {toolSkills.length === 0 && <span className="muted" style={{ fontSize: 13 }}>暂无工具技能</span>}
            {toolSkills.map((s) => (
              <button key={s.id} className={"sop-pick-chip" + (toolIds.includes(s.id) ? " on" : "")} onClick={() => toggleId(setToolIds, s.id)}>
                <SkIcTool s={14} /> {s.name}
              </button>
            ))}
          </div>
          <div className="fld-lbl">关联知识库</div>
          <div className="sop-pick">
            {(kbs || []).length === 0 && <span className="muted" style={{ fontSize: 13 }}>暂无知识库</span>}
            {(kbs || []).map((k) => (
              <button key={k.id} className={"sop-pick-chip" + (kbIds.includes(k.id) ? " on" : "")} onClick={() => toggleId(setKbIds, k.id)}>
                <IcKnowledge s={14} /> {k.name}
              </button>
            ))}
          </div>
        </>
      )}
    </RkModal>
  );
}
