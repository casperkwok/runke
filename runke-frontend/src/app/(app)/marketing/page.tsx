"use client";

/* 营销触达（移植自 Runke产品原型/marketing.jsx + marketing-newtask.jsx）。mock 数据。 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { IcChevDown, IcClose, IcMore, IcPencil, IcPlus, IcTrash, Svg, type IcProps } from "@/components/icons/rk";
import { avatarDataUri } from "@/lib/rk/avatar";

const MIcRefresh = (p: IcProps) => <Svg {...p}><path d="M4 11a8 8 0 0 1 14-5M20 13a8 8 0 0 1-14 5" /><path d="M18 3v3.5h-3.5M6 21v-3.5h3.5" /></Svg>;
const MIcInbox = (p: IcProps) => <Svg {...p}><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M4 13 6 5h12l2 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Z" /></Svg>;
const MIcDrag = (p: IcProps) => <Svg {...p}>{[7, 12, 17].flatMap((cy) => [9, 15].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" fill="currentColor" stroke="none" />))}</Svg>;
const MIcInfo = (p: IcProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" /></Svg>;

type Block = { type: "p"; text: string } | { type: "ol"; items: string[] };
const MKT_CONTENT: Block[] = [
  { type: "p", text: "我们最近推出了新的套餐，您要看看吗？" },
  { type: "p", text: "活动情况如下：" },
  { type: "ol", items: ["本月到店，充500送500", "宠物初次洗澡，一律29元", "赠送免费驱虫一次"] },
];

const MKT_SEND_STATUS: Record<string, { label: string; color: string; bd: string; bg: string }> = {
  sending: { label: "发送中…", color: "#E8A33D", bd: "#F0C887", bg: "#FEF8EC" },
  fail: { label: "发送失败", color: "#E8453C", bd: "#F0B3AF", bg: "#FDEDEC" },
  paused: { label: "暂停发送", color: "#E8862E", bd: "#F2C293", bg: "#FEF3E8" },
  canceled: { label: "已取消", color: "#98A0B3", bd: "#D6DAE3", bg: "#F4F5F8" },
  success: { label: "发送成功", color: "#1FA85A", bd: "#A6DcBA", bg: "#EAF7EF" },
};

const MKT_MENUS: Record<string, { label: string; act: string; danger?: boolean }[]> = {
  running: [{ label: "暂停发送", act: "pause" }, { label: "取消任务", act: "cancel" }],
  error: [{ label: "取消任务", act: "cancel" }, { label: "删除", act: "delete", danger: true }],
  pending: [{ label: "继续发送", act: "resume" }, { label: "取消任务", act: "cancel" }, { label: "删除", act: "delete", danger: true }],
  canceled: [{ label: "删除", act: "delete", danger: true }],
  done: [{ label: "删除", act: "delete", danger: true }],
};

interface Task { id: string; name: string; content: string; time: string; creator: string; group: string; send: string; }
function mktTasks(): Task[] {
  const base = { content: "我们最近推出了新的套餐您要看看吗? 月底到店，充50…", time: "2024-06-05 12:00:12", creator: "郭小鹏" };
  return [
    { id: "t1", name: "新客活动", ...base, group: "running", send: "sending" },
    { id: "t2", name: "暑期宠物洗澡活动宣传", ...base, content: "我们最近推出了新的套餐您要看看吗?", group: "running", send: "sending" },
    { id: "t3", name: "新客活动", ...base, group: "error", send: "fail" },
    { id: "t4", name: "会员日召回", ...base, group: "pending", send: "paused" },
    { id: "t5", name: "老客复购提醒", ...base, group: "canceled", send: "canceled" },
    ...Array.from({ length: 10 }, (_, i) => ({ id: "td" + i, name: ["新客活动", "双11预热", "满减通知", "到店有礼", "会员专享"][i % 5], ...base, group: "done", send: "success" })),
  ];
}
const MKT_TABS = [
  { key: "running", label: "进行中" }, { key: "error", label: "异常任务" }, { key: "pending", label: "待执行" },
  { key: "canceled", label: "已取消" }, { key: "done", label: "已完成" },
];

const SendPill = ({ s }: { s: string }) => {
  const t = MKT_SEND_STATUS[s];
  return <span className="send-pill" style={{ color: t.color, borderColor: t.bd, background: t.bg }}>{t.label}</span>;
};

export default function MarketingPage() {
  const [view, setView] = useState<"list" | "new">("list");
  const [tasks, setTasks] = useState<Task[]>(mktTasks);
  const [tab, setTab] = useState("running");
  const createTask = (t: { name: string; content: string }) => {
    setTasks((ts) => [{ id: "t_" + Date.now(), name: t.name, content: t.content, time: new Date().toISOString().slice(0, 19).replace("T", " "), creator: "李晓", group: "running", send: "sending" }, ...ts]);
    setTab("running");
    setView("list");
  };
  if (view === "new") return <NewTaskPage onBack={() => setView("list")} onSend={createTask} />;
  return <MarketingList tasks={tasks} setTasks={setTasks} tab={tab} setTab={setTab} onNew={() => setView("new")} />;
}

function MarketingList({ tasks, setTasks, tab, setTab, onNew }: { tasks: Task[]; setTasks: React.Dispatch<React.SetStateAction<Task[]>>; tab: string; setTab: (t: string) => void; onNew: () => void }) {
  const [preview, setPreview] = useState(false);
  const counts: Record<string, number> = MKT_TABS.reduce((a, t) => ({ ...a, [t.key]: tasks.filter((x) => x.group === t.key).length }), {});
  const rows = tasks.filter((t) => t.group === tab);

  const doAct = (task: Task, act: string) => {
    if (act === "delete") setTasks((ts) => ts.filter((x) => x.id !== task.id));
    else if (act === "pause") setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, group: "pending", send: "paused" } : x)));
    else if (act === "resume") setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, group: "running", send: "sending" } : x)));
    else if (act === "cancel") setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, group: "canceled", send: "canceled" } : x)));
  };

  return (
    <div className="page mkt-page">
      <div className="mkt-head"><h1>营销触达</h1></div>
      <div className="mkt-bar">
        <div className="mkt-tabs">
          {MKT_TABS.map((t) => (
            <button key={t.key} className={"mkt-tab" + (tab === t.key ? " on" : "")} onClick={() => setTab(t.key)}>
              {t.label} <span className="mkt-tab-n">· {counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 14 }}>
          <button className="mkt-refresh"><MIcRefresh s={16} /> 刷新列表</button>
          <button className="btn-create" onClick={onNew}><IcPlus s={17} sw={2.2} style={{ color: "#fff" }} /> 新建任务</button>
        </div>
      </div>
      <div className="mkt-table">
        <div className="mt-head"><span>任务名称</span><span>发送内容</span><span>发送状态</span><span>发送时间</span><span>创建者</span><span>操作</span></div>
        {rows.length === 0 ? (
          <div className="mkt-empty"><MIcInbox s={62} style={{ color: "#C9D0DE" }} /><div>暂无任务</div></div>
        ) : (
          rows.map((t) => (
            <div className="mt-row" key={t.id}>
              <span className="mt-name">{t.name}</span>
              <span className="mt-content"><span className="mt-text">{t.content}</span><span className="link-blue" onClick={() => setPreview(true)}>预览</span></span>
              <span><SendPill s={t.send} /></span>
              <span className="muted">{t.time}</span>
              <span className="muted">{t.creator}</span>
              <span className="mt-ops">
                <span className="link-blue" onClick={() => setPreview(true)}>查看发送对象</span>
                <TaskMenu items={MKT_MENUS[t.group]} onPick={(act) => doAct(t, act)} />
              </span>
            </div>
          ))
        )}
      </div>
      {preview && <PreviewDrawer onClose={() => setPreview(false)} />}
    </div>
  );
}

function TaskMenu({ items, onPick }: { items: { label: string; act: string; danger?: boolean }[]; onPick: (act: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <span className="rowmenu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)}><IcMore s={18} style={{ color: "var(--ink-3)" }} /></button>
      {open && (
        <div className="menu-pop pop-in" style={{ right: 0, top: 30, minWidth: 124 }}>
          {items.map((it, i) => <button key={i} className={"menu-item" + (it.danger ? " danger" : "")} onClick={() => { onPick(it.act); setOpen(false); }}>{it.label}</button>)}
        </div>
      )}
    </span>
  );
}

function PhoneMock({ messages, bot }: { messages: ReactNode[]; bot: { img: string } }) {
  return (
    <div className="phone">
      <div className="phone-notch"><span className="ph-time">9:41</span><span className="ph-stat">●●● ▲ ▮</span></div>
      <div className="phone-bar"><IcClose s={18} style={{ color: "var(--ink-2)" }} /><b>客服账号(预览)</b><span style={{ width: 18 }} /></div>
      <div className="phone-body">
        {messages.map((m, i) => (
          <div className="ph-msg" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bot.img} alt="" />
            <div className="ph-bubble">{m}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function contentToMessages(): ReactNode[] {
  const msgs: ReactNode[] = [];
  MKT_CONTENT.forEach((b, bi) => {
    if (b.type === "p") msgs.push(b.text);
    else msgs.push(<ol className="ph-ol" key={bi}>{b.items.map((it, i) => <li key={i}>{it}</li>)}</ol>);
  });
  return msgs;
}

function PreviewDrawer({ onClose }: { onClose: () => void }) {
  const bot = { img: avatarDataUri("mkt-bot-lixiaohe") };
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="mkt-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="mkt-drawer-head"><b>发送内容预览</b><button className="icon-btn" onClick={onClose}><IcClose s={20} style={{ color: "var(--ink-3)" }} /></button></div>
        <div className="mkt-drawer-body"><PhoneMock messages={contentToMessages()} bot={bot} /></div>
      </div>
    </div>
  );
}

function NewTaskPage({ onBack, onSend }: { onBack: () => void; onSend: (t: { name: string; content: string }) => void }) {
  const [bot] = useState("李小鹤");
  const [name, setName] = useState("新客活动");
  const [packs, setPacks] = useState(["新客活动 - A组", "新客活动 - B组"]);
  const [content, setContent] = useState<Block[]>(MKT_CONTENT);
  const [draft, setDraft] = useState("我们最近推出了新的套餐，您要看看吗？");
  const [goal, setGoal] = useState("");

  const botImg = avatarDataUri("newtask-bot-" + bot);
  const removePack = (p: string) => setPacks((ps) => ps.filter((x) => x !== p));
  const addContent = () => { if (!draft.trim()) return; setContent((c) => [...c, { type: "p", text: draft.trim() }]); setDraft(""); };
  const delContent = (i: number) => setContent((c) => c.filter((_, j) => j !== i));

  const previewMsgs: ReactNode[] = content.map((b, bi) => (b.type === "ol" ? <ol className="ph-ol" key={bi}>{b.items.map((it, i) => <li key={i}>{it}</li>)}</ol> : b.text));

  return (
    <div className="page nt-page">
      <div className="nt-crumb"><span className="link-muted" onClick={onBack}>营销触达</span> <span className="cr-sep">/</span> <b>新建任务</b></div>
      <div className="nt-layout">
        <div className="nt-form">
          <Row label="发送的Bot" req>
            <div className="nt-bot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={botImg} alt="" />
              <div className="nt-bot-id"><b>{bot}</b><i>售前咨询助手</i></div>
              <IcChevDown s={18} style={{ color: "var(--ink-3)" }} />
            </div>
          </Row>
          <Row label="任务名称" req hint="任务名称仅展示在系统内部，用于管理者识别，并不会对外部客户展示">
            <div className="fld-wrap"><input className="fld" maxLength={20} placeholder="请输入" value={name} onChange={(e) => setName(e.target.value)} /><span className="fld-count">{name.length}/20</span></div>
          </Row>
          <Row label="选择客户" req hint={<>已选择 <b>{packs.length}</b> 个资源包，去重后预计触达客户 <b>12</b> 人，<span className="link-blue">查看详情</span></>}>
            <div className="nt-packs">
              {packs.map((p) => <span key={p} className="nt-pack-chip">{p}<button onClick={() => removePack(p)}><IcClose s={14} sw={2} style={{ color: "var(--ink-3)" }} /></button></span>)}
              <IcChevDown s={18} style={{ color: "var(--ink-3)", marginLeft: "auto" }} />
            </div>
          </Row>
          <Row label="发送内容" req>
            <div className="nt-content-list">
              {content.map((b, i) => (
                <div className="nt-cblock" key={i}>
                  <MIcDrag s={16} style={{ color: "var(--ink-4)" }} className="nt-cdrag" />
                  <div className="nt-ctext">{b.type === "ol" ? <ol className="nt-ol">{b.items.map((it, j) => <li key={j}>{it}</li>)}</ol> : b.text}</div>
                  <span className="nt-cops"><button className="df-ic"><IcPencil s={15} style={{ color: "var(--ink-3)" }} /></button><button className="df-ic" onClick={() => delContent(i)}><IcTrash s={15} style={{ color: "var(--ink-3)" }} /></button></span>
                </div>
              ))}
            </div>
            <div className="nt-composer">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="请输入想要发送的内容" />
              <div className="nt-composer-foot">
                <span className="nt-warn"><MIcInfo s={15} style={{ color: "var(--ink-4)" }} /> 请勿使用黄暴等敏感词</span>
                <button className="btn-outline sm" onClick={addContent}>确 定</button>
              </div>
            </div>
          </Row>
          <Row label="任务目标">
            <textarea className="fld ta" placeholder="请输入任务目标，将用于传递给Bot以便判断意图" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </Row>
          <div className="nt-actions">
            <button className="btn-primary" onClick={() => {
              if (!name.trim() || packs.length === 0 || content.length === 0) return;
              const first = content.find((b) => b.type === "p") as { type: "p"; text: string } | undefined;
              onSend({ name: name.trim(), content: first ? first.text : "营销内容" });
            }}>立即发送</button>
            <button className="btn-outline" onClick={onBack}>取 消</button>
          </div>
        </div>
        <div className="nt-preview">
          <PhoneMock messages={previewMsgs} bot={{ img: botImg }} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, req, hint, children }: { label: string; req?: boolean; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="nt-row">
      <div className="nt-label">{label} {req && <span className="req">*</span>}</div>
      <div className="nt-field">
        {children}
        {hint && <div className="nt-hint">{hint}</div>}
      </div>
    </div>
  );
}
