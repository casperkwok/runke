"use client";

/* 工作流实验区 · 只读画布：AI 是唯一编排者，画布是纯可视化输出。
 * - 精简卡片（图标+标题+一句摘要），无任何编辑交互；点选 = 给 AI 喂上下文。
 * - 布局是图的纯函数（定宽卡 + 分层布局），不持久化坐标、图一变自动重排。
 * - 保留平移/缩放/适配视图，以及按真实 trace 逐节点点亮的运行动画。 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { IcCheck, IcChevDown, IcChevRight, IcClose, IcPencil, IcZoomIn, IcZoomOut } from "@/components/icons/rk";
import { NODE_TYPES, NodeBadge, PICKER_GROUPS, type GEdge, type GNode, type Graph } from "./wf-nodes";
import type { RunStep } from "./wf-preview";

/* ---------------- Picker ---------------- */
export function PickerPanel({ collapsed, onToggle, onAdd, onDragNew }: {
  collapsed: boolean; onToggle: () => void; onAdd: (type: string) => void; onDragNew: (e: React.MouseEvent, type: string) => void;
}) {
  const Item = ({ type }: { type: string }) => {
    const t = NODE_TYPES[type];
    return (
      <button className={"pk-item" + (t.soon ? " soon" : "")} onMouseDown={(e) => !t.soon && onDragNew(e, type)} onClick={() => !t.soon && onAdd(type)}>
        <NodeBadge type={type} s={30} />
        <div className="pk-text">
          <div className="pk-name">{t.label}{t.soon && <span className="soon-tag">即将上线</span>}</div>
          <div className="pk-desc">{t.desc}</div>
        </div>
      </button>
    );
  };
  if (collapsed) {
    return <button className="picker collapsed" onClick={onToggle}><span>选择节点</span><IcChevRight s={18} style={{ color: "var(--ink-3)" }} /></button>;
  }
  return (
    <div className="picker">
      <div className="pk-head">选择节点 <button className="icon-btn" onClick={onToggle}><IcChevDown s={18} style={{ color: "var(--ink-3)", transform: "rotate(90deg)" }} /></button></div>
      {PICKER_GROUPS.map((g) => (
        <div key={g.label}>
          <div className="pk-section">{g.label}</div>
          {g.types.map((t) => <Item key={t} type={t} />)}
        </div>
      ))}
    </div>
  );
}

/* ---------------- 图操作（与后端 wf_copilot_service.apply_ops 语义一致） ---------------- */
export interface GraphOp {
  op: string;
  id?: string;
  node_type?: string;
  title?: string;
  desc?: string;
  fields?: Record<string, unknown>;
  from?: string;
  to?: string;
  port?: number;
}

export function applyOpsToGraph(g: Graph, ops: GraphOp[]): { graph: Graph; errors: string[] } {
  const nodes = [...g.nodes];
  let edges = [...g.edges];
  const errors: string[] = [];
  const idx = (id?: string) => nodes.findIndex((n) => n.id === id);
  for (const op of ops) {
    if (op.op === "add_node") {
      const t = op.node_type ?? "";
      if (!NODE_TYPES[t]) { errors.push(`未知节点类型 ${t}`); continue; }
      const id = op.id || `n_${t}_${Date.now()}_${nodes.length}`;
      if (idx(id) >= 0) { errors.push(`节点 ${id} 已存在`); continue; }
      const node: GNode = { id, type: t, x: 0, y: 0, fields: op.fields ?? {} };
      if (op.title) node.title = op.title;
      if (op.desc) node.desc = op.desc;
      nodes.push(node);
    } else if (op.op === "update_node") {
      const i = idx(op.id);
      if (i < 0) { errors.push(`节点 ${op.id} 不存在`); continue; }
      const n = { ...nodes[i] };
      if (op.fields) n.fields = { ...n.fields, ...op.fields };
      if (op.title) n.title = op.title;
      if (op.desc) n.desc = op.desc;
      nodes[i] = n;
    } else if (op.op === "delete_node") {
      const i = idx(op.id);
      if (i < 0) { errors.push(`节点 ${op.id} 不存在`); continue; }
      if (nodes[i].type === "start") { errors.push("不能删除开始节点"); continue; }
      nodes.splice(i, 1);
      edges = edges.filter((e) => e.from !== op.id && e.to !== op.id);
    } else if (op.op === "connect") {
      const a = nodes[idx(op.from)], b = nodes[idx(op.to)];
      if (!a || !b) { errors.push(`连线端点不存在：${op.from} → ${op.to}`); continue; }
      if (b.type === "start" || a.type === "end") { errors.push(`非法连线：${op.from} → ${op.to}`); continue; }
      const branchy = a.type === "cond" || a.type === "intent";
      if (branchy && op.port == null) { errors.push(`${a.type} 出边必须带 port`); continue; }
      edges = branchy
        ? [...edges.filter((e) => !(e.from === op.from && e.port === op.port)), { from: op.from!, to: op.to!, port: op.port }]
        : [...edges.filter((e) => e.from !== op.from), { from: op.from!, to: op.to! }];
    } else if (op.op === "disconnect") {
      const before = edges.length;
      edges = edges.filter((e) => !(e.from === op.from && e.to === op.to && (op.port == null || e.port === op.port)));
      if (edges.length === before) errors.push(`连线不存在：${op.from} → ${op.to}`);
    } else {
      errors.push(`未知操作 ${op.op}`);
    }
  }
  return { graph: { nodes, edges }, errors };
}

