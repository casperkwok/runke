"use client";

/* 工作台（移植自 Runke产品原型/workbench.jsx）。mock 数据看板。 */
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { IcAssistant, Svg, type IcProps } from "@/components/icons/rk";
import { avatarDataUri } from "@/lib/rk/avatar";
import { INTENT_LV } from "@/lib/rk/data";

const WB_RANGES = [
  { key: "today", label: "今日" },
  { key: "7d", label: "近7天" },
  { key: "30d", label: "近30天" },
] as const;
type RangeKey = (typeof WB_RANGES)[number]["key"];

type Kpi = [number | string, number, string];
const WB_DATA: Record<RangeKey, { kpi: Record<string, Kpi>; trendLabels: string[]; trend: Record<string, number[]>; funnel: number[] }> = {
  today: {
    kpi: { customers: [1248, 37, "总客户"], intent: [326, 9, "意向客户"], deal: [6, 2, "今日成交"], rate: ["26.1%", 1.4, "整体转化率"] },
    trendLabels: ["9:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"],
    trend: { lead: [4, 7, 6, 11, 9, 14, 8], chat: [28, 41, 36, 52, 47, 63, 39], deal: [0, 1, 1, 2, 1, 2, 1] },
    funnel: [1248, 326, 142, 84],
  },
  "7d": {
    kpi: { customers: [1248, 37, "总客户"], intent: [326, 28, "意向客户"], deal: [41, 12, "本周成交"], rate: ["26.1%", 2.3, "整体转化率"] },
    trendLabels: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
    trend: { lead: [22, 31, 27, 44, 39, 18, 25], chat: [186, 241, 213, 302, 277, 154, 198], deal: [4, 7, 5, 9, 8, 3, 5] },
    funnel: [1248, 326, 142, 84],
  },
  "30d": {
    kpi: { customers: [1248, 214, "总客户"], intent: [326, 96, "意向客户"], deal: [168, 37, "本月成交"], rate: ["26.1%", 3.1, "整体转化率"] },
    trendLabels: ["第1周", "第2周", "第3周", "第4周"],
    trend: { lead: [142, 178, 156, 214], chat: [1180, 1460, 1320, 1690], deal: [32, 41, 38, 57] },
    funnel: [1248, 326, 142, 84],
  },
};

const TREND_SERIES: Record<string, { label: string; color: string; unit: string }> = {
  lead: { label: "新增客户", color: "#3B5BFF", unit: "人" },
  chat: { label: "对话量", color: "#1FA85A", unit: "次" },
  deal: { label: "成交", color: "#7A2BF5", unit: "单" },
};

const WB_AGENTS = [
  { name: "李小鹤", role: "售前咨询助手", chats: 1842, human: 4.2, conv: 31.5, seed: "wb-a1" },
  { name: "萌宠医师", role: "宠物诊断助手", chats: 1366, human: 6.8, conv: 24.1, seed: "wb-a2" },
  { name: "满意度回访", role: "回访助手", chats: 980, human: 12.0, conv: 18.7, seed: "wb-a3" },
  { name: "电商售后", role: "售后助手", chats: 742, human: 8.5, conv: 15.2, seed: "wb-a4" },
];
const WB_INSIGHTS = [
  { tone: "up", text: "电商行业意向客户环比 +18%，且对价格不敏感，建议加大「电商活动促销智能体」投放。" },
  { tone: "warn", text: "「满意度回访智能体」转人工率达 12%，高于均值 6.4%，建议优化话术与知识库覆盖。" },
  { tone: "info", text: "有 14 位 A 级高意向客户超过 3 天未跟进，预计流失风险较高，建议尽快安排人工触达。" },
];
const WB_FOLLOWUPS = [
  { name: "陈明远", company: "示例科技", intent: "A", days: 3 },
  { name: "刘医生", company: "康宁口腔诊所", intent: "A", days: 4 },
  { name: "赵红梅", company: "红梅教育", intent: "B", days: 2 },
  { name: "张建国", company: "建国数码", intent: "C", days: 5 },
];

