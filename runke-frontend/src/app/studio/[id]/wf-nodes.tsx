"use client";

/* 工作流节点注册表 + 内嵌 body（移植自 Runke产品原型/data.jsx + nodes.jsx）。 */
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { api } from "@/lib/api/client";
import { RkModal } from "@/components/rk/Modal";

import {
  IcApp,
  IcCheck,
  IcChevDown,
  IcClose,
  IcCond,
  IcEnd,
  IcHuman,
  IcIntent,
  IcKb,
  IcKnowledge,
  IcLlm,
  IcPlus,
  IcReply,
  IcSkillNav,
  IcStart,
  IcVar,
  IcVoiceNode,
  Svg,
  type IcProps,
} from "@/components/icons/rk";
import { useVoices } from "@/lib/rk/voices";

const IcCode = (p: IcProps) => <Svg {...p}><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" /></Svg>;

export interface NodeType {
  key: string;
  label: string;
  color: string;
  Icon: (p: IcProps) => ReactNode;
  desc: string;
  soon?: boolean;
}

export const NODE_TYPES: Record<string, NodeType> = {
  start: { key: "start", label: "开始", color: "var(--n-start)", Icon: IcStart, desc: "工作流入口与初始参数" },
  llm: { key: "llm", label: "大模型", color: "var(--n-llm)", Icon: IcLlm, desc: "调用大模型生成回复" },
  kb: { key: "kb", label: "知识库", color: "var(--n-kb)", Icon: IcKb, desc: "检索知识库并注入" },
  variable: { key: "variable", label: "变量", color: "var(--n-var)", Icon: IcVar, desc: "读写运行变量" },
  reply: { key: "reply", label: "直接回答", color: "var(--n-reply)", Icon: IcReply, desc: "直接输出固定/模板回复" },
  voice: { key: "voice", label: "语音播报", color: "var(--n-reply)", Icon: IcVoiceNode, desc: "用指定音色播报话术（接语音通道 TTS）" },
  cond: { key: "cond", label: "条件分支", color: "var(--n-cond)", Icon: IcCond, desc: "按条件拆分多个分支" },
  intent: { key: "intent", label: "意图识别", color: "var(--n-intent)", Icon: IcIntent, desc: "大模型意图分类分流" },
  human: { key: "human", label: "转人工", color: "var(--n-human)", Icon: IcHuman, desc: "转人工并提醒" },
  app: { key: "app", label: "应用", color: "var(--n-app)", Icon: IcApp, desc: "调用已编排的单 Agent" },
  skill: { key: "skill", label: "技能", color: "var(--n-intent)", Icon: IcSkillNav, desc: "调用工具/SOP 技能" },
  code: { key: "code", label: "代码", color: "var(--n-llm)", Icon: IcCode, desc: "跑代码产出结构化数据" },
  end: { key: "end", label: "结束", color: "var(--n-start)", Icon: IcEnd, desc: "工作流结束" },
};

// 节点选择器分组（按会话编排的使用逻辑排序）。代码节点能力保留但不在选择器露出。
export const PICKER_GROUPS: { label: string; types: string[] }[] = [
  { label: "对话生成", types: ["llm", "kb", "reply", "voice"] },
  { label: "分支路由", types: ["intent", "cond"] },
  { label: "流程与调用", types: ["skill", "app", "variable", "human"] },
];

export interface GNode {
  id: string;
  type: string;
  x: number;
  y: number;
  fields: Record<string, unknown>;
  title?: string; // 自定义节点名称（缺省用类型名）
  desc?: string; // 自定义节点描述（缺省用类型描述）
}
export interface GEdge {
  from: string;
  to: string;
  port?: number; // 分支节点(cond/intent)出边对应的分支序号
}
export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

