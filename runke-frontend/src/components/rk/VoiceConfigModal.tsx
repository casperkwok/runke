"use client";

/* 语音配置弹窗（工作流编排用：画布无内嵌配置卡，用此弹窗设 bot.voice_config）。
   单 Agent 走 SingleAgentEditor 内嵌「语音」卡，不用此弹窗。 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { IcPlus, Svg, type IcProps } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { VoicePicker } from "@/components/rk/VoicePicker";
import { api } from "@/lib/api/client";
import { useVoices, voiceById } from "@/lib/rk/voices";

const IcVoice = (p: IcProps) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;

type VC = { enabled?: boolean; voice_id?: string | null; mode?: string; outbound?: boolean; barge_in?: boolean; speed?: number };

export function VoiceConfigModal({ botId, voiceConfig, onClose }: { botId: string; voiceConfig: VC; onClose: () => void }) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(!!voiceConfig.enabled);
  const [voiceId, setVoiceId] = useState<string | null>(voiceConfig.voice_id ?? null);
  const [mode, setMode] = useState(voiceConfig.mode || "call");
  const [outbound, setOutbound] = useState(!!voiceConfig.outbound);
  const [bargeIn, setBargeIn] = useState(voiceConfig.barge_in ?? true);
  const [speed, setSpeed] = useState<number>(voiceConfig.speed ?? 1.0);
  const [pick, setPick] = useState(false);
  const { data: voices } = useVoices();
  const cur = voiceById(voices, voiceId);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH("/api/v1/bots/{bot_id}", {
        params: { path: { bot_id: botId } },
        body: { voice_config: { enabled, voice_id: voiceId, mode, outbound, barge_in: bargeIn, speed } },
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot", botId] }); onClose(); },
  });

  return (
    <RkModal title="语音配置" icon={<IcVoice s={20} style={{ color: "#16a34a" }} />} w={520} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>取消</button>
        <button className="btn-create" disabled={save.isPending} onClick={() => save.mutate()}>保存</button></>}>
      <div className="sa-row-toggle" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
        <span><b>启用语音</b><i>开启后可用语音通话 / 语音外呼，并在预览里拨打测试</i></span>
        <button className="tg-wrap" onClick={() => setEnabled((v) => !v)}><span className={"tg" + (enabled ? " on" : "")}><span className="tg-dot" /></span></button>
      </div>
      {enabled && (
        <>
          <div className="sa-sublbl">音色 <span className="muted" style={{ fontWeight: 400 }}>· 来自音色库</span></div>
          {cur ? (
            <div className="bound-skill">
              <span className={"voice-av " + (cur.gender === "男" ? "male" : "female")} style={{ width: 34, height: 34 }}><IcVoice s={17} /></span>
              <span className="bound-text" style={{ flex: 1, minWidth: 0 }}>
                <b>{cur.name}</b>
                <i style={{ display: "block", fontStyle: "normal", fontSize: 12.5, color: "var(--ink-3)" }}>{cur.gender} · {cur.lang}</i>
              </span>
              <button className="df-ic icon-btn" onClick={() => setPick(true)}>更换</button>
            </div>
          ) : (
            <button className="dashed-btn" onClick={() => setPick(true)}><IcPlus s={15} /> 选择音色</button>
          )}
          <div className="sa-sublbl">语速 <span className="muted" style={{ fontWeight: 400 }}>· {speed.toFixed(1)}x</span></div>
          <div className="row" style={{ gap: 10, maxWidth: 360 }}>
            <span className="muted" style={{ fontSize: 12 }}>慢</span>
            <input type="range" min={0.8} max={2} step={0.1} value={speed} style={{ flex: 1 }} onChange={(e) => setSpeed(Number(e.target.value))} />
            <span className="muted" style={{ fontSize: 12 }}>快</span>
          </div>
          <div className="sa-sublbl">交互形式</div>
          <div className="seg" style={{ maxWidth: 280 }}>
            <button className={"seg-btn" + (mode === "call" ? " on" : "")} onClick={() => setMode("call")}>语音通话</button>
            <button className={"seg-btn" + (mode === "message" ? " on" : "")} onClick={() => setMode("message")}>语音消息</button>
          </div>
          <div className="sa-row-toggle">
            <span><b>语音外呼</b><i>允许该智能体发起外呼任务</i></span>
            <button className="tg-wrap" onClick={() => setOutbound((v) => !v)}><span className={"tg" + (outbound ? " on" : "")}><span className="tg-dot" /></span></button>
          </div>
          <div className="sa-row-toggle">
            <span><b>打断响应</b><i>用户说话时可随时打断 AI 发音</i></span>
            <button className="tg-wrap" onClick={() => setBargeIn((v) => !v)}><span className={"tg" + (bargeIn ? " on" : "")}><span className="tg-dot" /></span></button>
          </div>
        </>
      )}
      {pick && <VoicePicker value={voiceId} onClose={() => setPick(false)} onConfirm={(id) => setVoiceId(id)} />}
    </RkModal>
  );
}