/* ---------------- 纯函数布局 ---------------- */
const CARD_W = 252, PILL_W = 132, GAP_X = 100, GAP_Y = 36, PAD = 60;

const isPill = (t: string) => t === "start" || t === "end";
const sizeOf = (n: GNode) => (isPill(n.type) ? { w: PILL_W, h: 46 } : { w: CARD_W, h: 80 });

function layoutGraph(graph: Graph): Record<string, { x: number; y: number; w: number; h: number }> {
  const ns = graph.nodes, es = graph.edges;
  if (!ns.length) return {};
  const indeg: Record<string, number> = {}, out: Record<string, string[]> = {};
  ns.forEach((n) => { indeg[n.id] = 0; out[n.id] = []; });
  es.forEach((e) => { if (out[e.from] && indeg[e.to] != null) { out[e.from].push(e.to); indeg[e.to]++; } });
  // 最长路径分层（Kahn）
  const layer: Record<string, number> = {};
  const indeg2 = { ...indeg };
  const q = ns.filter((n) => indeg2[n.id] === 0).map((n) => n.id);
  q.forEach((id) => (layer[id] = 0));
  let head = 0;
  while (head < q.length) {
    const id = q[head++];
    out[id].forEach((t) => { layer[t] = Math.max(layer[t] ?? 0, (layer[id] ?? 0) + 1); if (--indeg2[t] === 0) q.push(t); });
  }
  ns.forEach((n) => { if (layer[n.id] == null) layer[n.id] = 0; });
  const maxL = Math.max(...ns.map((n) => layer[n.id]));
  const order: Record<number, string[]> = {};
  for (let L = 0; L <= maxL; L++) order[L] = ns.filter((n) => layer[n.id] === L).map((n) => n.id);
  // 列内按父节点平均序排序，减少连线交叉
  for (let L = 1; L <= maxL; L++) {
    const bary = (id: string) => {
      const preds = es.filter((e) => e.to === id).map((e) => e.from);
      const idxs = preds.map((p) => (order[layer[p]] || []).indexOf(p)).filter((i) => i >= 0);
      return idxs.length ? idxs.reduce((a, b) => a + b, 0) / idxs.length : 999;
    };
    order[L] = [...order[L]].sort((a, b) => bary(a) - bary(b));
  }
  const pos: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let x = PAD;
  for (let L = 0; L <= maxL; L++) {
    const ids = order[L];
    const colW = Math.max(...ids.map((id) => sizeOf(ns.find((n) => n.id === id)!).w));
    const colH = ids.reduce((a, id) => a + sizeOf(ns.find((n) => n.id === id)!).h + GAP_Y, -GAP_Y);
    let y = Math.max(PAD, PAD + (0 - colH) / 2 + 200); // 各列大致垂直居中（基准 200）
    ids.forEach((id) => { const n = ns.find((m) => m.id === id)!; const s = sizeOf(n); pos[id] = { x, y, ...s }; y += s.h + GAP_Y; });
    x += colW + GAP_X;
  }
  return pos;
}

/* ---------------- 卡片摘要 ---------------- */
const clip = (v: unknown, n = 52) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
};

