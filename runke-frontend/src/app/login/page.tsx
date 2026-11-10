"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/store/auth";

export default function LoginPage() {
  const router = useRouter();
  const setTokens = useAuth((s) => s.setTokens);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@runke.dev");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") {
        const { error } = await api.POST("/api/v1/auth/register", {
          body: { email, password },
        });
        if (error) throw new Error("注册失败（邮箱可能已存在）");
      }
      const { data, error } = await api.POST("/api/v1/auth/login", {
        body: { email, password },
      });
      if (error || !data) throw new Error("邮箱或密码错误");
      setTokens(data.data.access_token, data.data.refresh_token);
      router.push("/bots");
    } catch (err) {
      setError(err instanceof Error ? err.message : "出错了");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-sm p-8">
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="bg-grad flex h-9 w-9 items-center justify-center rounded-[11px] shadow-[0_4px_14px_rgba(86,60,255,0.28)]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="12.5" height="12.5" rx="4.5" fill="#fff" fillOpacity="0.96" />
                  <rect x="9" y="9" width="12" height="12" rx="4.8" fill="#fff" fillOpacity="0.6" />
                </svg>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[22px] font-extrabold tracking-tight text-[#14161F]">润客</span>
                <span className="font-display text-[13px] font-semibold tracking-[0.14em] text-gray-400">
                  RUNKE
                </span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {mode === "login" ? "登录以继续" : "创建新账号"}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" variant="gradient" disabled={loading} className="w-full">
            {loading ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
          </Button>
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="w-full text-center text-xs text-muted-foreground hover:text-brand-blue"
          >
            {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
          </button>
        </form>
      </Card>
    </div>
  );
}
