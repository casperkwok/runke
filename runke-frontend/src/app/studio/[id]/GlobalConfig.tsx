"use client";

/* 全局配置（真实持久化到 Bot）：变量管理 / 数据接入 / 上下文注入。
   设计意图：确定性、非模型决策的「带入信息」——
     数据接入(按时机自动调连接器) → 写入变量 → 上下文注入(拼进系统提示词前)。
   与「技能/工具」（模型按需自主调用）互补，不重复。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { IcEditMenu, IcPlus, IcTrash, Svg, type IcProps } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Connector = components["schemas"]["ConnectorOut"];
type BotOut = components["schemas"]["BotOut"];

const GIcVar = (p: IcProps) => <Svg {...p}><path d="M8 5c-2 2-2 12 0 14M16 5c2 2 2 12 0 14" /><path d="M9.5 12h5" /></Svg>;
const GIcPlug = (p: IcProps) => <Svg {...p}><path d="M10 3v4M14 3v4" /><path d="M7 7h10v4a5 5 0 0 1-10 0V7Z" /><path d="M12 16v5" /></Svg>;
const GIcContext = (p: IcProps) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h6" /></Svg>;
const GIcUser = (p: IcProps) => <Svg {...p}><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></Svg>;
const GIcBolt = (p: IcProps) => <Svg {...p}><path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" /></Svg>;

type Scope = "global" | "session";
const SCOPE: Record<string, { label: string; color: string; soft: string }> = {
  global: { label: "全局", color: "#3B5BFF", soft: "#ECEFFF" },
  session: { label: "会话", color: "#7A2BF5", soft: "#F0E9FE" },
  system: { label: "系统", color: "#5A6275", soft: "#EEF0F4" },
};

const TRIGGERS: Record<string, string> = {
  session_start: "会话开始时",
  each_turn: "每轮对话前",
};

interface Var { name: string; scope: Scope; type: string; value: string; label?: string }
interface Mapping { from: string; to: string }
interface Hook { connector_id: string; trigger: string; mapping: Mapping[] }

export function GlobalConfig({ bot, onSaved }: { bot: BotOut; onSaved?: () => void }) {
  const qc = useQueryClient();
  const mode = bot.orchestration_type === "workflow" ? "workflow" : "single";
  const [sub, setSub] = useState<"vars" | "conn" | "ctx">("vars");

  const patch = useMutation({
    mutationFn: async (body: components["schemas"]["BotUpdate"]) => {
      const { error } = await api.PATCH("/api/v1/bots/{bot_id}", {
        params: { path: { bot_id: bot.id } },
        body,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot", bot.id] });
      onSaved?.();
    },
  });
  const save = (body: components["schemas"]["BotUpdate"]) => patch.mutate(body);

  const items: [typeof sub, string, (p: IcProps) => ReactNode][] = [
    ["vars", "变量管理", GIcVar],
    ["conn", "数据接入", GIcPlug],
    ["ctx", "上下文注入", GIcContext],
  ];
  return (
    <div className="gc">
      <div className="gc-side">
        <div className="gc-side-title">全局配置</div>
        {items.map(([k, label, Ic]) => (
          <button key={k} className={"gc-side-item" + (sub === k ? " on" : "")} onClick={() => setSub(k)}>
            <Ic s={18} /> {label}
          </button>
        ))}
        <div className="gc-side-note">
          配置在<b>单 Agent</b> 与<b>工作流</b>下通用。流程：<b>数据接入</b>按时机自动调 API → 写入<b>变量</b> → <b>上下文注入</b>拼进提示词。变量用 <code>{"{{global.x}}"}</code> / <code>{"{{session.x}}"}</code> 引用。
        </div>
      </div>
      <div className="gc-main">
        {sub === "vars" && <VarManager bot={bot} save={save} />}
        {sub === "conn" && <ConnManager bot={bot} save={save} />}
        {sub === "ctx" && <ContextInject bot={bot} mode={mode} save={save} />}
      </div>
    </div>
  );
}

/* ---------------- 变量管理 ---------------- */
function VarManager({ bot, save }: { bot: BotOut; save: (b: components["schemas"]["BotUpdate"]) => void }) {
  const [vars, setVars] = useState<Var[]>((bot.variables as Var[]) ?? []);
  const [adding, setAdding] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const blank: Var = { name: "", scope: "global", type: "字符串", value: "", label: "" };
  const [draft, setDraft] = useState<Var>(blank);

  const commit = (next: Var[]) => { setVars(next); save({ variables: next }); };
  const reset = () => { setDraft(blank); setAdding(false); setEditIdx(null); };
  const startAdd = () => { setDraft(blank); setEditIdx(null); setAdding(true); };
  const startEdit = (i: number) => { setDraft({ ...vars[i] }); setAdding(false); setEditIdx(i); };
  const submit = () => {
    if (!draft.name.trim()) return;
    const v: Var = { ...draft, name: draft.name.trim(), label: draft.label?.trim() || undefined };
    commit(editIdx !== null ? vars.map((x, j) => (j === editIdx ? v : x)) : [...vars, v]);
    reset();
  };
  const SYS: Var[] = [
    { name: "sys.time", scope: "global", type: "时间", value: "自动注入" },
    { name: "sys.channel", scope: "global", type: "字符串", value: "自动注入" },
  ];

  const VarForm = () => (
    <>
      <span><input className="vin" autoFocus placeholder="变量名(英文)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></span>
      <span><input className="vin" placeholder="名称(如 姓名)" value={draft.label ?? ""} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></span>
      <span><select className="gc-mini" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as Scope })}><option value="global">全局</option><option value="session">会话</option></select></span>
      <span><select className="gc-mini" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}><option>字符串</option><option>数字</option><option>布尔</option><option>对象</option></select></span>
      <span><input className="vin" placeholder="默认值（可空）" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} /></span>
      <span className="gct-ops"><button className="btn-primary sm" onClick={submit}>保存</button><button className="btn-text sm" onClick={reset}>取消</button></span>
    </>
  );

  return (
    <div className="gc-pane fade-in">
      <div className="gc-head">
        <div><h3>变量管理</h3><p>定义全局 / 会话变量；会话变量可在创建会话时带入或由数据接入写入。系统变量自动注入、只读。</p></div>
        <button className="btn-create" onClick={startAdd}><IcPlus s={16} sw={2.2} style={{ color: "#fff" }} /> 新建变量</button>
      </div>
      <div className="gc-table">
        <div className="gct-head var"><span>变量名</span><span>名称</span><span>作用域</span><span>类型</span><span>默认值</span><span></span></div>
        {vars.map((v, i) => (
          editIdx === i ? (
            <div className="gct-row var editing" key={i}>{VarForm()}</div>
          ) : (
          <div className="gct-row var" key={i}>
            <span className="gc-varname"><code>{`{{${v.scope}.${v.name}}}`}</code></span>
            <span className="muted">{v.label || "—"}</span>
            <span><span className="scope-pill" style={{ color: SCOPE[v.scope].color, background: SCOPE[v.scope].soft }}>{SCOPE[v.scope].label}</span></span>
            <span className="muted">{v.type}</span>
            <span className="gc-src"><b>{v.value || "—"}</b></span>
            <span className="gct-ops">
              <button className="df-ic" onClick={() => startEdit(i)}><IcEditMenu s={15} style={{ color: "var(--ink-3)" }} /></button>
              <button className="df-ic" onClick={() => commit(vars.filter((_, j) => j !== i))}><IcTrash s={15} style={{ color: "var(--ink-3)" }} /></button>
            </span>
          </div>
          )
        ))}
        {adding && <div className="gct-row var editing">{VarForm()}</div>}
        {SYS.map((v) => (
          <div className="gct-row var" key={v.name}>
            <span className="gc-varname"><code>{`{{${v.name}}}`}</code></span>
            <span className="muted">{v.name === "sys.time" ? "当前时间" : "渠道"}</span>
            <span><span className="scope-pill" style={{ color: SCOPE.system.color, background: SCOPE.system.soft }}>系统</span></span>
            <span className="muted">{v.type}</span>
            <span className="gc-src"><b>{v.value}</b></span>
            <span className="gct-ops"><span className="lock-tag">只读</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 数据接入：连接器(可复用端点) + 本智能体的自动注入钩子 ---------------- */
function ConnManager({ bot, save }: { bot: BotOut; save: (b: components["schemas"]["BotUpdate"]) => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Connector | "new" | null>(null);
  const [hooks, setHooks] = useState<Hook[]>((bot.data_hooks as Hook[]) ?? []);
  const { data: conns } = useQuery({
    queryKey: ["connectors"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/connectors");
      if (error) throw error;
      return data.data as Connector[];
    },
  });
  const toggle = useMutation({
    mutationFn: async (c: Connector) => {
      const { error } = await api.PATCH("/api/v1/connectors/{cid}", { params: { path: { cid: c.id } }, body: { enabled: !c.enabled } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/v1/connectors/{cid}", { params: { path: { cid: id } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connectors"] }),
  });

  const commitHooks = (next: Hook[]) => { setHooks(next); save({ data_hooks: next }); };
  const addHook = () => {
    const first = (conns || [])[0];
    commitHooks([...hooks, { connector_id: first?.id || "", trigger: "session_start", mapping: [{ from: "", to: "" }] }]);
  };
  const connName = (id: string) => (conns || []).find((c) => c.id === id)?.name || "（已删除连接器）";

  return (
    <div className="gc-pane fade-in">
      <div className="gc-head">
        <div><h3>数据接入</h3><p>① 注册外部 API 连接器（可复用端点，也可在技能库封装成工具）；② 在下方配置「自动注入」：按时机自动调用、把返回字段映射成变量。</p></div>
        <button className="btn-create" onClick={() => setEditing("new")}><IcPlus s={16} sw={2.2} style={{ color: "#fff" }} /> 新建连接</button>
      </div>

      <div className="gc-sub-lbl">连接器（可复用端点）</div>
      <div className="conn-list">
        {(conns || []).length === 0 && <p className="muted" style={{ fontSize: 13 }}>还没有连接器，点右上角「新建连接」。</p>}
        {(conns || []).map((c) => (
          <div className="conn-card" key={c.id}>
            <div className="conn-top">
              <span className="conn-ic"><GIcPlug s={20} style={{ color: "var(--primary)" }} /></span>
              <div className="conn-id"><b>{c.name}</b><span className={"method m-" + c.method.toLowerCase()}>{c.method}</span></div>
              <button className="tg-wrap" onClick={() => toggle.mutate(c)}><span className={"tg" + (c.enabled ? " on" : "")}><span className="tg-dot" /></span></button>
            </div>
            <div className="conn-url">{c.url || "（未配置 URL）"}</div>
            <div className="conn-meta"><span><GIcUser s={14} style={{ color: "var(--ink-3)" }} /> {c.auth}</span></div>
            <div className="conn-actions">
              <button className="link-blue" onClick={() => setEditing(c)}>编辑</button>
              <button className="link-muted" onClick={() => del.mutate(c.id)}>删除</button>
            </div>
          </div>
        ))}
      </div>

      <div className="gc-sub-lbl" style={{ marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>本智能体的自动注入</span>
        <button className="link-blue" onClick={addHook} disabled={(conns || []).length === 0}><IcPlus s={14} /> 添加注入</button>
      </div>
      {hooks.length === 0 && <p className="muted" style={{ fontSize: 13 }}>未配置自动注入。例如：会话开始时调「候选人 API」，把 <code>{"data.resume"}</code> 映射到 <code>{"{{session.resume}}"}</code>。</p>}
      {hooks.map((h, hi) => (
        <div className="hook-card" key={hi}>
          <div className="hook-top">
            <span className="hook-ix"><GIcBolt s={15} style={{ color: "var(--primary)" }} /></span>
            <select className="gc-mini wide" value={h.connector_id} onChange={(e) => commitHooks(hooks.map((x, j) => j === hi ? { ...x, connector_id: e.target.value } : x))}>
              {(conns || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="gc-mini" value={h.trigger} onChange={(e) => commitHooks(hooks.map((x, j) => j === hi ? { ...x, trigger: e.target.value } : x))}>
              {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="df-ic" style={{ marginLeft: "auto" }} onClick={() => commitHooks(hooks.filter((_, j) => j !== hi))}><IcTrash s={15} style={{ color: "var(--ink-3)" }} /></button>
          </div>
          <div className="hook-maps">
            <div className="hook-map-head"><span>返回字段（点路径）</span><span></span><span>写入变量</span></div>
            {h.mapping.map((m, mi) => (
              <div className="hook-map-row" key={mi}>
                <input className="vin" placeholder="data.resume" value={m.from} onChange={(e) => commitHooks(hooks.map((x, j) => j === hi ? { ...x, mapping: x.mapping.map((y, k) => k === mi ? { ...y, from: e.target.value } : y) } : x))} />
                <span className="hook-arrow">→</span>
                <input className="vin" placeholder="session.resume" value={m.to} onChange={(e) => commitHooks(hooks.map((x, j) => j === hi ? { ...x, mapping: x.mapping.map((y, k) => k === mi ? { ...y, to: e.target.value } : y) } : x))} />
                <button className="df-ic" onClick={() => commitHooks(hooks.map((x, j) => j === hi ? { ...x, mapping: x.mapping.filter((_, k) => k !== mi) } : x))}><IcTrash s={14} style={{ color: "var(--ink-4)" }} /></button>
              </div>
            ))}
            <button className="link-blue" style={{ fontSize: 13 }} onClick={() => commitHooks(hooks.map((x, j) => j === hi ? { ...x, mapping: [...x.mapping, { from: "", to: "" }] } : x))}><IcPlus s={13} /> 添加映射</button>
          </div>
          <div className="hook-foot muted">调用 <b>{connName(h.connector_id)}</b>，URL/Header 里的 {"{{变量}}"} 会用当前变量替换（如 <code>{"/candidates/{{session.candidate_id}}"}</code>）。</div>
        </div>
      ))}

      {editing && <ConnEditor conn={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["connectors"] }); }} />}
    </div>
  );
}

function ConnEditor({ conn, onClose, onSaved }: { conn: Connector | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(conn?.name || "");
  const [method, setMethod] = useState(conn?.method || "GET");
  const [url, setUrl] = useState(conn?.url || "");
  const [auth, setAuth] = useState(conn?.auth || "无");
  const [busy, setBusy] = useState(false);
  const ok = name.trim() && url.trim();
  const submit = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim(), method, url: url.trim(), auth };
      const { error } = conn
        ? await api.PATCH("/api/v1/connectors/{cid}", { params: { path: { cid: conn.id } }, body })
        : await api.POST("/api/v1/connectors", { body });
      if (error) throw error;
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <RkModal title={conn ? "编辑连接" : "新建连接"} w={580} onClose={onClose}
      footer={<><button className="btn-text" onClick={onClose}>取消</button><button className={"btn-primary" + (ok && !busy ? "" : " dis")} disabled={!ok || busy} onClick={submit}>{busy ? "保存中…" : "保存"}</button></>}>
      <div className="fld-lbl">连接名称 <span className="req">*</span></div>
      <input className="fld" placeholder="如：候选人中心" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="fld-lbl">请求地址 <span className="req">*</span></div>
      <div className="conn-url-row" style={{ display: "flex", gap: 10 }}>
        <select className="fld" style={{ width: 110 }} value={method} onChange={(e) => setMethod(e.target.value)}><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option></select>
        <input className="fld" placeholder="https://api.example.com/...  支持 {{变量}}" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="fld-lbl">鉴权方式</div>
      <select className="fld" value={auth} onChange={(e) => setAuth(e.target.value)}><option>无</option><option>API Key</option><option>Bearer Token</option><option>OAuth 2.0</option></select>
      <div className="gc-hint"><span className="muted" style={{ fontSize: 12.5 }}>提示：URL 与请求体里可用 {"{{变量名}}"} 占位；作为「自动注入」时用当前变量替换，作为「工具技能」时用模型入参替换。</span></div>
    </RkModal>
  );
}

/* ---------------- 上下文注入 ---------------- */
function ContextInject({ bot, mode, save }: { bot: BotOut; mode: "single" | "workflow"; save: (b: components["schemas"]["BotUpdate"]) => void }) {
  const [enabled, setEnabled] = useState(bot.context_enabled);
  const [tpl, setTpl] = useState(bot.context_template || "");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const first = useRef(true);

  // 模板防抖保存
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => save({ context_template: tpl }), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl]);

  const toggleEnabled = () => { const v = !enabled; setEnabled(v); save({ context_enabled: v }); };
  const insertVar = (token: string) => {
    const ta = taRef.current;
    if (!ta) { setTpl((t) => t + token); return; }
    const s = ta.selectionStart, e = ta.selectionEnd;
    setTpl((t) => t.slice(0, s) + token + t.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + token.length; });
  };
  const vars = (bot.variables as Var[]) ?? [];

  return (
    <div className="gc-pane fade-in">
      <div className="gc-head">
        <div><h3>上下文注入</h3><p>开启后，每轮对话把下方模板（变量已替换）拼到系统提示词最前，作为模型「已知信息」。{mode === "workflow" ? "工作流也可用「开始节点」声明入参。" : ""}</p></div>
        <button className="tg-wrap" onClick={toggleEnabled}><span className={"tg" + (enabled ? " on" : "")}><span className="tg-dot" /></span></button>
      </div>

      <div className="ctx-vars">
        <span className="ctx-vars-lbl">插入变量：</span>
        {["{{session.candidate_id}}", "{{session.resume}}", "{{session.jd}}", "{{sys.time}}"].map((tk) => (
          <button key={tk} className="ctx-var-chip" onClick={() => insertVar(tk)}>{tk}</button>
        ))}
        {vars.map((v, i) => {
          const tk = `{{${v.scope}.${v.name}}}`;
          return <button key={"v" + i} className="ctx-var-chip" onClick={() => insertVar(tk)}>{tk}</button>;
        })}
      </div>

      <textarea
        ref={taRef}
        className="st-input"
        style={{ minHeight: 200, opacity: enabled ? 1 : 0.55 }}
        value={tpl}
        placeholder={"【候选人简历】{{session.resume}}\n【目标 JD】{{session.jd}}\n\n（开启后这段会带入模型，{{变量}} 自动替换为实际值）"}
        onChange={(e) => setTpl(e.target.value)}
      />
      <div className="gc-hint"><span className="muted" style={{ fontSize: 12.5 }}>变量来源：创建会话时带入的会话变量、数据接入钩子写入的变量、变量管理里的默认值，以及系统变量。</span></div>
    </div>
  );
}
