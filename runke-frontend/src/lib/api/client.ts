import createClient from "openapi-fetch";

import { useAuth } from "@/lib/store/auth";
import type { paths } from "./schema";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8088";

export const api = createClient<paths>({ baseUrl: API_BASE });

// 用 refresh token 静默续期（并发去重：同一时刻只发一次刷新）
let refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  const rt = useAuth.getState().refreshToken;
  if (!rt) return Promise.resolve(false);
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (!resp.ok) return false;
        const j = await resp.json();
        const d = j?.data ?? j;
        if (d?.access_token) {
          useAuth.getState().setTokens(d.access_token, d.refresh_token ?? rt);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

// 保存请求快照，401 续期后重试用
const reqClones = new WeakMap<Request, Request>();

api.use({
  onRequest({ request }) {
    const token = useAuth.getState().token;
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    try { reqClones.set(request, request.clone()); } catch { /* no body */ }
    return request;
  },
  async onResponse({ request, response }) {
    if (response.status !== 401) return response;
    // 刷新端点本身 401 → 直接登出
    if (request.url.includes("/auth/refresh")) { useAuth.getState().clear(); return response; }
    const ok = await refreshSession();
    if (!ok) { useAuth.getState().clear(); return response; }
    // 续期成功：带新 token 重放原请求
    const token = useAuth.getState().token;
    const base = reqClones.get(request) ?? request;
    const retry = new Request(base, {});
    if (token) retry.headers.set("Authorization", `Bearer ${token}`);
    const retried = await fetch(retry);
    if (retried.status === 401) useAuth.getState().clear();
    return retried;
  },
});

/** 上传文件到知识库（multipart）：解析→分块→入向量库。 */
export async function uploadKbFile(kbId: string, file: File): Promise<void> {
  const token = useAuth.getState().token;
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${API_BASE}/api/v1/knowledge-bases/${kbId}/documents/upload`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  if (!resp.ok) {
    let msg = `上传失败: ${resp.status}`;
    try {
      const j = await resp.json();
      msg = j?.error?.message || j?.detail || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

/** 文件导入客户资源包（multipart）：解析→去重 upsert→归入资源包，返回统计。
 *  packId 为空=新建包；非空=对已有 file 包再次导入，mode=append 追加 / overwrite 覆盖。 */
export async function importCustomerPack(
  name: string,
  file: File,
  opts?: { packId?: string; mode?: "append" | "overwrite" },
): Promise<{ pack_name: string; mode: string; total: number; created: number; updated: number; skipped: number; members: number }> {
  const token = useAuth.getState().token;
  const form = new FormData();
  form.append("name", name);
  form.append("file", file);
  if (opts?.packId) form.append("pack_id", opts.packId);
  if (opts?.mode) form.append("mode", opts.mode);
  const resp = await fetch(`${API_BASE}/api/v1/customers/packs/import`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(body?.error?.message || body?.detail || `导入失败: ${resp.status}`);
  return body.data;
}

/** 导出客户为 Excel 并触发浏览器下载；packId 为空导出全部，否则导出该资源包成员。 */
export async function exportCustomers(packId?: string): Promise<void> {
  const token = useAuth.getState().token;
  const url = `${API_BASE}/api/v1/customers/export${packId ? `?pack_id=${packId}` : ""}`;
  const resp = await fetch(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!resp.ok) throw new Error(`导出失败: ${resp.status}`);
  const blob = await resp.blob();
  const cd = resp.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename\*=UTF-8''([^;]+)/);
  const filename = m ? decodeURIComponent(m[1]) : "客户导出.xlsx";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** SSE 流式 completion：openapi-fetch 不擅长流，用原生 fetch 解析 event-stream。 */
export async function streamCompletion(
  conversationId: string,
  content: string,
  onDelta: (text: string) => void,
  onEvent?: (payload: Record<string, unknown>) => void,
): Promise<void> {
  const token = useAuth.getState().token;
  const resp = await fetch(
    `${API_BASE}/api/v1/conversations/${conversationId}/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content }),
    },
  );
  if (!resp.ok || !resp.body) throw new Error(`completion failed: ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.trim();
      if (!line.startsWith("data:")) continue;
      try {
        const payload = JSON.parse(line.slice(5).trim());
        if (payload.type === "delta") onDelta(payload.content);
        else if (payload.type === "error") throw new Error(payload.message);
        else onEvent?.(payload);
      } catch {
        /* 忽略半包/解析失败 */
      }
    }
  }
}
