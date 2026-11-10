"use client";

/* 工作流编辑器（新版）：左侧画布（精简卡 + 自动布局 + 手动微调）+ AI 编排 / 预览和调试。
 * 机制对标 Claude Code 的 agent 主循环：AI 通过 edit_graph 工具流式下发图操作
 * （前端实时应用、布局自动重排），通过 run_preview 自己发测试消息、读 trace、自检自修。
 * 图直接读写 bot.workflow_definition（运行时/发布/语音链路共用）；
 * bot.workflow_exp 仅存 AI 编排对话历史 {messages}。 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { IcCheck, IcClose, IcExperience, IcPencil, IcSend, IcTrash, IcVoiceNode as IcVoiceCfg } from "@/components/icons/rk";
import { Markdown } from "@/components/rk/Markdown";
import { VoiceConfigModal } from "@/components/rk/VoiceConfigModal";
import { api, API_BASE } from "@/lib/api/client";
import { avatarDataUri } from "@/lib/rk/avatar";
import { useAuth } from "@/lib/store/auth";
import {
  defaultFields,
  NODE_BODIES,
  NODE_TYPES,
  NodeBadge,
  VarOptionsContext,
  type GNode,
  type Graph,
  type VarOption,
} from "./wf-nodes";
import { applyOpsToGraph, ExpCanvas, type ExpCanvasHandle, type GraphOp } from "./wf-exp-canvas";
import { PreviewPanel, RunSteps, type RunStep, type RunSummary } from "./wf-preview";

/* ---------------- 类型 ---------------- */
interface RunTurn { user: string; reply: string; error?: string; steps: RunStep[]; summary?: RunSummary; variables?: Record<string, string> }
/* 助手消息 = 分块时间线（对标 Claude Code 的 transcript）：文字/思考/工具状态条/计划卡/自测块交错 */
type ChatItem =
  | { kind: "text"; text: string }
  | { kind: "think"; text: string }
  | { kind: "tool"; tool: string; label: string; status: "run" | "ok" | "err" }
  | { kind: "plan"; steps: { text: string; status: string }[] }
  | { kind: "run"; turn: RunTurn };
interface ChatMsg { id: string; role: "user" | "assistant"; content: string; items?: ChatItem[]; ops?: number; runs?: RunTurn[]; snapshot?: Graph; running?: boolean }
interface ExpData { graph?: Graph; messages?: ChatMsg[] }

const TOOL_LABELS: Record<string, string> = {
  edit_graph: "修改画布编排",
  run_preview: "自测预演",
  manage_variables: "更新变量定义",
  set_plan: "拟定计划",
};

/* RunSteps 的 graph 仅用于节点标题兜底；trace 步骤已自带 title，这里传空图即可 */
const EMPTY_GRAPH: Graph = { nodes: [], edges: [] };

const emptyGraph = (): Graph => ({
  nodes: [
    { id: "n_start", type: "start", x: 0, y: 0, fields: { input: "用户输入的内容", welcome: "" } },
    { id: "n_end", type: "end", x: 0, y: 0, fields: {} },
  ],
  edges: [{ from: "n_start", to: "n_end" }],
});

const stripMsgs = (msgs: ChatMsg[]): ChatMsg[] =>
  // 落库瘦身：快照/streaming 态不存（回滚仅会话内有效），run 步骤裁条数、思考块截断
  msgs.slice(-40).map((m) => ({
    id: m.id, role: m.role, content: m.content, ops: m.ops,
    runs: m.runs?.map((t) => ({ ...t, steps: t.steps.slice(0, 30) })),
    items: m.items?.map((it) =>
      it.kind === "run" ? { ...it, turn: { ...it.turn, steps: it.turn.steps.slice(0, 30) } }
      : it.kind === "think" ? { ...it, text: it.text.slice(0, 400) }
      : it),
  }));

/* AI 编排 SSE（与 streamCompletion 同协议，不同端点）。
 * 可取消 + 空闲看门狗：连接半开/服务重启等情况下不再无限转点。
 * 后端在等首 token / 长耗时工具期间每 ~10s 发心跳注释保活，正常不会触发；
 * 150s 仅作兜底上限，覆盖偶发首 token 延迟尖刺（实测见过 80s+）。 */
