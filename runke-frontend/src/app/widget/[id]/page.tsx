"use client";

/* 网站集成小部件——独立页（嵌入到第三方网站的 iframe 内容）。
   免登录，调公开接口 /public/bots/{id} 与 /public/bots/{id}/chat 和已发布 Agent 真实对话。 */
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { API_BASE } from "@/lib/api/client";
import { Markdown } from "@/components/rk/Markdown";

interface Msg { id: string; who: "me" | "bot"; text: string }
interface BotInfo {
  id: string;
  name: string;
  avatar: string;
  welcome: string;
  examples: string[];
  widget_config: { title?: string; color?: string; logo?: string; welcome?: string };
}

export default function WidgetPage() {
  const { id } = useParams<{ id: string }>();
  const [bot, setBot] = useState<BotInfo | null>(null);
  const [err, setErr] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const convId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/public/bots/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setBot(j.data))
      .catch(() => setErr(true));
  }, [id]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs]);

  const color = bot?.widget_config?.color || "#3B5BFF";
  const title = bot?.widget_config?.title || bot?.name || "智能助手";
  const logo = bot?.widget_config?.logo || bot?.avatar || "";
  // 访客无会话变量，开场白里的 {{变量}} 去掉，避免显示原始代码
  const welcome = (bot?.widget_config?.welcome || bot?.welcome || "你好，有什么可以帮你的吗？").replace(/\{\{\s*[^}]+?\s*\}\}/g, "").trim() || "你好，有什么可以帮你的吗？";
  const started = msgs.length > 0;

  async function ask(text?: string) {
    const q = (text ?? input).trim();
    if (!q || streaming || !bot) return;
    setInput("");
    setMsgs((m) => [...m, { id: crypto.randomUUID(), who: "me", text: q }]);
    const aid = crypto.randomUUID();
    setMsgs((m) => [...m, { id: aid, who: "bot", text: "" }]);
    setStreaming(true);
    try {
      const resp = await fetch(`${API_BASE}/api/v1/public/bots/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: q, conversation_id: convId.current }),
      });
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === "conversation") convId.current = ev.id;
          else if (ev.type === "delta") setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, text: x.text + ev.content } : x)));
          else if (ev.type === "error") setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, text: x.text || "（生成失败）" } : x)));
        }
      }
    } catch {
      setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, text: x.text || "（连接失败）" } : x)));
    } finally {
      setStreaming(false);
    }
  }

  if (err) return <div className="rkw-state">小部件不可用或未发布。</div>;
  if (!bot) return <div className="rkw-state">加载中…</div>;

  return (
    <div className="rkw-root" style={{ ["--wc" as string]: color }}>
      <div className="rkw-head" style={{ background: color }}>
        <span className="rkw-head-id">
          {logo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={logo} alt="" />}
          <b>{title}</b>
        </span>
        <button className="rkw-x" onClick={() => window.parent?.postMessage("rk-widget-close", "*")}>✕</button>
      </div>

      <div className="rkw-scroll" ref={scrollRef}>
        <div className="rkw-msg bot">
          {logo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={logo} alt="" />}
          <div className="rkw-bubble bot">{welcome}</div>
        </div>
        {!started && bot.examples.length > 0 && (
          <div className="rkw-chips">
            {bot.examples.map((q, i) => (
              <button key={i} className="rkw-chip" onClick={() => ask(q)}>{q}</button>
            ))}
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={"rkw-msg " + m.who}>
            {m.who === "bot" && logo && /* eslint-disable-next-line @next/next/no-img-element */ <img src={logo} alt="" />}
            <div className={"rkw-bubble " + m.who} style={m.who === "me" ? { background: color } : undefined}>{m.who === "bot" ? (m.text ? <Markdown>{m.text}</Markdown> : "…") : m.text}</div>
          </div>
        ))}
      </div>

      <div className="rkw-input">
        <textarea
          value={input}
          rows={1}
          placeholder="请详细描述你的问题"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
        />
        <button className="rkw-send" style={{ background: color }} disabled={!input.trim() || streaming} onClick={() => ask()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
        </button>
      </div>
      <div className="rkw-foot">Powered by <b>Runke.ai</b></div>
    </div>
  );
}
