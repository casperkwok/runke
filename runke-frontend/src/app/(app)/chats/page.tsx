"use client";

/* 聊天管家（移植自 Runke产品原型）。接真实后端：收件箱 + 消息线程 + 转人工/人工回复。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { IcChevDown, IcClose, Svg, type IcProps } from "@/components/icons/rk";
import { api } from "@/lib/api/client";
import { avatarDataUri, botAvatar } from "@/lib/rk/avatar";
import { Markdown } from "@/components/rk/Markdown";
import type { components } from "@/lib/api/schema";

type Bot = components["schemas"]["BotOut"];
type Inbox = components["schemas"]["InboxItem"];
type Message = components["schemas"]["MessageOut"];

const ChIcWechat = (p: IcProps) => <Svg {...p}><path d="M9 4.5C5.4 4.5 2.5 6.9 2.5 9.9c0 1.7.9 3.2 2.4 4.2l-.5 1.9 2.2-1.1c.7.2 1.5.3 2.4.3h.4a4.7 4.7 0 0 1-.1-1c0-2.9 2.8-5.2 6.3-5.2h.6C15.9 6.4 12.8 4.5 9 4.5Z" fill="currentColor" stroke="none" /><path d="M21.5 14.4c0-2.4-2.4-4.4-5.3-4.4s-5.3 2-5.3 4.4 2.4 4.4 5.3 4.4c.7 0 1.4-.1 2-.3l1.9.95-.45-1.6c1.1-.8 1.85-2 1.85-3.45Z" fill="currentColor" stroke="none" /></Svg>;
const ChIcAi = (p: IcProps) => <Svg {...p}><path d="M5 6h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H9l-4 3V7a1 1 0 0 1 1-1Z" /><path d="m19 6 .7 1.6L21.5 8.3 19.8 9 19 10.6 18.2 9l-1.7-.7 1.7-.7L19 6Z" fill="currentColor" stroke="none" /></Svg>;
const ChIcMail = (p: IcProps) => <Svg {...p}><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="m4 7 8 5.5L20 7" /></Svg>;
const ChIcGlobe = (p: IcProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" /></Svg>;
const ChIcSpark = (p: IcProps) => <Svg {...p}><path d="M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5L12 4Z" /><path d="m18.5 14 .7 1.7 1.8.8-1.8.8-.7 1.7-.7-1.7-1.8-.8 1.8-.8.7-1.7Z" fill="currentColor" stroke="none" /></Svg>;
const ChIcMonitor = (p: IcProps) => <Svg {...p}><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6M12 16.5V20" /></Svg>;
const ChIcSearch = (p: IcProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></Svg>;

const CHANNELS: Record<string, { icon: (p: IcProps) => ReactNode; color: string; label: string }> = {
  wx: { icon: ChIcWechat, color: "#2DBC4E", label: "企业微信" },
  web: { icon: ChIcGlobe, color: "#2D6FF7", label: "网站" },
  api: { icon: ChIcMail, color: "#98A0B3", label: "API" },
  debug: { icon: ChIcAi, color: "#7A2BF5", label: "调试" },
};
const channelMeta = (ch: string) => CHANNELS[ch] ?? CHANNELS.debug;

const fmtTime = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function ChatManagerPage() {
  const [botId, setBotIdState] = useState<string | null>(null);
  const setBotId = (id: string | null) => {
    setBotIdState(id);
    if (typeof window !== "undefined" && id) localStorage.setItem("rk-cm-bot", id);
  };
  const [botMenu, setBotMenu] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "intent">("all");
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: bots } = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/bots");
      if (error) throw error;
      return data.data as Bot[];
    },
  });
  // 默认选中：优先恢复上次选择(localStorage)，否则列表第一个
  useEffect(() => {
    if (botId || !bots || !bots.length) return;
    const saved = typeof window !== "undefined" ? localStorage.getItem("rk-cm-bot") : null;
    setBotIdState(saved && bots.some((b) => b.id === saved) ? saved : bots[0].id);
  }, [bots, botId]);
  const bot = bots?.find((b) => b.id === botId) ?? null;

  const { data: inbox } = useQuery({
    queryKey: ["inbox", botId],
    enabled: !!botId,
    refetchInterval: 4000,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/chats/inbox", { params: { query: { bot_id: botId! } } });
      if (error) throw error;
      return data.data as Inbox[];
    },
  });
  const list = (inbox ?? []).filter((c) => (tab === "all" || c.intent) && (!q || c.name.includes(q) || c.preview.includes(q)));
  const active = (inbox ?? []).find((c) => c.id === activeId) ?? null;
  useEffect(() => { if (!activeId && list.length) setActiveId(list[0].id); }, [list, activeId]);

  return (
    <div className="chat-mgr">
      <div className="cm-inbox">
        <div className="cm-bot" style={{ position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bot ? botAvatar(bot) : avatarDataUri("bot")} alt="" />
          <div className="cm-bot-id"><b>{bot?.name ?? "选择智能体"}</b><i>{bot?.bot_role || "智能助手"}</i></div>
          <button className="icon-btn" title="切换机器人" onClick={() => setBotMenu((m) => !m)}><IcChevDown s={19} style={{ color: "var(--ink-2)" }} /></button>
          {botMenu && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setBotMenu(false)} />
              <div className="cm-bot-menu">
                {(bots ?? []).map((b) => (
                  <button key={b.id} className={"cm-bot-item" + (b.id === botId ? " on" : "")} onClick={() => { setBotId(b.id); setActiveId(null); setBotMenu(false); }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={botAvatar(b)} alt="" /><span>{b.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="cm-tabs-row">
          <div className="cm-tabs">
            <button className={"cm-tab" + (tab === "all" ? " on" : "")} onClick={() => setTab("all")}>所有消息</button>
            <button className={"cm-tab" + (tab === "intent" ? " on" : "")} onClick={() => setTab("intent")}>有意向</button>
          </div>
          <button className={"icon-btn" + (searchOpen ? " on" : "")} onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setQ(""); }}><ChIcSearch s={18} style={{ color: searchOpen ? "var(--primary)" : "var(--ink-3)" }} /></button>
        </div>
        {searchOpen && (
          <div className="cm-search fade-in">
            <ChIcSearch s={16} style={{ color: "var(--ink-3)" }} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索客户或消息内容" />
            {q && <button onClick={() => setQ("")}><IcClose s={15} style={{ color: "var(--ink-3)" }} /></button>}
          </div>
        )}
        <div className="cm-list">
          {list.length === 0 ? (
            <div className="cm-empty-list">{inbox ? "暂无会话" : "加载中…"}</div>
          ) : (
            list.map((c) => {
              const cm = channelMeta(c.channel);
              return (
                <button key={c.id} className={"cm-conv" + (activeId === c.id ? " on" : "")} onClick={() => setActiveId(c.id)}>
                  <span className="cm-av-wrap" data-human={c.human ? "1" : undefined}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatarDataUri("visitor-" + c.id)} alt="" />
                    {c.human && <span className="cm-human-bubble">人工介入中</span>}
                  </span>
                  <span className="cm-conv-main">
                    <span className="cm-conv-top"><b>{c.name}</b>{c.intent && <i>{c.intent} 意向</i>}<span className="cm-time">{fmtTime(c.last_at)}</span></span>
                    <span className="cm-conv-prev"><span className="cm-prev-text">{c.preview || "（暂无消息）"}</span><span className="cm-ch"><cm.icon s={16} style={{ color: cm.color }} /></span></span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {active && bot ? (
        <ChatThread key={active.id} conv={active} bot={bot} />
      ) : (
        <div className="cm-thread" style={{ display: "grid", placeItems: "center", color: "var(--ink-3)" }}>选择左侧会话查看</div>
      )}
    </div>
  );
}

function ChatThread({ conv, bot }: { conv: Inbox; bot: Bot }) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [analysis, setAnalysis] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: msgs } = useQuery({
    queryKey: ["messages", conv.id],
    refetchInterval: 4000,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/conversations/{conv_id}/messages", { params: { path: { conv_id: conv.id }, query: { page_size: 100 } } });
      if (error) throw error;
      return data.data as Message[];
    },
  });
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, conv.human]);

  const takeover = useMutation({
    mutationFn: async (human: boolean) => {
      const { error } = await api.POST("/api/v1/chats/conversations/{conv_id}/takeover", { params: { path: { conv_id: conv.id } }, body: { human } });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inbox", bot.id] }); },
  });
  const reply = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await api.POST("/api/v1/chats/conversations/{conv_id}/reply", { params: { path: { conv_id: conv.id } }, body: { content } });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["messages", conv.id] }); qc.invalidateQueries({ queryKey: ["inbox", bot.id] }); },
  });

  const send = () => { const t = input.trim(); if (!t) return; reply.mutate(t); setInput(""); };
  const cm = channelMeta(conv.channel);

  return (
    <div className="cm-thread">
      <div className="cm-thread-head">
        <div className="cm-th-title"><b>{conv.name}</b> <span className="cm-th-src"><cm.icon s={15} style={{ color: cm.color }} /> {cm.label}</span></div>
        <button className={"cm-analyze" + (analysis ? " on" : "")} onClick={() => setAnalysis((a) => !a)}><ChIcSpark s={17} style={{ color: "#fff" }} /> AI 智能分析</button>
      </div>
      {analysis && (
        <div className="cm-analysis fade-in">
          <div className="cm-analysis-head"><ChIcSpark s={16} style={{ color: "var(--primary)" }} /> AI 智能分析（示例）<button className="icon-btn" onClick={() => setAnalysis(false)}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button></div>
          <div className="cm-analysis-grid">
            <div className="cm-an-card"><span className="cm-an-lbl">客户意向</span><b style={{ color: "#1FA85A" }}>{conv.intent ? conv.intent + " 级" : "待评估"}</b></div>
            <div className="cm-an-card"><span className="cm-an-lbl">消息条数</span><b>{conv.msg_count}</b></div>
            <div className="cm-an-card"><span className="cm-an-lbl">来源渠道</span><b>{cm.label}</b></div>
            <div className="cm-an-card"><span className="cm-an-lbl">状态</span><b style={{ color: "var(--primary)" }}>{conv.human ? "人工介入" : "AI 托管"}</b></div>
          </div>
        </div>
      )}
      <div className="cm-thread-body" ref={scrollRef}>
        {(msgs ?? []).filter((m) => m.role !== "system").map((m) => {
          const them = m.role === "user";
          return (
            <div className={"cm-msg " + (them ? "them" : "me")} key={m.id}>
              <div className="cm-msg-time">{fmtTime(m.created_at)}</div>
              <div className="cm-msg-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {them && <img src={avatarDataUri("visitor-" + conv.id)} alt="" />}
                <div className={"cm-bubble " + (them ? "them" : "me")}>{them ? m.content : <Markdown>{m.content}</Markdown>}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {!them && <img src={botAvatar(bot)} alt="" />}
              </div>
            </div>
          );
        })}
      </div>
      {!conv.human ? (
        <div className="cm-thread-foot center">
          <button className="cm-takeover" onClick={() => takeover.mutate(true)}>转人工</button>
        </div>
      ) : (
        <div className="cm-thread-foot human">
          <button className="cm-release" onClick={() => takeover.mutate(false)}><ChIcMonitor s={17} style={{ color: "var(--ink-2)" }} /> 恢复AI托管</button>
          <div className="cm-input">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="以客服身份回复访客…" />
            <button className={"cm-send" + (input.trim() ? " on" : "")} onClick={send}>发 送</button>
          </div>
        </div>
      )}
    </div>
  );
}