const IDLE_TIMEOUT_MS = 150_000;

async function streamWfAgent(
  botId: string,
  messages: { role: string; content: string }[],
  graph: Graph,
  onEvent: (p: Record<string, unknown>) => void,
  ctrl: AbortController,
): Promise<void> {
  const token = useAuth.getState().token;
  const resp = await fetch(`${API_BASE}/api/v1/bots/${botId}/wf-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages, graph }),
    signal: ctrl.signal,
  });
  if (!resp.ok || !resp.body) throw new Error(`wf-agent failed: ${resp.status}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    // 空闲看门狗：超过 IDLE_TIMEOUT 没有任何字节就中止（自测多轮间隔也远小于此）
    const watchdog = setTimeout(() => ctrl.abort(), IDLE_TIMEOUT_MS);
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } finally {
      clearTimeout(watchdog);
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch { /* 半包忽略 */ }
    }
  }
}

/* ---------------- 主组件 ---------------- */
interface BotVar { name: string; scope: string; label?: string; value?: string }

export interface WorkflowExpHandle { save: () => Promise<void> }

export const WorkflowExp = forwardRef<WorkflowExpHandle, { bot: { id: string; name: string; workflow_definition?: Record<string, unknown>; workflow_exp?: Record<string, unknown>; variables?: unknown[]; voice_config?: Record<string, unknown> } }>(
function WorkflowExp({ bot }, ref) {
  const botId = bot.id;
  const exp = (bot.workflow_exp ?? {}) as ExpData;
  const botVars = useMemo(() => (bot.variables ?? []) as BotVar[], [bot.variables]);
  const voiceCfg = (bot.voice_config ?? {}) as { enabled?: boolean; voice_id?: string | null; mode?: string; outbound?: boolean; barge_in?: boolean };
  const canvasRef = useRef<ExpCanvasHandle>(null);
  // 与正式画布一致的交互：右上角悬浮按钮（AI 编排 / 语音配置 / 预览和调试），面板按需打开
  const [panel, setPanel] = useState<"ai" | "debug" | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspect, setInspect] = useState(false);
  // 历史消息归一化：把曾被中断/旧版本存下的「转圈中」状态条收为完成态
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => (Array.isArray(exp.messages) ? exp.messages : []).map((m) => ({
    ...m,
    running: false,
    items: m.items?.map((it) => (it.kind === "tool" && it.status === "run" ? { ...it, status: "ok" as const } : it)),
  })));
  const msgsRef = useRef(msgs);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  /* 图状态归属本组件，直接对应 workflow_definition。
   * 兜底顺序：正式定义 → 未迁移的旧实验图 → 空图（start→end）。 */
  const [graph, setGraph] = useState<Graph>(() => {
    const def = bot.workflow_definition as unknown as Graph | undefined;
    if (def && Array.isArray(def.nodes) && def.nodes.length) return def;
    if (exp.graph && Array.isArray(exp.graph.nodes) && exp.graph.nodes.length) return exp.graph;
    return emptyGraph();
  });
  const graphRef = useRef(graph);
  useEffect(() => { graphRef.current = graph; }, [graph]);
  const replaceGraph = (g: Graph) => { graphRef.current = g; setGraph(g); setSelected(null); setInspect(false); };
  const applyOps = (ops: GraphOp[]) => {
    const { graph: next } = applyOpsToGraph(graphRef.current, ops);
    graphRef.current = next;
    setGraph(next);
  };
  /* 节点弹窗的就地编辑：内容微调归用户，结构调整归 AI */
  const setGraphNow = (next: Graph) => { graphRef.current = next; setGraph(next); };
  const updateNodeFields = (id: string, patch: Record<string, unknown>) =>
    setGraphNow({ ...graphRef.current, nodes: graphRef.current.nodes.map((n) => (n.id === id ? { ...n, fields: { ...n.fields, ...patch } } : n)) });
  const renameNode = (id: string, patch: { title?: string; desc?: string }) =>
    setGraphNow({ ...graphRef.current, nodes: graphRef.current.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  const moveNode = (id: string, x: number, y: number) =>
    setGraphNow({ ...graphRef.current, nodes: graphRef.current.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) });
  // 一键排版：清掉所有手动位置（x/y 归零 = 回到纯自动布局）
  const resetLayout = () =>
    setGraphNow({ ...graphRef.current, nodes: graphRef.current.nodes.map((n) => ({ ...n, x: 0, y: 0 })) });
  /* 删除节点：与 AI 同一套 ops（删节点并清掉相连边）；开始节点受保护 */
  const deleteNode = (id: string) => {
    const n = graphRef.current.nodes.find((x) => x.id === id);
    if (!n || n.type === "start") return;
    applyOps([{ op: "delete_node", id }]);
    setSelected(null);
    setInspect(false);
  };
  // 键盘删除：选中节点且焦点不在输入框时，Delete/Backspace 直删
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || (document.activeElement as HTMLElement)?.isContentEditable) return;
      if (selected) { e.preventDefault(); deleteNode(selected); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  /* 手动加节点（选择器默认收起，展开后可用）：
   * 点击 = 插到当前选中节点之后并自动接线（与正式画布同语义）；拖拽 = 落点处独立放置。 */
  const addNode = (type: string, at?: { x: number; y: number }) => {
    const g = graphRef.current;
    const id = `n_${type}_${Date.now()}`;
    const node: GNode = { id, type, x: at?.x ?? 0, y: at?.y ?? 0, fields: defaultFields(type) };
    let edges = [...g.edges];
    const sel = selected ? g.nodes.find((n) => n.id === selected) : undefined;
    if (!at && sel && sel.type !== "end" && sel.type !== "cond" && sel.type !== "intent") {
      const out = edges.find((e) => e.from === sel.id);
      if (out) { edges = edges.filter((e) => e !== out); edges.push({ from: sel.id, to: id }, { from: id, to: out.to }); }
      else edges.push({ from: sel.id, to: id });
    }
    setGraphNow({ nodes: [...g.nodes, node], edges });
    setSelected(id);
    setInspect(true); // 加完直接打开弹窗配置
  };

  /* 「插入变量」候选（节点弹窗编辑用，与正式画布同规则的精简版） */
  const varOptions: VarOption[] = useMemo(() => {
    const opts: VarOption[] = [
      { group: "节点", label: "上一个节点的输出内容", token: "上一个节点的输出内容" },
      { group: "节点", label: "上一个节点的输入内容", token: "上一个节点的输入内容" },
    ];
    const OUT_FIELDS: Record<string, string[]> = {
      start: ["query"], llm: ["text", "data"], kb: ["text", "count"], reply: ["text"],
      intent: ["branch"], cond: ["branch"], skill: ["text"], app: ["text"], code: ["output"],
    };
    graph.nodes.forEach((n) => {
      if (n.type === "variable") return;
      const title = (n.title ?? "").trim() || NODE_TYPES[n.type]?.label || n.type;
      (OUT_FIELDS[n.type] || []).forEach((fld) => opts.push({ group: "节点输出", label: `${title}.${fld}`, token: `${title}.${fld}` }));
    });
    botVars.forEach((v) => {
      if (!v.name?.trim()) return;
      const scope = v.scope === "session" ? "session" : "global";
      opts.push({ group: scope === "session" ? "会话变量" : "全局变量", label: v.label?.trim() ? `${v.label}（${v.name}）` : v.name, token: `${scope}.${v.name}` });
    });
    [["customer.name", "客户姓名"], ["customer.company", "客户公司"], ["customer.intent", "客户意向"]].forEach(([t, l]) =>
      opts.push({ group: "客户", label: l, token: t }));
    [["sys.time", "当前时间"], ["sys.channel", "渠道"]].forEach(([t, l]) => opts.push({ group: "系统", label: l, token: t }));
    const seen = new Set<string>();
    return opts.filter((o) => (seen.has(o.token) ? false : (seen.add(o.token), true)));
  }, [graph.nodes, botVars]);

  /* 持久化：图写 workflow_definition（运行时真相源），AI 对话写 workflow_exp.messages。
   * 成功后失效 bot 缓存：否则切走再切回 tab 会用旧缓存初始化、把旧图存回去。 */
  const qc = useQueryClient();
  const saveExp = useMutation({
    mutationFn: async (g: Graph) => {
      const { error } = await api.PATCH("/api/v1/bots/{bot_id}", {
        params: { path: { bot_id: botId } },
        body: {
          workflow_definition: g as unknown as Record<string, unknown>,
          workflow_exp: { messages: stripMsgs(msgsRef.current) } as unknown as Record<string, unknown>,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot", botId] }),
  });
  useImperativeHandle(ref, () => ({ save: () => saveExp.mutateAsync(graphRef.current) }));
  const saveRef = useRef(saveExp.mutate);
  useEffect(() => { saveRef.current = saveExp.mutate; }, [saveExp.mutate]);
  // 防抖自动保存（图或对话变更后 800ms）
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => saveRef.current(graphRef.current), 800);
    return () => clearTimeout(t);
  }, [graph, msgs]);
  const persist = () => saveRef.current(graphRef.current);

  const selNode = selected ? graph.nodes.find((n) => n.id === selected) : undefined;

  return (
    <>
      <ExpCanvas ref={canvasRef} graph={graph} selected={selected}
        onSelect={(id) => { setSelected(id); setInspect(!!id); }}
        onNodeMove={moveNode} onResetLayout={resetLayout} onAddNode={addNode} onOps={applyOps}
        onRename={(id, title) => renameNode(id, { title })} />
      {/* 右上角悬浮按钮组（面板关闭时显示，与正式画布交互一致） */}
      {panel === null && (
        <>
          <button className="preview-btn wfexp-ai-btn" onClick={() => setPanel("ai")}>
            <IcExperience s={16} style={{ color: "var(--primary)" }} /> AI 编排
          </button>
          <button className="preview-btn voicecfg-btn" onClick={() => setVoiceOpen(true)} title="语音配置">
            <IcVoiceCfg s={16} style={{ color: voiceCfg.enabled ? "#16a34a" : "var(--ink-3)" }} /> 语音{voiceCfg.enabled ? "已开" : "配置"}
          </button>
          <button className="preview-btn" onClick={() => setPanel("debug")}>
            <IcSend s={16} style={{ color: "var(--primary)" }} /> 预览和调试
          </button>
        </>
      )}
      {voiceOpen && <VoiceConfigModal botId={botId} voiceConfig={voiceCfg} onClose={() => setVoiceOpen(false)} />}
      {/* AI 编排面板（常驻挂载保留对话状态，仅切显隐） */}
      <div className="preview-panel" style={{ width: 430, display: panel === "ai" ? "flex" : "none" }}>
        <div className="pv-head" style={{ height: 52 }}>
          <span className="row" style={{ gap: 8, fontWeight: 700, fontSize: 15 }}>
            <IcExperience s={18} style={{ color: "var(--primary)" }} /> AI 编排
          </span>
          <button className="icon-btn" onClick={() => setPanel(null)}><IcClose s={20} style={{ color: "var(--ink-3)" }} /></button>
        </div>
        <div className="wfexp-pane">
          <AgentChat botId={botId} msgs={msgs} setMsgs={setMsgs} persist={persist}
            onVarsChanged={() => qc.invalidateQueries({ queryKey: ["bot", botId] })}
            getGraph={() => graphRef.current} applyOps={applyOps} replaceGraph={replaceGraph}
            animate={(steps) => canvasRef.current?.runTrace(steps)}
            selNode={selNode ? { id: selNode.id, title: selNode.title || NODE_TYPES[selNode.type]?.label || selNode.type } : null}
            clearSel={() => setSelected(null)}
            pendingAsk={pendingAsk} clearPending={() => setPendingAsk(null)}
          />
        </div>
      </div>
      {/* 预览和调试：真实链路（会话持久化 + 数据钩子 + 语音通话调试），跑的就是当前图 */}
      {panel === "debug" && (
        <PreviewPanel botId={botId} graph={graph} botVars={botVars}
          sessionVars={botVars.filter((v) => v.scope === "session")}
          onClose={() => setPanel(null)}
          onRunStart={() => canvasRef.current?.runStart()}
          onTrace={(steps) => canvasRef.current?.runTrace(steps)}
          saveGraph={() => saveExp.mutateAsync(graphRef.current)}
          onAskAI={(text) => { setPendingAsk(text); setPanel("ai"); }}
        />
      )}
      {inspect && selNode && (
        <VarOptionsContext.Provider value={varOptions}>
          <NodeSidebar node={selNode} right={panel ? 446 : 16}
            onUpdate={(patch) => updateNodeFields(selNode.id, patch)}
            onRename={(patch) => renameNode(selNode.id, patch)}
            onDelete={selNode.type === "start" ? undefined : () => deleteNode(selNode.id)}
            onClose={() => setInspect(false)}
          />
        </VarOptionsContext.Provider>
      )}
    </>
  );
});

