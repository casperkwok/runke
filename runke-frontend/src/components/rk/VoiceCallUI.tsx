"use client";

/* 预览·语音通话 —— 严格对齐 Runke 产品原型 V2（voice-call.jsx + preview.jsx）：
   - 空闲：语音条「拨打语音测试」
   - 通话中：沉浸式通话屏（头像光环 + 大波形 + 实时字幕 + 静音/挂断/转人工）
   - 最小化：底部 dock 细条，对话保持可见
   后端真实接 VoiceAgent 调试 transport（DebugWS :8890），非脚本演示。 */
import { useEffect, useRef, useState } from "react";

import { IcChevDown, IcChevUp, IcHuman, IcPhone, Svg, type IcProps } from "@/components/icons/rk";
import { useToast } from "@/components/ui/use-toast";
import { VoiceClient, type CallVars, type VoiceEvent } from "@/lib/rk/voiceClient";

const VIcMic = (p: IcProps) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;
const IcMicOff = (p: IcProps) => <Svg {...p}><path d="M9 9v3a3 3 0 0 0 5 1M15 11V6a3 3 0 0 0-5.6-1.5" /><path d="M5 11a7 7 0 0 0 11 5.3M19 11a7 7 0 0 1-.5 2.6M12 18v3" /><path d="m3 3 18 18" /></Svg>;

type Turn = { who: "me" | "bot"; text: string; partial?: boolean };

/* 确定性伪随机波形条（对齐原型 waveBars） */
function waveBars(seed: string, n: number): number[] {
  let s = 0;
  for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) % 100000;
  const out: number[] = [];
  for (let i = 0; i < n; i++) { s = (s * 9301 + 49297) % 233280; out.push(0.25 + (s / 233280) * 0.75); }
  return out;
}
function Waveform({ seed, playing, n = 28, h = 30, color = "var(--primary)" }: { seed: string; playing?: boolean; n?: number; h?: number; color?: string }) {
  const bars = waveBars(seed, n);
  return (
    <div className="wave" style={{ height: h }}>
      {bars.map((b, i) => (
        <span key={i} className={"wave-bar" + (playing ? " play" : "")} style={{ height: b * h + "px", background: color, animationDelay: i * 0.045 + "s" }} />
      ))}
    </div>
  );
}

const fmt = (s: number) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");

function resolveWsUrl(): string {
  const env = process.env.NEXT_PUBLIC_VOICE_WS;
  if (env) return env;
  if (typeof window !== "undefined") return `ws://${window.location.hostname}:8890`;
  return "ws://127.0.0.1:8890";
}

export type VoiceTurn = { who: "me" | "bot"; text: string; partial?: boolean };

