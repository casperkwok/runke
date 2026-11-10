"use client";

import { useQuery } from "@tanstack/react-query";

import { api, API_BASE } from "@/lib/api/client";
import { useAuth } from "@/lib/store/auth";
import type { components } from "@/lib/api/schema";

export type Voice = components["schemas"]["VoiceOut"];

export function useVoices() {
  return useQuery({
    queryKey: ["voices"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/voices");
      if (error) throw error;
      return data.data as Voice[];
    },
  });
}

export function voiceById(voices: Voice[] | undefined, id: string | null | undefined): Voice | null {
  if (!voices || !id) return null;
  return voices.find((v) => v.id === id) ?? null;
}

let _audio: HTMLAudioElement | null = null;

/** 试听音色：拉取火山实时合成的 WAV（带鉴权）并播放。返回 Audio 以便监听结束。 */
export async function playVoiceSample(voiceId: string): Promise<HTMLAudioElement> {
  if (_audio) { try { _audio.pause(); } catch {} _audio = null; }
  const token = useAuth.getState().token;
  const res = await fetch(`${API_BASE}/api/v1/voices/${voiceId}/sample`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = `试听失败（${res.status}）`;
    try { const j = await res.json(); msg = j?.error?.message || j?.detail || msg; } catch {}
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const audio = new Audio(url);
  _audio = audio;
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  await audio.play();
  return audio;
}