export function defaultFields(type: string): Record<string, unknown> {
  switch (type) {
    case "start":
      return { input: "用户输入的内容", welcome: "" };
    case "llm":
      return { input: "上一个节点的输出内容", model: "RunkeAI 4.0", output_json: false, prompt: "表示理解，简单复述用户的话 {{上一个节点的输出内容}}，并进行引导用户详细讲出目前的问题" };
    case "kb":
      return { input: "上一个节点的输出内容", items: [] };
    case "variable":
      return { rows: [{ var: "", op: "赋值", value: "", step: "" }] };
    case "reply":
      return { content: "" };
    case "voice":
      return { content: "", voiceId: "", voiceMode: "speak" };
    case "intent":
      return { input: "上一个节点的输出内容", model: "RunkeAI 4.0", branches: [{ name: "默认分支", desc: "" }, { name: "", desc: "" }] };
    case "cond":
      return { branches: [{ name: "默认分支", conds: [{ src: "开始节点的输出", op: "等于", val: "你好" }], match: "所有" }] };
    case "code":
      return { input: "上一个节点的输出内容", inputs: [{ name: "text", ref: "" }], code: "# 读取上游变量 inputs，把结果赋给 output\n# output 可以是对象，下游用 {{代码.字段}} 引用\noutput = {\"length\": len(str(inputs.get(\"text\", \"\")))}" };
    case "human":
      return { channel: "电子邮件" };
    case "skill":
      return { skillId: "" };
    case "app":
      return { botId: "" };
    default:
      return {};
  }
}

export function initialGraph(): Graph {
  return {
    nodes: [
      { id: "n_start", type: "start", x: 80, y: 150, fields: defaultFields("start") },
      { id: "n_llm", type: "llm", x: 470, y: 110, fields: defaultFields("llm") },
      { id: "n_kb", type: "kb", x: 870, y: 110, fields: defaultFields("kb") },
      { id: "n_end", type: "end", x: 1270, y: 165, fields: {} },
    ],
    edges: [
      { from: "n_start", to: "n_llm" },
      { from: "n_llm", to: "n_kb" },
      { from: "n_kb", to: "n_end" },
    ],
  };
}

/* ---------------- 基础控件 ---------------- */
export function NodeBadge({ type, s = 28 }: { type: string; s?: number }) {
  const t = NODE_TYPES[type];
  const Icon = t.Icon;
  return (
    <span className="node-badge" style={{ width: s, height: s, background: t.color }}>
      <Icon s={s * 0.62} sw={1.9} style={{ color: "#fff" }} />
    </span>
  );
}

