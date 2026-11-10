"use client";

/* 体验间：选择一个已发布的智能助手，真实对话（接后端 completion 流式）。 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { IcCheck, IcChevDown, IcChevRight, Svg, type IcProps } from "@/components/icons/rk";
import { Markdown } from "@/components/rk/Markdown";
import { api, streamCompletion } from "@/lib/api/client";
import { avatarDataUri, botAvatar } from "@/lib/rk/avatar";

interface Msg { who: "me" | "bot"; text: string }
const USER_IMG = avatarDataUri("experience-user");
const IcSliders = (p: IcProps) => <Svg {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></Svg>;

export default function ExperiencePage() {
  const { data: bots } = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/bots");
      if (error) throw error;
      return data.data;
    },
  });
  const list = bots ?? [];
  const [botId, setBotId] = useState<string>("");
  const bot = list.find((b) => b.id === botId) ?? list[0] ?? null;
  useEffect(() => { if (!botId && list.length) setBotId(list[0].id); }, [botId, list]);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [varVals, setVarVals] = useState<Record<string, string>>({});
  const [sideOpen, setSideOpen] = useState(true);
  const [dirty, setDirty] = useState(false); // 开聊后改了变量，需重开才生效
  const [pickerOpen, setPickerOpen] = useState(false); // 左上助手切换下拉
  const convId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const started = msgs.length > 0;

  // 该 bot 的会话变量（需要在开聊前填，作为会话变量传入）
  const sessionVars = ((bot?.variables ?? []) as { name: string; scope: string; value?: string; label?: string }[])
    .filter((v) => v.scope === "session" && v.name?.trim());

  // 换一个 bot：清空会话 + 用变量默认值预填输入
  useEffect(() => {
    setMsgs([]); convId.current = null;
    const init: Record<string, string> = {};
    for (const v of sessionVars) init[v.name] = v.value ?? "";
    setVarVals(init); setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  const restart = () => { setMsgs([]); convId.current = null; setDirty(false); };
  const setVar = (name: string, val: string) => { setVarVals((s) => ({ ...s, [name]: val })); if (started) setDirty(true); };
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, busy]);

  const ensureConv = async (): Promise<string | null> => {
    if (convId.current) return convId.current;
    if (!bot) return null;
    const variables: Record<string, string> = {};
    for (const v of sessionVars) if (varVals[v.name]?.trim()) variables[v.name] = varVals[v.name].trim();
    const { data, error } = await api.POST("/api/v1/bots/{bot_id}/conversations", {
      params: { path: { bot_id: bot.id } }, body: { title: "体验间", channel: "experience", variables },
    });
    if (error) throw error;
    convId.current = data.data.id;
    return convId.current;
  };

  const ask = async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy || !bot) return;
    setInput("");
    setMsgs((m) => [...m, { who: "me", text: t }, { who: "bot", text: "" }]);
    setBusy(true);
    try {
      const cid = await ensureConv();
      if (!cid) return;
      await streamCompletion(cid, t, (delta) => {
        setMsgs((m) => { const n = [...m]; n[n.length - 1] = { who: "bot", text: n[n.length - 1].text + delta }; return n; });
      });
    } catch {
      setMsgs((m) => { const n = [...m]; n[n.length - 1] = { who: "bot", text: "（出错了，请稍后再试）" }; return n; });
    } finally {
      setBusy(false);
    }
  };

  const botImg = bot ? botAvatar(bot) : "";
  const examples = (bot?.examples ?? []).filter(Boolean).slice(0, 8);
  const welcome = (bot?.welcome || "").replace(/\{\{\s*[^}]+?\s*\}\}/g, "").trim() || (bot ? `你好，我是${bot.name}` : "");

  if (!bot) {
    return <div className="exp-room empty"><div className="exp-welcome"><h2>体验间</h2><p>还没有智能助手，先去「智能助手」创建一个吧。</p></div></div>;
  }

  const hasVars = sessionVars.length > 0;
  return (
    <div className="exp2-wrap">
      <div className="exp-room">
        <div className="exp-top">
          <div className="exp-switch" onClick={() => list.length > 1 && setPickerOpen((o) => !o)} role={list.length > 1 ? "button" : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={botImg} alt="" />
            <span className="exp-switch-txt"><b>{bot.name}</b><i>{bot.bot_role || "智能助手"}</i></span>
            {list.length > 1 && <IcChevDown s={16} style={{ color: "var(--ink-3)", transition: ".15s", transform: pickerOpen ? "rotate(180deg)" : "none" }} />}
            {pickerOpen && (
              <>
                <div className="exp-switch-mask" onClick={(e) => { e.stopPropagation(); setPickerOpen(false); }} />
                <div className="exp-switch-menu" onClick={(e) => e.stopPropagation()}>
                  {list.map((b) => (
                    <button key={b.id} className={"exp-switch-item" + (b.id === bot.id ? " on" : "")} onClick={() => { setBotId(b.id); setPickerOpen(false); }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={botAvatar(b)} alt="" />
                      <span><b>{b.name}</b><i>{b.bot_role || "智能助手"}</i></span>
                      {b.id === bot.id && <IcCheck s={15} sw={2.2} style={{ color: "var(--primary)", marginLeft: "auto" }} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            {started && <button className="btn-outline sm" onClick={restart}>重新开始</button>}
            {hasVars && <button className={"exp-icon-btn" + (sideOpen ? " on" : "")} title="模拟对象" onClick={() => setSideOpen((o) => !o)}><IcSliders s={17} style={{ color: sideOpen ? "var(--primary)" : "var(--ink-2)" }} /></button>}
          </span>
        </div>
        <div className="exp-scroll" ref={scrollRef}>
          {welcome && (
            <div className="exp-msg bot"><div className="exp-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={botImg} alt="" />
              <div className="exp-bubble bot"><Markdown>{(bot.welcome || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k) => varVals[String(k).replace(/^session\./, "")] || "").replace(/\{\{\s*[^}]+?\s*\}\}/g, "").trim() || welcome}</Markdown></div>
            </div></div>
          )}
          {!started && examples.length > 0 && (
            <div className="exp-examples inline">
              <div className="exp-ex-label">问题示例，可点击直接提问:</div>
              <div className="exp-chips">
                {examples.map((q, i) => <button key={i} className="exp-chip" onClick={() => ask(q)}>{q}</button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={"exp-msg " + m.who}>
              <div className="exp-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.who === "bot" && <img src={botImg} alt="" />}
                <div className={"exp-bubble " + m.who}>
                  {m.who === "bot"
                    ? (m.text ? <Markdown>{m.text}</Markdown> : <span className="pv-typing"><i></i><i></i><i></i></span>)
                    : m.text}
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.who === "me" && <img src={USER_IMG} alt="" />}
              </div>
            </div>
          ))}
        </div>
        <div className="exp-input bottom">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
            placeholder="输入你的问题…" />
          <button className={"exp-send grad" + (input.trim() && !busy ? " on" : "")} disabled={!input.trim() || busy} onClick={() => ask()}>发送</button>
        </div>
      </div>

      {/* 右侧可展开/收起边栏：模拟对象 / 会话变量 */}
      {hasVars && (
        <aside className={"exp2-side" + (sideOpen ? "" : " collapsed")} aria-hidden={!sideOpen}>
          <div className="exp2-side-inner">
          <div className="exp2-side-h">
            <div><b>模拟对象</b><div className="sub">填入会话变量，模拟一个真实对话对象</div></div>
            <span className="x" title="收起" onClick={() => setSideOpen(false)}><IcChevRight s={18} style={{ color: "var(--ink-3)" }} /></span>
          </div>
          <div className="exp2-side-body">
            {sessionVars.map((v) => {
              const long = (v.value ?? "").length > 36 || /resume|简历|摘要|description|备注/i.test(v.name + (v.label ?? ""));
              return (
                <div className="exp-var-row" key={v.name}>
                  <label title={`{{session.${v.name}}}`}>{v.label?.trim() || v.name}</label>
                  {long
                    ? <textarea rows={4} value={varVals[v.name] ?? ""} placeholder={`输入${v.label?.trim() || v.name}`} onChange={(e) => setVar(v.name, e.target.value)} />
                    : <input value={varVals[v.name] ?? ""} placeholder={`输入${v.label?.trim() || v.name}`} onChange={(e) => setVar(v.name, e.target.value)} />}
                </div>
              );
            })}
          </div>
          <div className="exp2-side-foot">
            {dirty && <div className="exp2-dirty">变量已修改，需重新开始才生效</div>}
            <button className={"btn-outline" + (dirty ? "" : " sm")} style={{ width: "100%", justifyContent: "center" }} onClick={restart} disabled={!started && !dirty}>{dirty ? "应用并重新开始" : "用当前变量重新开始"}</button>
          </div>
          </div>
        </aside>
      )}
    </div>
  );
}