/* ---------------- 节点侧边栏：贴画布右缘，点其他节点直接切换，不挡画布 ---------------- */
function NodeSidebar({ node, right, onUpdate, onRename, onDelete, onClose }: {
  node: GNode;
  right: number;
  onUpdate: (patch: Record<string, unknown>) => void;
  onRename: (patch: { title?: string; desc?: string }) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const t = NODE_TYPES[node.type] ?? NODE_TYPES.llm;
  const Body = NODE_BODIES[node.type];
  const [editTitle, setEditTitle] = useState(false);
  const [editDesc, setEditDesc] = useState(false);
  const title = node.title || t.label;
  return (
    <div className="wfexp-inspector" style={{ right }}>
      {/* 头部与正式画布节点卡同构：图标+标题+铅笔（点击进编辑），下行灰字描述（点击编辑） */}
      <div className="wfexp-insp-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="row" style={{ gap: 10 }}>
            <NodeBadge type={node.type} s={28} />
            {editTitle ? (
              <input
                className="node-title-edit"
                autoFocus
                maxLength={30}
                defaultValue={title}
                onBlur={(e) => { onRename({ title: e.target.value.trim() || t.label }); setEditTitle(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditTitle(false); }}
              />
            ) : (
              <>
                <span className="node-title">{title}</span>
                <button className="node-pencil icon-btn" title="编辑名称（下游可用 {{名称.字段}} 引用）" onClick={() => setEditTitle(true)}>
                  <IcPencil s={15} style={{ color: "var(--ink-3)" }} />
                </button>
              </>
            )}
          </span>
          {editDesc ? (
            <input
              className="node-desc-edit"
              autoFocus
              maxLength={60}
              defaultValue={node.desc ?? ""}
              placeholder={t.desc}
              onBlur={(e) => { onRename({ desc: e.target.value.trim() }); setEditDesc(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditDesc(false); }}
            />
          ) : (
            <div className="node-desc" title="点击编辑描述" style={{ cursor: "text" }} onClick={() => setEditDesc(true)}>
              {node.desc || t.desc}
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={onClose}><IcClose s={20} style={{ color: "var(--ink-3)" }} /></button>
      </div>
      <div className="wfexp-insp-body">
        {Body ? (
          <div className="node-body">
            <Body f={{ ...defaultFields(node.type), ...node.fields }} up={onUpdate} />
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13, padding: "6px 2px" }}>该节点没有可配置项。</div>
        )}
      </div>
      <div className="wfexp-insp-foot">
        <span>改动实时生效 · 自动保存；也可以让 AI 来改</span>
        {onDelete && (
          <button className="wfexp-del" title="删除节点（也可选中后按 Delete）" onClick={onDelete}>
            <IcTrash s={14} style={{ color: "var(--n-kb)" }} /> 删除节点
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- AI 编排（Claude Code 式 agent 对话） ---------------- */
function AgentChat({ botId, msgs, setMsgs, persist, onVarsChanged, getGraph, applyOps, replaceGraph, animate, selNode, clearSel, pendingAsk, clearPending }: {
  botId: string;
  msgs: ChatMsg[];
  setMsgs: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  persist: () => void;
  onVarsChanged: () => void;
  getGraph: () => Graph;
  applyOps: (ops: GraphOp[]) => void;
  replaceGraph: (g: Graph) => void;
  animate: (steps: RunStep[]) => void;
  selNode: { id: string; title: string } | null;
  clearSel: () => void;
  pendingAsk: string | null;
  clearPending: () => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const botImg = avatarDataUri(botId + "-wf-agent");
  const userImg = avatarDataUri(botId + "-user");
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);

  // 「让 AI 看看」：预览调试页把 trace 作为消息转交过来
  useEffect(() => {
    if (pendingAsk && !busy) { clearPending(); send(pendingAsk); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk, busy]);

  async function send(forced?: string) {
    let q = (forced ?? input).trim();
    if (!q || busy) return;
    if (!forced) setInput("");
    // 选中节点 = 本条消息的上下文（类比 Claude Code 的 @文件），随消息明文携带
    if (!forced && selNode) {
      q = `【针对画布选中节点「${selNode.title}」(id: ${selNode.id})】\n${q}`;
      clearSel();
    }
    setBusy(true);
    const snapshot = JSON.parse(JSON.stringify(getGraph())) as Graph;
    const aid = crypto.randomUUID();
    const history = [...msgs.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: q }];
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "user", content: q }, { id: aid, role: "assistant", content: "", items: [], snapshot, running: true }]);
    const upd = (patch: (x: ChatMsg) => ChatMsg) => setMsgs((m) => m.map((x) => (x.id === aid ? patch(x) : x)));
    /* 时间线积木：追加块 / 给某类最近一个块打补丁（文字与思考自动续接同类尾块） */
    const pushItem = (item: ChatItem) => upd((x) => ({ ...x, items: [...(x.items ?? []), item] }));
    const appendStream = (kind: "text" | "think", piece: string) => upd((x) => {
      const items = [...(x.items ?? [])];
      const last = items[items.length - 1];
      if (last && last.kind === kind) items[items.length - 1] = { ...last, text: last.text + piece } as ChatItem;
      else items.push({ kind, text: piece } as ChatItem);
      return { ...x, content: kind === "text" ? x.content + piece : x.content, items };
    });
    const patchLastTool = (tool: string | null, patch: Partial<Extract<ChatItem, { kind: "tool" }>>) => upd((x) => {
      const items = [...(x.items ?? [])];
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "tool" && (tool === null ? it.status === "run" : it.tool === tool)) {
          items[i] = { ...it, ...patch };
          break;
        }
      }
      return { ...x, items };
    });
    /* 收尾清算：把所有还在转圈的状态条统一置为 ok/err（流结束兜底，杜绝永久转圈） */
    const finishRunning = (status: "ok" | "err") => upd((x) => ({
      ...x,
      items: (x.items ?? []).map((it) => (it.kind === "tool" && it.status === "run" ? { ...it, status } : it)),
    }));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamWfAgent(botId, history, getGraph(), (ev) => {
        if (ev.type === "delta") appendStream("text", ev.content as string);
        else if (ev.type === "think") appendStream("think", ev.content as string);
        else if (ev.type === "tool_start") {
          const tool = ev.tool as string;
          pushItem({ kind: "tool", tool, label: TOOL_LABELS[tool] ?? tool, status: "run" });
        } else if (ev.type === "ops") {
          const ops = ev.ops as GraphOp[];
          applyOps(ops);
          patchLastTool("edit_graph", { status: "ok", label: `修改画布编排 · ${ops.length} 个操作` });
          upd((x) => ({ ...x, ops: (x.ops ?? 0) + ops.length }));
        } else if (ev.type === "vars") {
          patchLastTool("manage_variables", { status: "ok", label: "变量定义已更新" });
          onVarsChanged(); // 刷新 bot（节点侧边栏的变量下拉同步）
        } else if (ev.type === "plan") {
          patchLastTool("set_plan", { status: "ok" });
          const steps = ev.steps as { text: string; status: string }[];
          upd((x) => {
            const items = [...(x.items ?? [])];
            const i = items.findIndex((it) => it.kind === "plan");
            if (i >= 0) items[i] = { kind: "plan", steps }; // 计划卡原位更新（对标 TodoWrite）
            else items.push({ kind: "plan", steps });
            return { ...x, items };
          });
        } else if (ev.type === "run_turn_start") {
          patchLastTool("run_preview", { status: "run", label: `自测预演 ${ev.i}/${ev.total} · 「${String(ev.user).slice(0, 24)}」` });
        } else if (ev.type === "run_turn") {
          const turn = ev.turn as RunTurn;
          pushItem({ kind: "run", turn });
          if (turn.steps?.length) animate(turn.steps); // 画布按本轮真实路径点亮
        } else if (ev.type === "tool_end") {
          // 每次工具执行完成的显式收尾（多次自测各自打勾，不再依赖整轮 done）
          patchLastTool(ev.tool as string, { status: "ok" });
        } else if (ev.type === "done") {
          finishRunning("ok");
          // 以服务端最终图为准对账（布局是纯函数，直接整图替换即可）
          const server = ev.graph as Graph;
          if (JSON.stringify({ n: server.nodes, e: server.edges }) !== JSON.stringify({ n: getGraph().nodes, e: getGraph().edges })) {
            replaceGraph(server);
          }
        } else if (ev.type === "error") {
          finishRunning("err");
          appendStream("text", `\n\n（出错：${ev.message}）`);
        }
      }, ctrl);
    } catch (err) {
      const aborted = ctrl.signal.aborted;
      const msg = aborted ? "已停止（手动停止或长时间无响应）" : err instanceof Error ? err.message : "生成失败";
      finishRunning("err");
      pushItem({ kind: "text", text: `（${msg}）` });
    } finally {
      abortRef.current = null;
      finishRunning("ok");
      upd((x) => ({ ...x, running: false }));
      setBusy(false);
      setTimeout(persist, 300);
    }
  }

  const rollback = (m: ChatMsg) => {
    if (!m.snapshot) return;
    replaceGraph(m.snapshot);
    persist();
  };

  return (
    <>
      <div className="pv-scroll" ref={scrollRef}>
        {msgs.length === 0 && (
          <div className="wfexp-empty">
            <div className="wfexp-empty-title">用对话搭建工作流</div>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
              描述你的业务流程，AI 会直接在左侧画布上搭建编排、自己跑测试验证、再按你的反馈调整。
              也可以点选节点指着它说话、在侧边栏直接微调配置；AI 的每轮改动都可一键回滚。
            </div>
            <div className="wfexp-sugs">
              {["搭一个售前咨询机器人：先判断来意（询价/售后/闲聊），询价走产品介绍并收集联系方式，售后转人工",
                "把追问轮数限制改成最多 2 轮",
                "帮我自测一下：分别发「多少钱」和「随便聊聊」，看分支走得对不对"].map((s, i) => (
                <button key={i} className="wfexp-sug" onClick={() => setInput(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="pv-row me">
              <div className="pv-bubble me" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.content.length > 600 ? m.content.slice(0, 600) + "…" : m.content}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={userImg} alt="" />
            </div>
          ) : (
            <div key={m.id} className="pv-row bot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={botImg} alt="" />
              <div className="pv-bot-col" style={{ maxWidth: 330 }}>
                {/* 分块时间线：文字/思考/工具状态/计划卡/自测块按发生顺序交错 */}
                {m.items?.length ? (
                  m.items.map((it, i) => <ChatItemView key={i} item={it} />)
                ) : (
                  <div className="pv-bubble bot">
                    {m.content ? <Markdown>{m.content}</Markdown> : m.running ? <span className="pv-typing"><i /><i /><i /></span> : <span className="muted">（无回复）</span>}
                  </div>
                )}
                {m.running && !!m.items?.length && <span className="pv-typing wfexp-typing-tail"><i /><i /><i /></span>}
                {!!m.ops && (
                  <div className="wfexp-ops-chip">
                    <IcCheck s={13} sw={2.4} style={{ color: "var(--n-cond)" }} /> 已应用 {m.ops} 个画布操作
                    {m.snapshot && <button className="wfexp-undo" onClick={() => rollback(m)}>回滚此轮</button>}
                  </div>
                )}
                {m.runs?.map((t, i) => <AgentRunBlock key={i} turn={t} />)}
              </div>
            </div>
          ),
        )}
      </div>
      {selNode && (
        <div className="wfexp-ctx">
          <span className="wfexp-ctx-chip">@ {selNode.title}<button onClick={clearSel} title="取消选中"><IcClose s={13} style={{ color: "var(--ink-3)" }} /></button></span>
          <span className="muted" style={{ fontSize: 12 }}>下一条消息将针对此节点</span>
        </div>
      )}
      <div className="pv-input-bar">
        <button className="pv-clear" title="清空对话（不动画布）" onClick={() => { setMsgs([]); setTimeout(persist, 100); }}>
          <IcTrash s={18} style={{ color: "var(--ink-3)" }} />
        </button>
        <div className="pv-input">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={busy ? "AI 正在编排…（可点右侧停止）" : selNode ? `针对「${selNode.title}」说点什么…` : "描述业务流程，或让 AI 修改/自测编排"} disabled={busy} />
          {busy ? (
            <button className="pv-send wfexp-stop" title="停止" onClick={() => abortRef.current?.abort()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            </button>
          ) : (
            <button className="pv-send" onClick={() => send()}><IcSend s={18} style={{ color: "#fff" }} /></button>
          )}
        </div>
      </div>
    </>
  );
}

/* 工具专属图标（SVG，非 emoji）：计划清单 / 画布编辑 / 自测预演 / 变量 */
function ToolIcon({ tool }: { tool: string }) {
  const p = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none" as const, stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (tool) {
    case "set_plan": // 待办清单
      return <svg {...p}><path d="M9 6h11M9 12h11M9 18h11" /><path d="M3.5 5.5 4.5 6.5 6.5 4.5" /><path d="M3.5 11.5 4.5 12.5 6.5 10.5" /><circle cx="5" cy="18" r="1" fill="currentColor" stroke="none" /></svg>;
    case "edit_graph": // 画笔
      return <svg {...p}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>;
    case "run_preview": // 试管（自测）
      return <svg {...p}><path d="M9 3h6M10 3v6.3L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.3V3" /><path d="M7.5 14h9" /></svg>;
    case "manage_variables": // 花括号变量
      return <svg {...p}><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" /></svg>;
    default:
      return <svg {...p}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

/* 时间线积木的渲染（对标 Claude Code transcript 的块类型） */
function ChatItemView({ item }: { item: ChatItem }) {
  if (item.kind === "text") {
    return item.text.trim() ? <div className="pv-bubble bot"><Markdown>{item.text}</Markdown></div> : null;
  }
  if (item.kind === "think") {
    return (
      <details className="wfexp-think">
        <summary>✦ 思考过程</summary>
        <div className="wfexp-think-body">{item.text}</div>
      </details>
    );
  }
  if (item.kind === "tool") {
    return (
      <div className={"wfexp-tool " + item.status}>
        <span className="wfexp-tool-ic"><ToolIcon tool={item.tool} /></span>
        {item.label}
        {item.status === "run" ? <span className="wfexp-spin" />
          : item.status === "err" ? <IcClose s={11} sw={2.8} style={{ color: "var(--n-kb)" }} />
          : <IcCheck s={11} sw={2.8} style={{ color: "var(--n-cond)" }} />}
      </div>
    );
  }
  if (item.kind === "plan") {
    return (
      <div className="wfexp-plan">
        {item.steps.map((s, i) => (
          <div key={i} className={"wfexp-plan-row " + s.status}>
            <span className="wfexp-plan-ic">
              {s.status === "done" ? <IcCheck s={11} sw={2.8} style={{ color: "#fff" }} />
                : s.status === "doing" ? <span className="wfexp-spin sm" /> : null}
            </span>
            <span>{s.text}</span>
          </div>
        ))}
      </div>
    );
  }
  return <AgentRunBlock turn={item.turn} />;
}

/* Agent 自测结果块：每轮测试消息 + 回复 + 可展开 trace */
function AgentRunBlock({ turn }: { turn: RunTurn }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wfexp-run">
      <button className="wfexp-run-head" onClick={() => setOpen((o) => !o)}>
        <span className="wfexp-run-tag">自测</span>
        <span className="wfexp-run-q">{turn.user}</span>
        {turn.error ? <IcClose s={13} sw={2.6} style={{ color: "var(--n-kb)" }} /> : <IcCheck s={13} sw={2.6} style={{ color: "var(--n-cond)" }} />}
      </button>
      {open && (
        <div className="wfexp-run-body">
          {turn.error ? <div className="rd-error">{turn.error}</div> : <div className="wfexp-run-reply"><Markdown>{turn.reply}</Markdown></div>}
          {turn.steps.length > 0 && <RunSteps steps={turn.steps} summary={turn.summary} graph={EMPTY_GRAPH} />}
        </div>
      )}
    </div>
  );
}