function summarize(n: GNode): string {
  const f = n.fields as Record<string, unknown>;
  switch (n.type) {
    case "start": return clip(f.welcome) || "工作流入口";
    case "llm": return clip(f.prompt) || "调用大模型生成";
    case "reply": return clip(f.content) || "固定话术";
    case "voice": return clip(f.content) || "语音播报";
    case "kb": return `检索 ${((f.items as unknown[]) || []).length} 个知识库`;
    case "variable": {
      const rows = (f.rows as { var?: string; name?: string; op?: string }[]) || [];
      return clip(rows.map((r) => `${r.var || r.name || "?"} ${r.op || "赋值"}`).join("；")) || "变量操作";
    }
    case "cond": {
      const bs = (f.branches as { name?: string }[]) || [];
      return clip(bs.map((b) => b.name || "分支").join(" / ") + " / 默认");
    }
    case "intent": {
      const bs = (f.branches as { name?: string }[]) || [];
      return clip("意图：" + bs.map((b) => b.name || "分支").join(" / "));
    }
    case "human": return "转人工处理";
    case "skill": return "调用技能";
    case "app": return "调用子智能体";
    case "code": return "代码处理";
    default: return n.desc || "";
  }
}

/* ---------------- 画布 ---------------- */
export interface ExpCanvasHandle {
  runStart: () => void;
  runTrace: (steps: RunStep[]) => void;
  fit: () => void;
}

const MIN_Z = 0.25, MAX_Z = 2;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

