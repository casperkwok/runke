// 浏览器语音客户端：mic 采集(AudioWorklet 16k) + TTS 播放(48k) + WS 双向 + 事件回调。
// 与 UI 框架无关，page.tsx 包一层 React state。

export type VoiceEvent =
  | { type: "user_text"; text: string }
  | { type: "ai_text"; text: string }
  | { type: "timing"; name: string; ms: number; turn_id?: string }
  | { type: "state"; state: string }
  | { type: "stop_playback" }
  | { type: "playback_done" }
  | { type: string; [k: string]: unknown };

export interface VoiceClientCallbacks {
  onEvent?: (e: VoiceEvent) => void;
  onStatus?: (s: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

const TTS_RATE = 48000; // 后端 Volc 输出 48k

export interface CallVars {
  name?: string;
  gender?: string;
  area?: string;
  company?: string;
  bot_id?: string; // 预览台指定要驱动的 Runke bot（RunkeBrain 用）
  runke_vars?: Record<string, string>; // 额外会话变量（如 record_id/resume）
  voice_resource?: string; // 音色所属火山 resource_id（声音复刻=volc.megatts.default）
  voice_speed?: number;    // 语速倍率（火山 speed_ratio，>1 更快）
}

// ── 话术(system prompt) 拉取/应用：用一次性 WS（仅在「无通话」时用，否则会顶替活跃通话连接）──
export async function fetchPrompt(
  wsUrl: string
): Promise<{ prompt: string; vars: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const to = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("timeout"));
    }, 4000);
    ws.onopen = () => ws.send(JSON.stringify({ type: "get_prompt" }));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      const m = JSON.parse(ev.data);
      if (m.type === "prompt") {
        clearTimeout(to);
        resolve({ prompt: m.prompt ?? "", vars: m.vars ?? {} });
        try { ws.close(); } catch {}
      }
    };
    ws.onerror = () => {
      clearTimeout(to);
      reject(new Error("ws error"));
    };
  });
}

export async function applyPromptOnce(wsUrl: string, prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const done = () => {
      try { ws.close(); } catch {}
      resolve();
    };
    const to = setTimeout(done, 4000);
    ws.onopen = () => ws.send(JSON.stringify({ type: "set_prompt", prompt }));
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const m = JSON.parse(ev.data);
        if (m.type === "prompt_saved") { clearTimeout(to); done(); }
      }
    };
    ws.onerror = () => { clearTimeout(to); resolve(); };
  });
}

export class VoiceClient {
  private ws?: WebSocket;
  private actx?: AudioContext;
  private micStream?: MediaStream;
  private micNode?: AudioWorkletNode;
  private micSrc?: MediaStreamAudioSourceNode;
  private nextPlayTime = 0;
  private underruns = 0; // 播放欠载计数（块迟到→时间轴重置，是"咔哒/刺刺"的主要来源）
  private liveSources: AudioBufferSourceNode[] = [];
  private gainNode?: GainNode; // 共享输出增益，打断时 ramp-down 淡出
  private asrBackend = "local";
  private voice = "";
  private extra: { prompt?: string } & CallVars = {};
  // KA0：测 S5（首帧 PCM 收到 → WebAudio 实际排播），带 turn_id 回报后端
  private lastTurnId?: string;

  constructor(private wsUrl: string, private cb: VoiceClientCallbacks = {}) {}

