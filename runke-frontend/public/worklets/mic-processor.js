// 麦克风采集 Worklet：ctx.sampleRate（通常 48k）→ 16k，盒式低通抗混叠，输出 Int16。
// 在音频线程跑，不卡 UI。每块 postMessage 一个 Int16 PCM buffer 给主线程发 WS。
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.outRate = 16000;
    this.ratio = sampleRate / this.outRate; // sampleRate 是 worklet 全局
    this._carry = [];                        // 跨块残留的输入样本
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    const buf = this._carry;
    for (let i = 0; i < ch.length; i++) buf.push(ch[i]);

    const ratio = this.ratio;
    const out = [];
    let i = 0;
    while ((i + 1) * ratio <= buf.length) {
      const start = Math.floor(i * ratio), end = Math.floor((i + 1) * ratio);
      let s = 0, n = 0;
      for (let j = start; j < end; j++) { s += buf[j]; n++; }
      const v = n ? s / n : 0;
      out.push(Math.max(-32768, Math.min(32767, v * 32768)));
      i++;
    }
    const consumed = Math.floor(i * ratio);
    this._carry = buf.slice(consumed);

    if (out.length) {
      const i16 = new Int16Array(out);
      this.port.postMessage(i16.buffer, [i16.buffer]);
    }
    return true;
  }
}
registerProcessor("mic-processor", MicProcessor);