export const ExpCanvas = forwardRef<ExpCanvasHandle, {
  graph: Graph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onResetLayout: () => void;
  onAddNode: (type: string, at?: { x: number; y: number }) => void;
  onOps: (ops: GraphOp[]) => void; // 手动连线/删线与 AI 改图走同一套 ops 语义
  onRename: (id: string, title: string) => void;
}>(function ExpCanvas({ graph, selected, onSelect, onNodeMove, onResetLayout, onAddNode, onOps, onRename }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 40, y: 30 });
  const [zoom, setZoom] = useState(0.85);
  // 节点选择器：默认收起（AI 优先），展开后可点击/拖拽手动添加
  const [pickerCollapsed, setPickerCollapsed] = useState(true);
  const [ghost, setGhost] = useState<{ type: string; x: number; y: number } | null>(null);
  // 手动连线：从出点拖到目标节点；悬停连线可删
  const [connect, setConnect] = useState<{ from: string; port?: number; x: number; y: number } | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  // 卡片标题就地改名（悬停铅笔进入，与旧编辑器交互一致）
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<Record<string, string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // 自动布局打底；拖动过的节点（x/y 非零）记住手动位置，「一键排版」清零回到全自动
  const pos = useMemo(() => {
    const auto = layoutGraph(graph);
    graph.nodes.forEach((n) => { if ((n.x || n.y) && auto[n.id]) auto[n.id] = { ...auto[n.id], x: n.x, y: n.y }; });
    return auto;
  }, [graph]);
  const nodeById = (id: string) => graph.nodes.find((n) => n.id === id);

  /* 出口序号/锚点（与正式画布同规则：cond 含隐式默认出口） */
  const branchCount = (n: GNode) => {
    const len = ((n.fields.branches as unknown[]) || []).length;
    return n.type === "cond" ? len + 1 : n.type === "intent" ? len : 0;
  };
  const effPort = (e: GEdge) => {
    if (e.port != null) return e.port;
    const sibs = graph.edges.filter((x) => x.from === e.from);
    return sibs.indexOf(e);
  };
  const portFrac = (n: GNode, port?: number) => {
    const N = branchCount(n);
    if (N <= 1 || port == null) return 0.5;
    return 0.28 + 0.5 * (Math.min(port, N - 1) / (N - 1));
  };
  const portLabel = (n: GNode, port: number) => {
    const bs = (n.fields.branches as { name?: string }[]) || [];
    if (n.type === "cond" && port >= bs.length) return "默认分支";
    return bs[port]?.name || `分支${port + 1}`;
  };
  const aOut = (n: GNode, port?: number) => { const p = pos[n.id]; return { x: p.x + p.w, y: p.y + p.h * portFrac(n, port) }; };
  const aIn = (n: GNode) => { const p = pos[n.id]; return { x: p.x, y: p.y + p.h / 2 }; };
  const edgePath = (e: GEdge) => {
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b || !pos[a.id] || !pos[b.id]) return "";
    const p1 = aOut(a, branchCount(a) ? effPort(e) : undefined), p2 = aIn(b);
    const dx = Math.max(46, Math.abs(p2.x - p1.x) * 0.5);
    return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
  };

  /* 适配视图：按内容包围盒重置 pan/zoom */
  const fit = () => {
    const ps = Object.values(pos);
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!ps.length || !rect) return;
    const minX = Math.min(...ps.map((p) => p.x)) - PAD, minY = Math.min(...ps.map((p) => p.y)) - PAD;
    const maxX = Math.max(...ps.map((p) => p.x + p.w)) + PAD, maxY = Math.max(...ps.map((p) => p.y + p.h)) + PAD;
    const z = clampZ(Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY), 1));
    setZoom(z);
    setPan({ x: (rect.width - (maxX - minX) * z) / 2 - minX * z, y: (rect.height - (maxY - minY) * z) / 2 - minY * z });
  };
  // 节点增删时自动适配（AI 编排过程中视野跟随整图）
  const nodeKey = graph.nodes.map((n) => n.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fit(); }, [nodeKey]);

  /* 运行点亮：按 trace 顺序 running → ok/err */
  useImperativeHandle(ref, () => ({
    fit,
    runStart: () => { timers.current.forEach(clearTimeout); timers.current = []; setRunStatus({}); },
    runTrace: (steps: RunStep[]) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      const status: Record<string, string> = {};
      steps.forEach((s, i) => {
        timers.current.push(setTimeout(() => { status[s.node] = "running"; setRunStatus({ ...status }); }, i * 320));
        timers.current.push(setTimeout(() => { status[s.node] = s.status === "error" ? "err" : "ok"; setRunStatus({ ...status }); }, i * 320 + 240));
      });
    },
  }));

  /* 节点拖动：位移超过阈值才算拖（与点击打开弹窗区分），位置经父级写回图（持久化） */
  const dragInfo = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const onNodeDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = pos[id];
    if (!p) return;
    dragInfo.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
    const move = (ev: MouseEvent) => {
      const d = dragInfo.current;
      if (!d) return;
      const dx = (ev.clientX - d.sx) / zoom, dy = (ev.clientY - d.sy) / zoom;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) onNodeMove(d.id, d.ox + dx, d.oy + dy);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setTimeout(() => { dragInfo.current = null; }, 0); // click 在 mouseup 后同步触发，先留住 moved 标记
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  const onNodeClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (dragInfo.current?.moved) return; // 拖动结束的 click 不当作点选
    onSelect(id);
  };

  /* 从节点出点拖拽连线，松手落在目标节点上 → connect op */
  const startConnect = (fromId: string, e: React.MouseEvent, port?: number) => {
    e.stopPropagation();
    const rect = wrapRef.current!.getBoundingClientRect();
    const toWorld = (ev: { clientX: number; clientY: number }) =>
      ({ x: (ev.clientX - rect.left - pan.x) / zoom, y: (ev.clientY - rect.top - pan.y) / zoom });
    setConnect({ from: fromId, port, ...toWorld(e) });
    const move = (ev: MouseEvent) => setConnect({ from: fromId, port, ...toWorld(ev) });
    const up = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const toId = el?.closest("[data-node-id]")?.getAttribute("data-node-id");
      if (toId && toId !== fromId) onOps([{ op: "connect", from: fromId, to: toId, port }]);
      setConnect(null);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  /* 从选择器拖出新节点（ghost 跟随，松手落点即手动位置） */
  const dragNew = (e: React.MouseEvent, type: string) => {
    e.preventDefault();
    const move = (ev: MouseEvent) => setGhost({ type, x: ev.clientX, y: ev.clientY });
    const up = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const rect = wrapRef.current!.getBoundingClientRect();
      if (ev.clientX > rect.left + 60 && ev.clientX < rect.right && ev.clientY > rect.top && ev.clientY < rect.bottom) {
        onAddNode(type, { x: (ev.clientX - rect.left - pan.x) / zoom - 60, y: (ev.clientY - rect.top - pan.y) / zoom - 20 });
      }
      setGhost(null);
    };
    setGhost({ type, x: e.clientX, y: e.clientY });
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  /* 平移 / 缩放（空白处拖拽平移） */
  const onPanStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, ox = pan.x, oy = pan.y;
    const move = (ev: MouseEvent) => setPan({ x: ox + (ev.clientX - sx), y: oy + (ev.clientY - sy) });
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const rect = wrapRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const nz = clampZ(zoom * (e.deltaY < 0 ? 1.08 : 0.92));
      const k = nz / zoom;
      setPan((p) => ({ x: mx - (mx - p.x) * k, y: my - (my - p.y) * k }));
      setZoom(nz);
    } else setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
  };
  const doZoom = (d: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const mx = rect.width / 2, my = rect.height / 2;
    const nz = clampZ(zoom + d), k = nz / zoom;
    setPan((p) => ({ x: mx - (mx - p.x) * k, y: my - (my - p.y) * k }));
    setZoom(nz);
  };

  return (
    <div className="canvas-wrap wfx-wrap" ref={wrapRef} onWheel={onWheel}
      onMouseDown={(e) => { if (!(e.target as HTMLElement).closest(".wfx-node")) { onSelect(null); onPanStart(e); } }}>
      <div className="grid-bg" style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${24 * zoom}px ${24 * zoom}px` }} />
      <div className="world" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
        <svg className="edges" width={12000} height={12000} style={{ overflow: "visible", pointerEvents: "none" }}>
          {graph.edges.map((e, i) => {
            const running = runStatus && runStatus[e.from] === "ok";
            const a = nodeById(e.from), b = nodeById(e.to);
            const p1 = a && pos[a.id] ? aOut(a, branchCount(a) ? effPort(e) : undefined) : null;
            const mid = p1 && b && pos[b.id] ? { x: (p1.x + aIn(b).x) / 2, y: (p1.y + aIn(b).y) / 2 } : null;
            const hovered = hoverEdge === i;
            return (
              <g key={i} onMouseEnter={() => setHoverEdge(i)} onMouseLeave={() => setHoverEdge((h) => (h === i ? null : h))}>
                {/* 加宽透明命中区 */}
                <path d={edgePath(e)} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: "stroke", cursor: "pointer" }} />
                <path d={edgePath(e)} fill="none" stroke={running ? "var(--n-cond)" : hovered ? "var(--primary)" : "#A9B4CC"} strokeWidth={running ? 3.2 : 2.6} className={running ? "edge-run" : ""} />
                {hovered && mid && (
                  <g transform={`translate(${mid.x},${mid.y})`} style={{ pointerEvents: "all", cursor: "pointer" }}
                    onClick={() => onOps([{ op: "disconnect", from: e.from, to: e.to, port: e.port }])}>
                    <circle r={10} fill="#fff" stroke="var(--n-kb)" strokeWidth={1.5} />
                    <path d="M -3.6 -3.6 L 3.6 3.6 M 3.6 -3.6 L -3.6 3.6" stroke="var(--n-kb)" strokeWidth={2} strokeLinecap="round" />
                  </g>
                )}
              </g>
            );
          })}
          {connect && (() => {
            const a = nodeById(connect.from);
            if (!a || !pos[a.id]) return null;
            const p1 = aOut(a, connect.port);
            return <path d={`M ${p1.x} ${p1.y} C ${p1.x + 56} ${p1.y}, ${connect.x - 56} ${connect.y}, ${connect.x} ${connect.y}`} fill="none" stroke="var(--primary)" strokeWidth={2.4} strokeDasharray="6 4" />;
          })()}
        </svg>
        {/* 分支标签 */}
        {graph.edges.map((e, i) => {
          const a = nodeById(e.from), b = nodeById(e.to);
          if (!a || !b || !pos[a.id] || !pos[b.id] || (a.type !== "cond" && a.type !== "intent")) return null;
          const port = effPort(e);
          const p1 = aOut(a, port), p2 = aIn(b);
          return <div key={"bl" + i} className="edge-branch-label" style={{ left: (p1.x + p2.x) / 2, top: (p1.y + p2.y) / 2 - 15 }}>{portLabel(a, port)}</div>;
        })}
        {graph.nodes.map((n) => {
          const p = pos[n.id];
          if (!p) return null;
          const t = NODE_TYPES[n.type] ?? NODE_TYPES.llm;
          const st = runStatus?.[n.id];
          const sel = selected === n.id;
          // 出点：普通节点 1 个；cond/intent 按分支序号多个（带标签）。结束节点无出点。
          const portCount = branchCount(n);
          const outs = n.type === "end" ? null : portCount > 0 ? (
            Array.from({ length: portCount }, (_, i) => (
              <span key={i} className="node-out-handle branch" title={`从「${portLabel(n, i)}」拖拽连线`}
                style={{ top: `${portFrac(n, i) * 100}%`, cursor: "crosshair" }}
                onMouseDown={(e) => startConnect(n.id, e, i)}>
                <span className="oh-label">{portLabel(n, i)}</span>
              </span>
            ))
          ) : (
            <span className="node-out-handle" title="拖拽以连线" style={{ cursor: "crosshair" }} onMouseDown={(e) => startConnect(n.id, e)} />
          );
          const inHandle = n.type !== "start" && <span className="node-in-handle" />;
          if (isPill(n.type)) {
            return (
              <div key={n.id} data-node-id={n.id} className={"wfx-node wfx-pill" + (sel ? " sel" : "") + (st ? " run-" + st : "")}
                style={{ left: p.x, top: p.y, width: p.w, height: p.h, ["--accent" as string]: t.color }}
                onMouseDown={(e) => onNodeDown(e, n.id)} onClick={(e) => onNodeClick(e, n.id)}>
                <NodeBadge type={n.type} s={22} />
                <span className="wfx-title">{n.title || t.label}</span>
                {st === "ok" && <span className="wfx-st ok"><IcCheck s={11} sw={2.6} style={{ color: "#fff" }} /></span>}
                {st === "err" && <span className="wfx-st err"><IcClose s={11} sw={2.6} style={{ color: "#fff" }} /></span>}
                {inHandle}
                {outs}
              </div>
            );
          }
          return (
            <div key={n.id} data-node-id={n.id} className={"wfx-node" + (sel ? " sel" : "") + (st ? " run-" + st : "")}
              style={{ left: p.x, top: p.y, width: p.w, height: p.h, ["--accent" as string]: t.color }}
              onMouseDown={(e) => onNodeDown(e, n.id)} onClick={(e) => onNodeClick(e, n.id)}
              title="点击查看/编辑节点；拖拽移动">
              <div className="wfx-head">
                <NodeBadge type={n.type} s={22} />
                {editingTitle === n.id ? (
                  <input className="wfx-title-edit" autoFocus maxLength={30} defaultValue={n.title || t.label}
                    onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { onRename(n.id, e.target.value.trim()); setEditingTitle(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingTitle(null); }} />
                ) : (
                  <>
                    <span className="wfx-title">{n.title || t.label}</span>
                    <button className="wfx-pencil" title="编辑名称"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setEditingTitle(n.id); }}>
                      <IcPencil s={13} style={{ color: "var(--ink-3)" }} />
                    </button>
                  </>
                )}
                {st === "ok" && <span className="wfx-st ok"><IcCheck s={11} sw={2.6} style={{ color: "#fff" }} /></span>}
                {st === "err" && <span className="wfx-st err"><IcClose s={11} sw={2.6} style={{ color: "#fff" }} /></span>}
              </div>
              <div className="wfx-sum">{summarize(n)}</div>
              {inHandle}
              {outs}
            </div>
          );
        })}
      </div>
      <div className="picker-slot">
        <PickerPanel collapsed={pickerCollapsed} onToggle={() => setPickerCollapsed((c) => !c)}
          onAdd={(type) => onAddNode(type)} onDragNew={dragNew} />
      </div>
      {ghost && <div className="ghost-node" style={{ left: ghost.x + 12, top: ghost.y + 12 }}><NodeBadge type={ghost.type} s={26} /> <span>{NODE_TYPES[ghost.type].label}</span></div>}
      <div className="zoombar">
        <button className="zb-btn" onClick={() => doZoom(-0.1)}><span className="zb-tip">缩小</span><IcZoomOut s={20} style={{ color: "var(--ink-2)" }} /></button>
        <button className="zb-pct" onClick={fit}>{Math.round(zoom * 100)}%</button>
        <button className="zb-btn" onClick={() => doZoom(0.1)}><span className="zb-tip">放大</span><IcZoomIn s={20} style={{ color: "var(--ink-2)" }} /></button>
        <div className="zb-div" />
        <button className="zb-btn" onClick={() => { onResetLayout(); setTimeout(fit, 50); }}><span className="zb-tip">一键排版</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="6" height="6" rx="1" /><rect x="3" y="14" width="6" height="6" rx="1" /><rect x="15" y="9" width="6" height="6" rx="1" /><path d="M9 7h3a2 2 0 0 1 2 2v0M9 17h3a2 2 0 0 0 2-2v0" /></svg>
        </button>
        <button className="zb-btn" onClick={fit}><span className="zb-tip">适配视图</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
        </button>
      </div>
    </div>
  );
});