/* 自定义下拉（替代原生 select）：触发块 + 浮层菜单，支持友好标签、勾选当前项、滚轮不带动画布。 */
function SelectBox({ value, onChange, options, ph, small, optionLabels }: { value: string; onChange?: (v: string) => void; options?: { value: string; label?: string }[] | string[]; ph?: string; small?: boolean; optionLabels?: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opts = (options || []).map((o) => (typeof o === "string" ? { value: o, label: undefined } : o));
  const lbl = (v: string) => (optionLabels && optionLabels[v]) || opts.find((o) => o.value === v)?.label || v;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (!onChange)
    return (
      <div className={"select-box" + (small ? " sm" : "")}>
        <span className={value ? "" : "ph"}>{value ? lbl(value) : ph}</span>
        <IcChevDown s={16} style={{ color: "var(--ink-3)" }} />
      </div>
    );
  return (
    <div ref={ref} className={"select-box ui" + (small ? " sm" : "") + (open ? " open" : "")} onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen((o) => !o)}>
      <span className={value ? "" : "ph"}>{value ? lbl(value) : ph || "请选择"}</span>
      <IcChevDown s={16} style={{ color: "var(--ink-3)", transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />
      {open && (
        <div className="sb-menu" onWheel={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {opts.length === 0 && <div className="sb-empty">无可选项</div>}
          {opts.map((o) => (
            <button type="button" key={o.value} className={"sb-opt" + (o.value === value ? " on" : "")} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{lbl(o.value)}</span>
              {o.value === value && <IcCheck s={15} sw={2.2} style={{ color: "var(--primary)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* 节点输入可选来源 */
const INPUT_SOURCES = ["上一个节点的输出内容", "开始节点的输出内容", "用户输入的内容"];

function InputSelect({ f, up }: { f: F; up: Up }) {
  return (
    <Panel>
      <Lbl>节点输入</Lbl>
      <SelectBox value={(f.input as string) || INPUT_SOURCES[0]} onChange={(v) => up({ input: v })} options={INPUT_SOURCES} />
    </Panel>
  );
}

/* 富提示词输入：contentEditable，{{变量}} 以 chip 内联显示、始终可编辑、可拉高 */
const _esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function promptToHtml(value: string): string {
  return _esc(value)
    .replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, v) => `<span class="chip-var" contenteditable="false" data-var="${_esc(v.trim())}">{{ ${_esc(v.trim())} }}</span>`)
    .replace(/\n/g, "<br>");
}

function serializePrompt(el: HTMLElement): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
    else if (n.nodeType === Node.ELEMENT_NODE) {
      const e = n as HTMLElement;
      if (e.dataset && e.dataset.var != null) out += `{{${e.dataset.var}}}`;
      else if (e.tagName === "BR") out += "\n";
      else out += e.textContent ?? "";
    }
  });
  return out;
}

/* 可插入的变量选项（按分组）。由 WorkflowCanvas 依据图与全局配置注入。 */
export interface VarOption { group: string; label: string; token: string }
export const VarOptionsContext = createContext<VarOption[]>([]);

/** 「{ 插入变量 }」下拉，复用在带变量的文本框右上角。 */
function VarInsert({ options, onInsert }: { options: VarOption[]; onInsert: (token: string) => void }) {
  const [menu, setMenu] = useState(false);
  const groups: string[] = [];
  for (const o of options) if (!groups.includes(o.group)) groups.push(o.group);
  return (
    <span className="np-right" style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
      <span className="link-blue" onClick={() => setMenu((m) => !m)}>{"{ 插入变量 }"}</span>
      {menu && (
        <>
          <div className="varmenu-mask" onClick={() => setMenu(false)} />
          <div className="varmenu" onWheel={(e) => e.stopPropagation()}>
            {options.length === 0 && <div className="varmenu-empty">暂无可用变量</div>}
            {groups.map((g) => (
              <div key={g}>
                <div className="varmenu-group">{g}</div>
                {options.filter((o) => o.group === g).map((o) => (
                  <button key={o.token} className="varmenu-item" onClick={() => { onInsert(o.token); setMenu(false); }}>
                    <span className="varmenu-label">{o.label}</span>
                    <code>{`{{${o.token}}}`}</code>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function RichPrompt({ value, onChange, ph, label }: { value: string; onChange: (v: string) => void; ph: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string>("");
  const [menu, setMenu] = useState(false);
  const options = useContext(VarOptionsContext);

  // 仅当外部值与内部序列化不一致时回填，避免打断输入/光标
  useEffect(() => {
    const el = ref.current;
    if (el && value !== last.current) {
      el.innerHTML = promptToHtml(value);
      last.current = value;
    }
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const v = serializePrompt(el);
    last.current = v;
    onChange(v);
  };

  const insertToken = (token: string) => {
    setMenu(false);
    const el = ref.current;
    if (!el) return;
    el.focus();
    const chip = `<span class="chip-var" contenteditable="false" data-var="${_esc(token)}">{{ ${_esc(token)} }}</span>&nbsp;`;
    document.execCommand("insertHTML", false, chip);
    emit();
  };

  const custom = () => {
    const name = window.prompt("自定义变量名（如 global.store_addr）", "");
    if (name && name.trim()) insertToken(name.trim());
  };

  // 分组
  const groups: string[] = [];
  for (const o of options) if (!groups.includes(o.group)) groups.push(o.group);

  return (
    <div onMouseDown={(e) => e.stopPropagation()}>
      <div className="np-lbl">{label}
        <span className="np-right" style={{ position: "relative" }}>
          <span className="link-blue" onClick={() => setMenu((m) => !m)}>{"{ 插入变量 }"}</span>
          {menu && (
            <>
              <div className="varmenu-mask" onClick={() => setMenu(false)} />
              <div className="varmenu" onWheel={(e) => e.stopPropagation()}>
                {options.length === 0 && <div className="varmenu-empty">暂无可用变量</div>}
                {groups.map((g) => (
                  <div key={g}>
                    <div className="varmenu-group">{g}</div>
                    {options.filter((o) => o.group === g).map((o) => (
                      <button key={o.token} className="varmenu-item" onClick={() => insertToken(o.token)}>
                        <span className="varmenu-label">{o.label}</span>
                        <code>{`{{${o.token}}}`}</code>
                      </button>
                    ))}
                  </div>
                ))}
                <button className="varmenu-item custom" onClick={custom}>自定义变量…</button>
              </div>
            </>
          )}
        </span>
      </div>
      <div
        ref={ref}
        className="rich-edit rk-prompt"
        contentEditable
        suppressContentEditableWarning
        data-ph={ph}
        onInput={emit}
        onBlur={emit}
      />
    </div>
  );
}

const Panel = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => <div className="np" style={style}>{children}</div>;
const Lbl = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="np-lbl">{children}{right && <span className="np-right">{right}</span>}</div>
);

type Up = (patch: Record<string, unknown>) => void;
type F = Record<string, unknown>;

/* ---------------- node bodies ---------------- */
function BodyStart({ f, up }: { f: F; up: Up }) {
  // 开始节点是工作流入口：输入即用户问题（只读）+ 可配置开场白（对话第一句）
  const varOpts = useContext(VarOptionsContext);
  const welcomeRef = useRef<HTMLTextAreaElement>(null);
  const insertVar = (token: string) => {
    const el = welcomeRef.current;
    const cur = (f.welcome as string) || "";
    if (!el) { up({ welcome: cur + `{{${token}}}` }); return; }
    const s = el.selectionStart ?? cur.length, e = el.selectionEnd ?? cur.length;
    up({ welcome: cur.slice(0, s) + `{{${token}}}` + cur.slice(e) });
  };
  return (
    <Panel>
      <Lbl>节点输入</Lbl>
      <div className="np-field"><span className="chip-gray"><span>{(f.input as string) || "用户输入的内容"}</span></span></div>
      <Lbl right={<VarInsert options={varOpts} onInsert={insertVar} />}>开场白</Lbl>
      <textarea ref={welcomeRef} className="np-textarea" style={{ minHeight: 72 }} maxLength={300}
        placeholder="如：你好{{session.cand_name}}，我是…（留空表示开场由后续节点动态生成）"
        value={(f.welcome as string) || ""} onChange={(e) => up({ welcome: e.target.value })} />
    </Panel>
  );
}

function BodyLlm({ f, up }: { f: F; up: Up }) {
  return (
    <>
      <InputSelect f={f} up={up} />
      <Panel>
        <Lbl>配置模型</Lbl>
        <SelectBox value={(f.model as string) || "RunkeAI 4.0"} onChange={(v) => up({ model: v })} options={["RunkeAI 4.0", "RunkeAI 3.5", "RunkeAI Lite"]} />
      </Panel>
      <Panel>
        <RichPrompt label="提示词" value={f.prompt as string} onChange={(v) => up({ prompt: v })} ph="请输入系统提示词，这决定了机器人的角色、功能和特点。请尽量使用具体且详细的描述，效果更佳。" />
        <div className="skill-row" style={{ marginTop: 12 }}>
          <div><b>输出 JSON</b><i>把回复解析为 JSON 对象，下游可用 {"{{大模型.data.字段}}"} 引用</i></div>
          <button className="tg-wrap" onClick={() => up({ output_json: !f.output_json })}><span className={"tg" + (f.output_json ? " on" : "")}><span className="tg-dot" /></span></button>
        </div>
      </Panel>
    </>
  );
}

interface KbItem { id: string; code: string; name: string; desc: string; }
interface KbRow { id: string; name: string; description: string }

function BodyKb({ f, up }: { f: F; up: Up }) {
  const items = (f.items as KbItem[]) || [];
  const [pick, setPick] = useState(false);
  const remove = (id: string) => up({ items: items.filter((i) => i.id !== id) });
  return (
    <>
      <InputSelect f={f} up={up} />
      <Panel>
        <Lbl>知识库</Lbl>
        <div className="kb-list">
          {items.length === 0 && <div className="np-hint" style={{ marginTop: 0 }}>尚未关联知识库，点击下方从知识库中选择。</div>}
          {items.map((it) => (
            <div key={it.id} className="kb-item sel">
              <div className="kb-item-top">
                <span className="kb-tag"><IcKnowledge s={14} style={{ color: "var(--ink-3)" }} /></span>
                <b>{it.code ? `[${it.code}] ` : ""}{it.name}</b>
                <span className="link-blue kb-remove" onClick={() => remove(it.id)}>移除</span>
              </div>
              {it.desc && <div className="kb-desc">{it.desc}</div>}
            </div>
          ))}
          <button className="dashed-btn" onClick={() => setPick(true)}>
            <IcPlus s={15} /> 添加知识库
          </button>
        </div>
      </Panel>
      {pick && createPortal(
        <KbNodePicker
          selected={items.map((i) => i.id)}
          onClose={() => setPick(false)}
          onConfirm={(rows) => {
            up({ items: rows.map((r) => ({ id: r.id, code: "", name: r.name, desc: r.description })) });
            setPick(false);
          }}
        />,
        document.body,
      )}
    </>
  );
}

function KbNodePicker({ selected, onClose, onConfirm }: { selected: string[]; onClose: () => void; onConfirm: (rows: KbRow[]) => void }) {
  const [sel, setSel] = useState<string[]>(selected);
  const { data: kbs } = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/knowledge-bases");
      if (error) throw error;
      return data.data as KbRow[];
    },
  });
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <RkModal
      title="添加知识库"
      w={540}
      onClose={onClose}
      footer={<><button className="btn-text" onClick={onClose}>取消</button><button className="btn-primary" onClick={() => onConfirm((kbs || []).filter((k) => sel.includes(k.id)))}>确定（{sel.length}）</button></>}
    >
      <div className="kb-list">
        {(kbs || []).length === 0 && <p className="muted" style={{ fontSize: 13 }}>还没有知识库，去「知识库」创建一个。</p>}
        {(kbs || []).map((k) => {
          const on = sel.includes(k.id);
          return (
            <button key={k.id} className={"kb-item" + (on ? " sel" : "")} style={{ width: "100%", textAlign: "left", display: "flex", gap: 11, alignItems: "center" }} onClick={() => toggle(k.id)}>
              <span className="sk-ic" style={{ background: "#FFEAE4", width: 36, height: 36, borderRadius: 9, display: "grid", placeItems: "center", flex: "none" }}>
                <IcKnowledge s={18} style={{ color: "var(--n-kb)" }} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontWeight: 600, fontSize: 14.5, display: "block" }}>{k.name}</b>
                <i style={{ fontStyle: "normal", fontSize: 12.5, color: "var(--ink-3)" }}>{k.description || "知识库"}</i>
              </span>
              <span className={"skp-check" + (on ? " on" : "")}>{on && <IcCheck s={14} sw={2.4} style={{ color: "#fff" }} />}</span>
            </button>
          );
        })}
      </div>
    </RkModal>
  );
}

/* 变量节点行。新格式：var=全局配置中定义的变量(全限定 token)，op=操作；
   旧格式 {name,value,inc,step} 由 migrateVarRow 兼容显示（保存即升级为新格式）。 */
interface VarRow { var?: string; op?: string; name?: string; value: string; inc?: string; step: string; }
const VAR_OPS = ["赋值", "递增", "递减", "追加", "清空"];
const migrateVarRow = (r: VarRow): VarRow => ({
  var: r.var ?? r.name ?? "",
  op: r.op ?? (r.inc === "递增" ? "递增" : "赋值"),
  value: r.value ?? "",
  step: r.step ?? "",
});
function BodyVariable({ f, up }: { f: F; up: Up }) {
  const rows = ((f.rows as VarRow[]) || []).map(migrateVarRow);
  const varOpts = useContext(VarOptionsContext);
  // 只允许写「全局配置」里定义的变量（系统/客户/节点输出是只读来源，不可被节点改写）
  const writable = varOpts.filter((o) => o.group === "全局变量" || o.group === "会话变量");
  const optLabels: Record<string, string> = {};
  writable.forEach((o) => { optLabels[o.token] = `${o.group} · ${o.label}`; });
  const set = (i: number, patch: Partial<VarRow>) => up({ rows: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const del = (i: number) => up({ rows: rows.filter((_, j) => j !== i) });
  const needValue = (op?: string) => op === "赋值" || op === "追加";
  const needStep = (op?: string) => op === "递增" || op === "递减";
  return (
    <Panel>
      {writable.length === 0 && (
        <div className="np-hint">尚未定义任何变量——请先在「全局配置 → 变量」中统一定义，再回到此节点选择操作。</div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="var-row">
          {i > 0 && <div className="var-divider" />}
          <div className="var-grid">
            <div className="var-cell"><div className="np-mini">变量 {i + 1}</div>
              <SelectBox small value={r.var || ""} ph="选择已定义的变量" onChange={(v) => set(i, { var: v })}
                options={writable.map((o) => o.token)} optionLabels={optLabels} /></div>
            <div className="var-cell"><div className="np-mini">操作</div>
              <SelectBox small value={r.op || "赋值"} onChange={(v) => set(i, { op: v, step: needStep(v) && !(r.step || "").trim() ? "1" : r.step })} options={VAR_OPS} /></div>
            {needStep(r.op) ? (
              <div className="var-cell"><div className="np-mini">步长</div>
                <input className="vin" placeholder="如 1" value={r.step || ""} onChange={(e) => set(i, { step: e.target.value })} /></div>
            ) : (
              <div className="var-cell" style={{ gridColumn: "span 2" }}><div className="np-mini">{r.op === "清空" ? "说明" : "值"}</div>
                {r.op === "清空"
                  ? <div className="np-hint" style={{ margin: 0 }}>执行时将该变量置为空</div>
                  : <input className="vin" placeholder="支持 {{变量}} 占位" value={r.value} onChange={(e) => set(i, { value: e.target.value })} />}
              </div>
            )}
          </div>
          {i > 0 && <div className="var-del"><span className="link-blue" onClick={() => del(i)}>删除操作</span></div>}
        </div>
      ))}
      <button className="dashed-btn wide" onClick={() => up({ rows: [...rows, { var: "", op: "赋值", value: "", step: "" }] })}><IcPlus s={15} /> 添加操作</button>
    </Panel>
  );
}

function BodyReply({ f, up }: { f: F; up: Up }) {
  return (
    <Panel>
      <RichPrompt label="回复内容" value={f.content as string} onChange={(v) => up({ content: v })} ph="请输入回复内容，支持插入 {{变量}}。" />
    </Panel>
  );
}

function BodyVoice({ f, up }: { f: F; up: Up }) {
  const { data: voices = [] } = useVoices();
  return (
    <>
      <Panel>
        <RichPrompt label="播报话术" value={f.content as string} onChange={(v) => up({ content: v })} ph="请输入要播报的话术，支持插入 {{变量}}。" />
      </Panel>
      <Panel>
        <Lbl>音色</Lbl>
        <SelectBox value={(f.voiceId as string) || ""} onChange={(v) => up({ voiceId: v })} ph="跟随智能体默认音色"
          options={[{ value: "", label: "跟随智能体默认" }, ...voices.map((v) => ({ value: v.id, label: v.name }))]} />
        <Lbl>播报方式</Lbl>
        <SelectBox value={(f.voiceMode as string) || "speak"} onChange={(v) => up({ voiceMode: v })}
          options={[{ value: "speak", label: "仅播报" }, { value: "gather", label: "播报后等待应答" }]} />
      </Panel>
    </>
  );
}

interface IntentBranch { name: string; desc: string; }
function BodyIntent({ f, up }: { f: F; up: Up }) {
  const branches = (f.branches as IntentBranch[]) || [];
  const set = (i: number, k: keyof IntentBranch, v: string) => up({ branches: branches.map((b, j) => (j === i ? { ...b, [k]: v } : b)) });
  const del = (i: number) => up({ branches: branches.filter((_, j) => j !== i) });
  return (
    <>
      <InputSelect f={f} up={up} />
      <Panel><Lbl>选择模型</Lbl><SelectBox value={(f.model as string) || "RunkeAI 4.0"} onChange={(v) => up({ model: v })} options={["RunkeAI 4.0", "RunkeAI 3.5"]} /></Panel>
      <Panel>
        {branches.map((b, i) => (
          <div key={i} className="br-block">
            {i > 0 && <div className="var-divider" />}
            <Lbl right={i > 0 ? <span className="link-blue" onClick={() => del(i)}>删除分支</span> : null}>分支{i + 1}</Lbl>
            <input className="np-input" placeholder="请输入分支名" value={b.name} onChange={(e) => set(i, "name", e.target.value)} />
            <div className="np-mini" style={{ marginTop: 10 }}>情况描述</div>
            <textarea className="np-textarea sm" placeholder="请描述在什么情况下执行该分支" value={b.desc} onChange={(e) => set(i, "desc", e.target.value)} />
          </div>
        ))}
        <button className="dashed-btn wide" onClick={() => up({ branches: [...branches, { name: "", desc: "" }] })}><IcPlus s={15} /> 添加分支</button>
      </Panel>
    </>
  );
}

interface Cond { src: string; op: string; val: string; }
interface CondBranch { name: string; conds: Cond[]; match: string; }
function BodyCond({ f, up }: { f: F; up: Up }) {
  const branches = (f.branches as CondBranch[]) || [];
  // 来源候选：节点输出 + 可用变量（来自变量节点/全局配置/客户/系统）
  const varOpts = useContext(VarOptionsContext);
  const NODE_SRCS = ["开始节点的输出", "大模型的输出", "知识库的输出"];
  const srcOptions = [...NODE_SRCS, ...varOpts.map((v) => v.token)];
  const srcLabels: Record<string, string> = {};
  varOpts.forEach((v) => { srcLabels[v.token] = `${v.group} · ${v.label}`; });
  const setB = (i: number, patch: Partial<CondBranch>) => up({ branches: branches.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const setCond = (bi: number, ci: number, k: keyof Cond, v: string) => setB(bi, { conds: branches[bi].conds.map((c, j) => (j === ci ? { ...c, [k]: v } : c)) });
  const addCond = (bi: number) => setB(bi, { conds: [...branches[bi].conds, { src: "", op: "等于", val: "" }] });
  const delCond = (bi: number, ci: number) => setB(bi, { conds: branches[bi].conds.filter((_, j) => j !== ci) });
  const delBranch = (i: number) => up({ branches: branches.filter((_, j) => j !== i) });
  return (
    <Panel>
      {branches.map((b, i) => (
        <div key={i} className="br-block">
          {i > 0 && <div className="var-divider" />}
          <Lbl right={i > 0 ? <span className="link-blue" onClick={() => delBranch(i)}>删除分支</span> : null}>条件分支 {i + 1}</Lbl>
          <input className="np-input" value={b.name} onChange={(e) => setB(i, { name: e.target.value })} />
          {b.conds.map((c, ci) => (
            <div key={ci} className="cond-row">
              <SelectBox small value={c.src} ph="选择来源/变量" onChange={(v) => setCond(i, ci, "src", v)} options={srcOptions} optionLabels={srcLabels} />
              <SelectBox small value={c.op} onChange={(v) => setCond(i, ci, "op", v)} options={["等于", "不等于", "包含", "不包含", "大于", "小于", "大于等于", "小于等于", "为空", "非空"]} />
              {c.op === "为空" || c.op === "非空"
                ? <span className="cond-noval">无需取值</span>
                : <input className="vin" placeholder="请输入" value={c.val} onChange={(e) => setCond(i, ci, "val", e.target.value)} />}
              <button className="cond-x" onClick={() => delCond(i, ci)}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button>
            </div>
          ))}
          <div className="cond-foot">
            <span className="link-blue" onClick={() => addCond(i)}>+ 添加条件</span>
            <span className="cond-match">符合以上 <SelectBox small value={b.match} onChange={(v) => setB(i, { match: v })} options={["所有", "任一"]} /> 条件</span>
          </div>
        </div>
      ))}
      <div className="var-divider" />
      <Lbl>条件分支</Lbl>
      <input className="np-input" defaultValue="默认分支" />
      <div className="np-hint">用于定义当如果()条件不满足时执行的逻辑</div>
      <button className="dashed-btn wide" onClick={() => up({ branches: [...branches, { name: "默认分支", conds: [{ src: "", op: "等于", val: "" }], match: "所有" }] })}><IcPlus s={15} /> 添加分支</button>
    </Panel>
  );
}

interface CodeIn { name: string; ref: string }
function BodyCode({ f, up }: { f: F; up: Up }) {
  const varOpts = useContext(VarOptionsContext);
  const ins = (f.inputs as CodeIn[]) || [];
  const setIn = (i: number, k: keyof CodeIn, v: string) => up({ inputs: ins.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  const refLabels: Record<string, string> = {};
  varOpts.forEach((v) => { refLabels[v.token] = `${v.group} · ${v.label}`; });
  return (
    <>
      <InputSelect f={f} up={up} />
      <Panel>
        <Lbl right={<span className="link-blue" onClick={() => up({ inputs: [...ins, { name: "", ref: "" }] })}>+ 添加入参</span>}>输入变量</Lbl>
        {ins.length === 0 && <div className="np-hint">声明传给代码的变量；代码里用 <code>inputs[&apos;名称&apos;]</code> 读取。</div>}
        {ins.map((r, i) => (
          <div key={i} className="cond-row" style={{ marginBottom: 8 }}>
            <input className="vin" style={{ flex: "0 0 120px" }} placeholder="变量名" value={r.name} onChange={(e) => setIn(i, "name", e.target.value)} />
            <SelectBox small value={r.ref} ph="选择来源/变量" onChange={(v) => setIn(i, "ref", v)} options={varOpts.map((v) => v.token)} optionLabels={refLabels} />
            <button className="cond-x" onClick={() => up({ inputs: ins.filter((_, j) => j !== i) })}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button>
          </div>
        ))}
        <Lbl>代码（Python）</Lbl>
        <textarea className="st-input" style={{ minHeight: 150, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }} value={(f.code as string) || ""} onChange={(e) => up({ code: e.target.value })} spellCheck={false} />
        <div className="np-hint">把结果赋给 <code>output</code>（对象/数组/标量）。可用 json/re/math/datetime；禁止 import。下游用 {"{{代码.字段}}"} 引用。</div>
      </Panel>
    </>
  );
}

function BodyHuman({ f, up }: { f: F; up: Up }) {
  return <Panel><Lbl>人工回复通知渠道</Lbl><SelectBox value={f.channel as string} onChange={(v) => up({ channel: v })} options={["电子邮件", "企业微信", "短信"]} /></Panel>;
}

interface SkillArg { name: string; value: string }
function BodySkill({ f, up }: { f: F; up: Up }) {
  const varOpts = useContext(VarOptionsContext);
  const { data: skills } = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/skills");
      if (error) throw error;
      return data.data;
    },
  });
  const skillId = (f.skillId as string) || "";
  const skill = (skills || []).find((s) => s.id === skillId);
  const args = (f.args as SkillArg[]) || [];
  const setArg = (i: number, k: keyof SkillArg, v: string) => up({ args: args.map((a, j) => (j === i ? { ...a, [k]: v } : a)) });
  // 工具技能可按入参一键生成映射行
  const inputNames = ((skill?.inputs as { name?: string }[]) || []).map((x) => x.name).filter(Boolean) as string[];
  return (
    <>
      <InputSelect f={f} up={up} />
      <Panel>
        <Lbl>调用技能</Lbl>
        <SelectBox value={skillId} ph="请选择一个技能" onChange={(v) => up({ skillId: v })}
          options={(skills || []).map((s) => ({ value: s.id, label: `${s.name}（${SK_LABEL[s.skill_type] || s.skill_type}）` }))} />
        <Lbl right={
          <span className="np-right" style={{ gap: 10 }}>
            {inputNames.length > 0 && <span className="link-blue" onClick={() => up({ args: inputNames.map((n) => ({ name: n, value: "" })) })}>按入参生成</span>}
            <span className="link-blue" onClick={() => up({ args: [...args, { name: "", value: "" }] })}>+ 添加参数</span>
          </span>
        }>参数映射（可选）</Lbl>
        {args.length === 0 && <div className="np-hint">留空则把上一步输出交给技能、由模型自动推参；填了参数映射则按映射确定性调用。</div>}
        {args.map((a, i) => (
          <div key={i} className="cond-row" style={{ marginBottom: 8 }}>
            <input className="vin" style={{ flex: "0 0 120px" }} placeholder="参数名" value={a.name} onChange={(e) => setArg(i, "name", e.target.value)} />
            <input className="vin" placeholder="值，支持 {{变量}}" value={a.value} onChange={(e) => setArg(i, "value", e.target.value)} />
            <button className="cond-x" onClick={() => up({ args: args.filter((_, j) => j !== i) })}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button>
          </div>
        ))}
        {varOpts.length > 0 && args.length > 0 && <div className="np-hint">变量可用：{varOpts.slice(0, 6).map((v) => `{{${v.token}}}`).join("、")} …</div>}
      </Panel>
    </>
  );
}
const SK_LABEL: Record<string, string> = { tool: "工具", sop: "SOP", builtin: "内置" };

function BodyApp({ f, up }: { f: F; up: Up }) {
  const { data: bots } = useQuery({
    queryKey: ["bots", "single"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/bots");
      if (error) throw error;
      return data.data.filter((b) => b.orchestration_type === "single");
    },
  });
  const botId = (f.botId as string) || "";
  return (
    <>
      <InputSelect f={f} up={up} />
      <Panel>
      <Lbl>选择已编排的单 Agent</Lbl>
      <SelectBox value={botId} ph="请选择一个智能体" onChange={(v) => up({ botId: v })}
        options={(bots || []).map((b) => ({ value: b.id, label: b.name + (b.bot_role ? ` · ${b.bot_role}` : "") }))} />
      <div className="np-hint">应用节点会把上一步输出交给该单 Agent 运行，并取其回复作为本节点输出。</div>
    </Panel>
    </>
  );
}

export const NODE_BODIES: Record<string, (p: { f: F; up: Up }) => ReactNode> = {
  start: BodyStart, llm: BodyLlm, kb: BodyKb, variable: BodyVariable,
  reply: BodyReply, voice: BodyVoice, intent: BodyIntent, cond: BodyCond, human: BodyHuman, skill: BodySkill, app: BodyApp, code: BodyCode,
};