const WbStar = (p: IcProps) => <Svg {...p}><path d="M12 4l1.9 4.6L19 9l-3.7 3.3 1.1 5L12 14.8 7.6 17.3l1.1-5L5 9l5.1-.4L12 4Z" /></Svg>;
const WbDeal = (p: IcProps) => <Svg {...p}><path d="M5 8h14l-1 11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="m9.5 13 2 2 3.5-3.5" /></Svg>;
const WbRate = (p: IcProps) => <Svg {...p}><path d="M5 19 19 5M8 7.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM19 16.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" /></Svg>;
const AiBadge = () => <span className="ai-badge">AI</span>;

function smoothPath(pts: number[][]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export default function WorkbenchPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [series, setSeries] = useState("lead");
  const router = useRouter();
  const d = WB_DATA[range];

  return (
    <div className="wb">
      <div className="wb-top">
        <div>
          <h1>下午好，李晓 👋</h1>
          <p className="wb-sub">
            这是你的销售概览 · {new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
          </p>
        </div>
        <div className="wb-range">
          {WB_RANGES.map((r) => (
            <button key={r.key} className={"wb-range-btn" + (range === r.key ? " on" : "")} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="wb-kpis">
        <KpiCard data={d.kpi.customers} accent="#3B5BFF" icon={<IcAssistant s={20} style={{ color: "#3B5BFF" }} />} />
        <KpiCard data={d.kpi.intent} accent="#1FA85A" icon={<WbStar s={20} style={{ color: "#1FA85A" }} />} />
        <KpiCard data={d.kpi.deal} accent="#7A2BF5" icon={<WbDeal s={20} style={{ color: "#7A2BF5" }} />} />
        <KpiCard data={d.kpi.rate} accent="#FF8A1F" icon={<WbRate s={20} style={{ color: "#FF8A1F" }} />} isRate />
      </div>

      <div className="wb-grid">
        <div className="wb-col-main">
          <TrendChart d={d} series={series} setSeries={setSeries} />
          <AgentPerformance />
        </div>
        <div className="wb-col-side">
          <Funnel data={d.funnel} />
          <Insights />
          <FollowUps onGo={() => router.push("/customers")} />
        </div>
      </div>
    </div>
  );
}

function KpiCard({ data, accent, icon, isRate }: { data: Kpi; accent: string; icon: ReactNode; isRate?: boolean }) {
  const [val, delta, label] = data;
  const up = (delta as number) >= 0;
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <span className="kpi-icon" style={{ background: accent + "18" }}>{icon}</span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-val">{val}</div>
      <div className={"kpi-delta " + (up ? "up" : "down")}>
        {up ? "▲" : "▼"} {isRate ? Math.abs(delta as number) + " pt" : (up ? "+" : "") + delta}
        <span className="kpi-delta-cap">较上一周期</span>
      </div>
    </div>
  );
}

function TrendChart({ d, series, setSeries }: { d: (typeof WB_DATA)[RangeKey]; series: string; setSeries: (s: string) => void }) {
  const W = 720, H = 240, padL = 8, padR = 8, padT = 20, padB = 34;
  const vals = d.trend[series];
  const max = Math.max(...vals) * 1.18;
  const sc = TREND_SERIES[series];
  const n = vals.length;
  const x = (i: number) => padL + (W - padL - padR) * (i / (n - 1));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const pts = vals.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const area = line + ` L ${x(n - 1)} ${H - padB} L ${x(0)} ${H - padB} Z`;
  return (
    <div className="wb-card">
      <div className="wb-card-head">
        <b>趋势分析</b>
        <div className="trend-tabs">
          {Object.entries(TREND_SERIES).map(([k, s]) => (
            <button key={k} className={"trend-tab" + (series === k ? " on" : "")} onClick={() => setSeries(k)}>
              <span className="trend-dot" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="trend-chart">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ display: "block", height: 240 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={sc.color} stopOpacity="0.22" />
              <stop offset="1" stopColor={sc.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((g, i) => {
            const gy = padT + (H - padT - padB) * g;
            return <line key={i} x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#EEF0F5" strokeWidth="1" />;
          })}
          <path d={area} fill="url(#trendFill)" />
          <path d={line} fill="none" stroke={sc.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#fff" stroke={sc.color} strokeWidth="2" />)}
        </svg>
        <div className="trend-x">{d.trendLabels.map((l, i) => <span key={i}>{l}</span>)}</div>
      </div>
    </div>
  );
}

function Funnel({ data }: { data: number[] }) {
  const stages = ["线索", "意向", "方案", "成交"];
  const colors = ["#3B5BFF", "#5E7BFF", "#7A2BF5", "#FF5436"];
  const max = data[0];
  return (
    <div className="wb-card">
      <div className="wb-card-head"><b>销售漏斗</b><span className="wb-card-cap">线索 → 成交</span></div>
      <div className="funnel">
        {stages.map((s, i) => {
          const pct = data[i] / max;
          const conv = i === 0 ? 100 : Math.round((data[i] / data[i - 1]) * 100);
          return (
            <div className="fn-row" key={i}>
              <div className="fn-meta"><span className="fn-stage">{s}</span><span className="fn-count">{data[i].toLocaleString()}</span></div>
              <div className="fn-bar-track"><div className="fn-bar" style={{ width: pct * 100 + "%", background: colors[i] }} /></div>
              {i > 0 && <div className="fn-conv">转化 {conv}%</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentPerformance() {
  const maxChat = Math.max(...WB_AGENTS.map((a) => a.chats));
  return (
    <div className="wb-card">
      <div className="wb-card-head"><b>智能体表现</b><span className="wb-card-cap">近7天</span></div>
      <div className="agent-perf">
        <div className="ap-head"><span>智能体</span><span>对话量</span><span>转人工率</span><span>意向转化</span></div>
        {WB_AGENTS.map((a, i) => (
          <div className="ap-row" key={i}>
            <span className="ap-name">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatarDataUri(a.seed)} alt="" />
              <span><b>{a.name}</b><i>{a.role}</i></span>
            </span>
            <span className="ap-chats">
              <span className="ap-bar-track"><span className="ap-bar" style={{ width: (a.chats / maxChat) * 100 + "%" }} /></span>
              <b>{a.chats.toLocaleString()}</b>
            </span>
            <span className={"ap-human" + (a.human > 10 ? " warn" : "")}>{a.human}%</span>
            <span className="ap-conv">{a.conv}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Insights() {
  const ic: Record<string, string> = { up: "#1FA85A", warn: "#E8862E", info: "#3B5BFF" };
  return (
    <div className="wb-card">
      <div className="wb-card-head"><b className="row" style={{ gap: 8 }}><AiBadge /> AI 洞察</b></div>
      <div className="insights">
        {WB_INSIGHTS.map((it, i) => (
          <div className="insight" key={i}>
            <span className="insight-bar" style={{ background: ic[it.tone] }} />
            <span className="insight-text">{it.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FollowUps({ onGo }: { onGo: () => void }) {
  return (
    <div className="wb-card">
      <div className="wb-card-head"><b>待跟进客户</b><span className="link-blue" onClick={onGo}>查看全部</span></div>
      <div className="followups">
        {WB_FOLLOWUPS.map((f, i) => (
          <div className="fu-row" key={i} onClick={onGo} style={{ cursor: "pointer" }}>
            <span className="cust-av" style={{ background: "#EEF1F8" }}>{f.name.slice(0, 1)}</span>
            <span className="fu-id"><b>{f.name}</b><i>{f.company}</i></span>
            <span className="intent-ring" style={{ color: INTENT_LV[f.intent].color, borderColor: INTENT_LV[f.intent].color }}>{f.intent}</span>
            <span className="fu-days">{f.days}天未跟进</span>
          </div>
        ))}
      </div>
    </div>
  );
}
