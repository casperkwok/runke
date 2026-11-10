"""火山 TTS 一次性合成（音色试听用）。

复用 voice-agent 的双向流式协议（wss://openspeech.bytedance.com/api/v3/tts/bidirection），
但这里是「一句话一次合成」：StartConnection→StartSession→TaskRequest(整段文本)→FinishSession，
收齐 PCM 后封 WAV 返回。密钥与 voice-agent 共用（VOLC_TTS_API_KEY / VOLC_TTS_RESOURCE_ID）。
"""
import asyncio
import json
import struct
import uuid

import websockets

from app.core.config import settings

URL = "wss://openspeech.bytedance.com/api/v3/tts/bidirection"
SAMPLE_RATE = 24000  # 试听用 24k mono s16le，体积小、够清晰

MT_CLIENT_REQ = 0b0001
MT_AUDIO_RSP = 0b1011
MT_ERROR = 0b1111
FLAG_EVENT = 0b0100
SER_JSON = 0b0001

EV_StartConnection = 1
EV_StartSession = 100
EV_FinishSession = 102
EV_ConnectionStarted = 50
EV_SessionStarted = 150
EV_SessionFinished = 152
EV_SessionFailed = 153
EV_TaskRequest = 200
EV_TTSResponse = 352


def _build(event: int, payload: dict | bytes, session_id: str | None = None) -> bytes:
    header = bytes([(1 << 4) | 1, (MT_CLIENT_REQ << 4) | FLAG_EVENT, (SER_JSON << 4) | 0, 0])
    body = struct.pack(">i", event)
    if session_id is not None:
        sid_b = session_id.encode()
        body += struct.pack(">I", len(sid_b)) + sid_b
    pl = json.dumps(payload, ensure_ascii=False).encode() if isinstance(payload, dict) else payload
    body += struct.pack(">I", len(pl)) + pl
    return header + body


def _parse(data: bytes):
    msg_type = (data[1] >> 4) & 0x0F
    flags = data[1] & 0x0F
    off = 4
    event = None
    if flags & FLAG_EVENT:
        event = struct.unpack(">i", data[off:off + 4])[0]
        off += 4
    if event in (1, 2, 50, 51, 52):
        sz = struct.unpack(">I", data[off:off + 4])[0]
        off += 4 + sz
    elif event is not None and event >= 100:
        sz = struct.unpack(">I", data[off:off + 4])[0]
        off += 4 + sz
    if msg_type == MT_ERROR:
        off += 4
    psz = struct.unpack(">I", data[off:off + 4])[0]
    off += 4
    return msg_type, event, data[off:off + psz]


def _wav(pcm: bytes, sr: int = SAMPLE_RATE, ch: int = 1, bits: int = 16) -> bytes:
    byte_rate = sr * ch * bits // 8
    block_align = ch * bits // 8
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, ch, sr, byte_rate, block_align, bits)
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


class TTSError(RuntimeError):
    pass


async def synthesize(text: str, voice: str, *, resource: str | None = None, speed: float = 1.0,
                     pitch_ratio: float = 1.0, volume_ratio: float = 1.0) -> bytes:
    """合成一段文本，返回 WAV 字节。voice = 火山 speaker key（provider_voice）；
    resource = 火山 resource_id（不同音色族不同，缺省用全局默认）。"""
    if not settings.volc_tts_api_key:
        raise TTSError("未配置 VOLC_TTS_API_KEY")
    if not voice:
        raise TTSError("该音色未配置火山 voice key（provider_voice）")

    headers = {"X-Api-Key": settings.volc_tts_api_key,
               "X-Api-Resource-Id": resource or settings.volc_tts_resource_id}
    sid = uuid.uuid4().hex
    audio_params: dict = {"format": "pcm", "sample_rate": SAMPLE_RATE}
    if speed != 1.0:
        audio_params["speed_ratio"] = speed
    if pitch_ratio != 1.0:
        audio_params["pitch_ratio"] = pitch_ratio
    if volume_ratio != 1.0:
        audio_params["loudness_ratio"] = volume_ratio

    pcm = bytearray()
    async with websockets.connect(URL, additional_headers=headers, max_size=10 * 1024 * 1024, proxy=None) as ws:
        await ws.send(_build(EV_StartConnection, {}))
        _, ev, _ = _parse(await asyncio.wait_for(ws.recv(), timeout=8))
        if ev != EV_ConnectionStarted:
            raise TTSError(f"连接失败 ev={ev}")
        await ws.send(_build(EV_StartSession, {
            "user": {"uid": "runke"}, "event": EV_StartSession, "namespace": "BidirectionalTTS",
            "req_params": {"speaker": voice, "audio_params": audio_params},
        }, session_id=sid))
        _, ev, payload = _parse(await asyncio.wait_for(ws.recv(), timeout=8))
        if ev != EV_SessionStarted:
            raise TTSError(f"会话失败: {payload[:120]!r}")
        await ws.send(_build(EV_TaskRequest, {
            "event": EV_TaskRequest, "namespace": "BidirectionalTTS", "req_params": {"text": text},
        }, session_id=sid))
        await ws.send(_build(EV_FinishSession, {}, session_id=sid))
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=30)
            mt, ev, payload = _parse(raw)
            if mt == MT_AUDIO_RSP and ev == EV_TTSResponse:
                pcm += payload
            elif ev in (EV_SessionFinished, EV_SessionFailed):
                break
    if not pcm:
        raise TTSError("未收到音频")
    return _wav(bytes(pcm))