export function VoiceCallUI({
  botId, voice, voiceResource, voiceSpeed, voiceName, agentName, agentImg, callVars, bar = "pv", onTurns, onEnded,
}: {
  botId: string;
  voice: string;          // 火山 provider_voice key
  voiceResource?: string; // 音色所属火山 resource_id
  voiceSpeed?: number;    // 语速倍率
  voiceName: string;      // 展示名（音色）
  agentName: string;
  agentImg: string;
  callVars: CallVars;
  bar?: "pv" | "sa";      // pv=工作流(条含提示) / sa=单Agent(仅按钮，提示在开场区)
  onTurns?: (turns: VoiceTurn[]) => void;   // 实时把转写同步到主对话线程
  onEnded?: (durSec: number) => void;       // 挂断时回报通话时长
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<"idle" | "connecting" | "incall" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [min, setMin] = useState(false);
  const [muted, setMuted] = useState(false);
  const [callSec, setCallSec] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const clientRef = useRef<VoiceClient | null>(null);
  const openedRef = useRef(false);
  const partialId = useRef<number | null>(null);
  const aiBoundary = useRef(true);   // 下一句 AI 文本是否另起新气泡（话轮边界）
  const capRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (capRef.current) capRef.current.scrollTop = capRef.current.scrollHeight; }, [turns]);
  // 把转写实时镜像到父组件（主对话线程）
  const onTurnsRef = useRef(onTurns);
  useEffect(() => { onTurnsRef.current = onTurns; });
  useEffect(() => { onTurnsRef.current?.(turns); }, [turns]);
  const callSecRef = useRef(0);
  useEffect(() => { callSecRef.current = callSec; }, [callSec]);
  useEffect(() => {
    if (phase !== "incall") return;
    const id = setInterval(() => setCallSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => () => { clientRef.current?.stop(); }, []);

  const onEvent = (e: VoiceEvent) => {
    if (e.type === "state") {
      // 用户开始说话 = 一个新话轮的硬边界：下一句 AI 回复另起气泡（即使本轮 ASR 为空没出 user_text）
      if ((e as { state?: string }).state === "user_speaking") { aiBoundary.current = true; partialId.current = null; }
    } else if (e.type === "user_text") {
      const text = String((e as { text?: string }).text ?? "");
      if (!text.trim()) return;
      aiBoundary.current = true;
      setTurns((ls) => {
        if (partialId.current != null && ls[partialId.current]) {
          const c = [...ls]; c[partialId.current] = { who: "me", text, partial: true }; return c;
        }
        partialId.current = ls.length; return [...ls, { who: "me", text, partial: true }];
      });
    } else if (e.type === "user_text_final") {
      const text = String((e as { text?: string }).text ?? "");
      aiBoundary.current = true;
      if (!text.trim()) { partialId.current = null; return; }
      setTurns((ls) => {
        if (partialId.current != null && ls[partialId.current]) {
          const c = [...ls]; c[partialId.current] = { who: "me", text }; return c;
        }
        return [...ls, { who: "me", text }];
      });
      partialId.current = null;
    } else if (e.type === "ai_text") {
      const text = String((e as { text?: string }).text ?? "");
      if (!text.trim()) return;
      partialId.current = null;   // AI 开始回复 = 上一个用户话轮结束，下条 user_text 另起气泡
      setTurns((ls) => {
        const last = ls[ls.length - 1];
        // 仅当同一 AI 话轮内（未跨越用户话轮）才把句子并入同一气泡
        if (!aiBoundary.current && last && last.who === "bot") {
          const c = [...ls]; c[c.length - 1] = { who: "bot", text: (last.text + " " + text).trim() }; return c;
        }
        aiBoundary.current = false;
        return [...ls, { who: "bot", text }];
      });
    }
  };

  const startCall = async () => {
    setTurns([]); setCallSec(0); setMuted(false); setMin(false); setErrMsg(""); partialId.current = null;
    openedRef.current = false; aiBoundary.current = true;
    setPhase("connecting");
    const c = new VoiceClient(resolveWsUrl(), {
      onEvent,
      onOpen: () => { openedRef.current = true; setPhase("incall"); },
      // 连上前就断开 = 连不上语音服务；不要静默退回（之前的「闪一下就退出」）
      onClose: () => {
        if (openedRef.current) { onEnded?.(callSecRef.current); setPhase("idle"); }
        else { setErrMsg(`未能连接语音服务（${resolveWsUrl()}）。请在本机启动 voice-agent：\nTRANSPORT=browser BRAIN=runke uv run python -u main.py`); setPhase("error"); }
      },
      onStatus: () => {},
    });
    clientRef.current = c;
    try {
      await c.start(undefined, "volc", voice, { ...callVars, bot_id: botId, voice_resource: voiceResource, voice_speed: voiceSpeed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 多为麦克风权限被拒/无麦克风
      setErrMsg(/permission|denied|notallowed|notfound/i.test(msg) ? "无法访问麦克风：请在浏览器允许麦克风权限后重试。" : "拨打失败：" + msg);
      setPhase("error");
      try { c.stop(); } catch {}
    }
  };
  const hangup = () => { clientRef.current?.stop(); clientRef.current = null; onEnded?.(callSec); setPhase("idle"); setMin(false); };
  const toggleMute = () => { const m = !muted; setMuted(m); clientRef.current?.setMuted(m); };

  // 连接失败 / 麦克风错误：明确提示 + 重试（不再静默退回）
  if (phase === "error") {
    return (
      <div className="pv-voice-bar">
        <div className="pv-call-err">{errMsg}</div>
        <button className="pv-call-btn" onClick={startCall}><VIcMic s={18} style={{ color: "#fff" }} /> 重试拨打</button>
      </div>
    );
  }

  // 空闲：拨打条（单 Agent 仅按钮居中；工作流条内含音色提示）
  if (phase === "idle") {
    if (bar === "sa") {
      return (
        <div className="sa-voice-bar">
          <button className="pv-call-btn" onClick={startCall}><VIcMic s={18} style={{ color: "#fff" }} /> 拨打语音测试</button>
        </div>
      );
    }
    return (
      <div className="pv-voice-bar">
        <div className="pv-voice-hint"><VIcMic s={16} style={{ color: "var(--primary)" }} /> 语音模式 · 当前音色「{voiceName || "未选择"}」</div>
        <button className="pv-call-btn" onClick={startCall}><VIcMic s={18} style={{ color: "#fff" }} /> 拨打语音测试</button>
      </div>
    );
  }

  // 最小化：底部 dock
  if (min) {
    return (
      <div className="call-dock">
        <span className="cd-pulse"><span className="cd-pulse-ring" /><VIcMic s={15} style={{ color: "#fff" }} /></span>
        <span className="cd-info"><b>通话中 · {fmt(callSec)}</b><i>「{voiceName}」· {phase === "connecting" ? "接通中…" : "转写实时显示在通话屏"}</i></span>
        <Waveform seed="vcdock" playing n={12} h={18} color="var(--primary)" />
        <button className="cd-expand" onClick={() => setMin(false)} title="展开通话"><IcChevUp s={18} style={{ color: "var(--ink-2)" }} /></button>
        <button className="cd-hangup" onClick={hangup} title="挂断"><IcPhone s={16} style={{ color: "#fff" }} /></button>
      </div>
    );
  }

  // 通话屏（沉浸式，覆盖预览）
  return (
    <div className="callscreen fade-in">
      <button className="cs-min" onClick={() => setMin(true)} title="收起到对话"><IcChevDown s={22} style={{ color: "#fff" }} /></button>
      <div className="cs-stage">
        <div className="cs-avatar">
          <span className="cs-ring" /><span className="cs-ring d2" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={agentImg} alt="" />
        </div>
        <div className="cs-name">{agentName}</div>
        <div className="cs-status"><span className="cs-live-dot" />{phase === "connecting" ? "接通中…" : "通话中 · " + fmt(callSec)}</div>
        <div className="cs-voice">AI 音色「{voiceName}」</div>
        <div className="cs-bigwave"><Waveform seed="vcbig" playing n={40} h={40} color="rgba(255,255,255,.9)" /></div>
      </div>
      <div className="cs-captions" ref={capRef}>
        {turns.length === 0
          ? <div className="cs-cap-empty">{phase === "connecting" ? "正在接通…" : "通话已接通，正在聆听…"}</div>
          : turns.map((t, i) => (
            <div key={i} className={"cs-cap " + t.who + (i === turns.length - 1 ? " latest" : "")}>
              <span className="cs-cap-who">{t.who === "me" ? "客户" : agentName}</span>
              <span className="cs-cap-text">{t.text}</span>
            </div>
          ))}
      </div>
      <div className="cs-controls">
        <button className={"cs-ctrl" + (muted ? " on" : "")} onClick={toggleMute}>
          <span className="cs-ctrl-ic">{muted ? <IcMicOff s={20} style={{ color: "#fff" }} /> : <VIcMic s={20} style={{ color: "#fff" }} />}</span>
          <i>{muted ? "已静音" : "静音"}</i>
        </button>
        <button className="cs-hangup" onClick={hangup}><IcPhone s={26} style={{ color: "#fff" }} /></button>
        <button className="cs-ctrl" onClick={() => toast({ title: "已转人工接管" })}>
          <span className="cs-ctrl-ic"><IcHuman s={20} style={{ color: "#fff" }} /></span>
          <i>转人工</i>
        </button>
      </div>
    </div>
  );
}