  async listDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
    } catch {
      /* 权限被拒，下面 enumerate label 可能为空 */
    }
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === "audioinput");
  }

  // 通话中即时改话术：复用活跃 WS（不会顶替连接）。下一轮 LLM 生效。
  applyPromptLive(prompt: string) {
    this.send({ type: "set_prompt", prompt });
  }

  // 静音：禁用本地麦克风轨（不断连，AI 继续可说）
  setMuted(muted: boolean) {
    this.micStream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  }

  async start(
    deviceId?: string,
    asrBackend: string = "local",
    voice: string = "",
    extra: { prompt?: string } & CallVars = {}
  ) {
    this.asrBackend = asrBackend;
    this.voice = voice;
    this.extra = extra;
    // ★ 显式锁 48k（与 TTS PCM 同率）：默认用设备采样率（如 44.1k）时，WebAudio 会对每个
    // PCM 块独立重采样，块边界插值不连续 → 整段连续"刺刺"毛刺。锁同率后由系统对输出
    // 做一次整体重采样，块间无缝。（麦克风 worklet 按 ctx 实际采样率动态算比例，不受影响）
    this.actx = new AudioContext({ sampleRate: TTS_RATE });
    await this.actx.resume();
    await this.actx.audioWorklet.addModule("/worklets/mic-processor.js");

    const audio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio });

    this.micSrc = this.actx.createMediaStreamSource(this.micStream);
    this.micNode = new AudioWorkletNode(this.actx, "mic-processor");
    this.micNode.port.onmessage = (ev: MessageEvent) => {
      if (this.ws && this.ws.readyState === 1) this.ws.send(ev.data as ArrayBuffer);
    };
    // mic 不接扬声器（避免回环被 AEC 消成 0），接 0 增益 sink 让 worklet 持续跑
    const sink = this.actx.createGain();
    sink.gain.value = 0;
    sink.connect(this.actx.destination);
    this.micSrc.connect(this.micNode);
    this.micNode.connect(sink);

    this.ws = new WebSocket(this.wsUrl);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      this.cb.onStatus?.("已连接");
      this.send({
        type: "start",
        caller: "web",
        asr_backend: this.asrBackend,
        voice: this.voice,
        ...this.extra,
      });
      this.cb.onOpen?.();
    };
    this.ws.onclose = () => {
      this.cb.onStatus?.("连接已关闭");
      this.cb.onClose?.();
    };
    this.ws.onerror = () =>
      this.cb.onStatus?.("连接错误（后端是否以 TRANSPORT=browser 启动？）");
    this.ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") {
        this.playPcm(ev.data as ArrayBuffer);
        return;
      }
      const m = JSON.parse(ev.data) as VoiceEvent;
      if (m.type === "stop_playback") this.stopPlayback();
      // 后端首帧送出时带 turn_id 发来（name=e2e_ms）；记下供本轮首帧排播后回报 S5
      if (m.type === "timing" && m.name === "e2e_ms" && typeof m.turn_id === "string")
        this.lastTurnId = m.turn_id;
      this.cb.onEvent?.(m);
    };
  }

  private send(o: unknown) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }

  private playPcm(arr: ArrayBuffer) {
    if (!this.actx) return;
    const i16 = new Int16Array(arr);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const buf = this.actx.createBuffer(1, f32.length, TTS_RATE);
    buf.copyToChannel(f32, 0);
    const src = this.actx.createBufferSource();
    src.buffer = buf;
    // 语速由服务端 WSOLA 保音调处理（已加速过的 PCM），这里按原速播放即可
    // 经共享 gain 节点出声，打断时对 gain 做 ramp-down 实现淡出（而非瞬断）
    if (!this.gainNode) {
      this.gainNode = this.actx.createGain();
      this.gainNode.connect(this.actx.destination);
    }
    const now = this.actx.currentTime;
    const late = this.nextPlayTime < now; // 块迟到（含一轮首帧）
    const fresh = late && this.liveSources.length === 0; // 一轮的首帧（前面没有排队中的音频）
    if (fresh) this.gainNode.gain.setValueAtTime(1, now); // 新一轮恢复音量（上轮淡出后可能为 0）
    if (late) {
      // 欠载：块迟到导致时间轴重置 → 产生间隙与波形跳变。计数用于定位，淡入用于去咔。
      this.underruns++;
      if (!fresh) console.warn(`[voice] 播放欠载 #${this.underruns}：块迟到 ${Math.round((now - this.nextPlayTime) * 1000)}ms（主线程卡顿/网络抖动）`);
      this.nextPlayTime = now + 0.04;
    }
    // 去咔：仅对迟到块做 4ms 淡入平滑不连续边界（连续块不动，避免周期性音量抖动）
    if (late) {
      const g = this.actx.createGain();
      g.gain.setValueAtTime(0, this.nextPlayTime);
      g.gain.linearRampToValueAtTime(1, this.nextPlayTime + 0.004);
      src.connect(g);
      g.connect(this.gainNode);
    } else {
      src.connect(this.gainNode);
    }
    src.start(this.nextPlayTime);
    // KA0：S5 = 首帧实际排播时刻 − 收到时刻（单钟，无漂移）
    if (fresh && this.lastTurnId) {
      const s5 = (this.nextPlayTime - now) * 1000;
      this.send({ type: "client_timing", turn_id: this.lastTurnId, s5_ms: Math.round(s5) });
      this.lastTurnId = undefined; // 一轮只报一次
    }
    this.nextPlayTime += buf.duration;
    this.liveSources.push(src);
    src.onended = () => {
      this.liveSources = this.liveSources.filter((s) => s !== src);
    };
  }

  private stopPlayback() {
    // 淡出：60ms 内把 gain 拉到 0 再停源，听感从"被掐断"变"自然收声"（打断不再生硬）
    const FADE = 0.06;
    const srcs = this.liveSources;
    this.liveSources = [];
    this.nextPlayTime = 0;
    if (this.actx && this.gainNode && srcs.length) {
      const now = this.actx.currentTime;
      const g = this.gainNode.gain;
      try {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + FADE);
      } catch {
        /* ignore */
      }
      srcs.forEach((s) => {
        try {
          s.stop(now + FADE);
        } catch {
          /* already stopped */
        }
      });
    } else {
      srcs.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      });
    }
  }

  stop() {
    this.send({ type: "stop" });
    try {
      this.ws?.close();
    } catch {}
    try {
      this.micNode?.disconnect();
      this.micSrc?.disconnect();
    } catch {}
    try {
      this.micStream?.getTracks().forEach((t) => t.stop());
    } catch {}
    this.stopPlayback();
    try {
      this.actx?.close();
    } catch {}
  }
}
