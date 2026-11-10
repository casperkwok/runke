"use client";

/* 发布渠道：API 令牌 + 企业微信（原型态 mock）+ 网站集成（真实可嵌入小部件）。 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  IcClose,
  IcEmptyBox,
  IcPlus,
  IcTrash,
  IcWeixin,
} from "@/components/icons/rk";
import { api, API_BASE } from "@/lib/api/client";
import { botAvatar } from "@/lib/rk/avatar";
import { useToast } from "@/components/ui/use-toast";
import type { components } from "@/lib/api/schema";

type BotOut = components["schemas"]["BotOut"];

const AVATARS = ["/avatars/01.png", "/avatars/02.png", "/avatars/03.png", "/avatars/04.png", "/avatars/05.png"];

const SEED_WX = [
  { name: "王敏", role: "售前顾问", empId: "E1002", on: true, src: AVATARS[1] },
  { name: "李航", role: "客户成功", empId: "E1015", on: false, src: AVATARS[3] },
];

export function DeployConfig({ bot, onSaved }: { bot: BotOut; onSaved?: () => void }) {
  const [tab, setTab] = useState<"api" | "wx" | "web">("api");
  return (
    <div className="deploy-root">
      <div className="deploy-card">
        <div className="dp-tabs">
          <button className={"dp-tab" + (tab === "api" ? " on" : "")} onClick={() => setTab("api")}>API令牌</button>
          <button className={"dp-tab" + (tab === "wx" ? " on" : "")} onClick={() => setTab("wx")}>企业微信</button>
          <button className={"dp-tab" + (tab === "web" ? " on" : "")} onClick={() => setTab("web")}>网站集成</button>
        </div>
        {tab === "api" ? <ApiTokens bot={bot} /> : tab === "wx" ? <WeixinDeploy /> : <WebsiteIntegration bot={bot} onSaved={onSaved} />}
      </div>
    </div>
  );
}

interface WidgetCfg { title?: string; color?: string; logo?: string; welcome?: string }

function WebsiteIntegration({ bot, onSaved }: { bot: BotOut; onSaved?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const cfg = (bot.widget_config as WidgetCfg) ?? {};
  const [enabled, setEnabled] = useState(bot.widget_enabled);
  const [title, setTitle] = useState(cfg.title ?? bot.name);
  const [color, setColor] = useState(cfg.color ?? "#3B5BFF");
  const [logo, setLogo] = useState(cfg.logo ?? "");
  const [welcome, setWelcome] = useState(cfg.welcome ?? bot.welcome ?? "");
  const [copied, setCopied] = useState(false);
  const first = useRef(true);

  const patch = useMutation({
    mutationFn: async (body: components["schemas"]["BotUpdate"]) => {
      const { error } = await api.PATCH("/api/v1/bots/{bot_id}", { params: { path: { bot_id: bot.id } }, body });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot", bot.id] }); onSaved?.(); },
  });

  // 样式防抖保存
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => patch.mutate({ widget_config: { title, color, logo, welcome } }), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, color, logo, welcome]);

  const toggleEnabled = () => { const v = !enabled; setEnabled(v); patch.mutate({ widget_enabled: v }); };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = `<script src="${origin}/embed.js" data-bot="${bot.id}" data-color="${color}"></script>`;
  const previewLogo = logo || botAvatar(bot);

  const copy = () => {
    navigator.clipboard?.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="dp-pane fade-in">
      <div className="wi-head">
        <div>
          <h3 className="dp-h3">网站嵌入集成</h3>
          <p className="dp-sub">把下面一行脚本粘贴到你网站的 HTML <code>&lt;/body&gt;</code> 前，网站右下角就会出现可对话的悬浮小部件。</p>
        </div>
        <button className="tg-wrap" onClick={toggleEnabled}>
          <span className={"tg" + (enabled ? " on" : "")}><span className="tg-dot" /></span>
          <span className="tg-label">{enabled ? "已开启" : "未开启"}</span>
        </button>
      </div>

      {!bot.published && <div className="wi-warn">该智能体尚未发布，小部件暂不可对外访问。请先点右上角「发布」。</div>}
      {bot.published && !enabled && <div className="wi-warn">小部件开关未开启，访客访问会提示不可用。打开右上角开关即可生效。</div>}

      <div className="wi-grid">
        {/* 左：嵌入码 + 样式编辑 */}
        <div className="wi-left">
          <div className="wi-lbl">嵌入代码</div>
          <div className="wi-code">{snippet}</div>
          <button className="btn-primary" style={{ marginTop: 10 }} onClick={copy}>{copied ? "已复制 ✓" : "复制粘贴"}</button>

          <div className="wi-lbl" style={{ marginTop: 22 }}>外观设置</div>
          <div className="wi-field"><label>标题</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={bot.name} /></div>
          <div className="wi-field"><label>主色</label>
            <span className="wi-color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /><input value={color} onChange={(e) => setColor(e.target.value)} /></span>
          </div>
          <div className="wi-field"><label>Logo URL</label><input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="留空则用 Agent 头像" /></div>
          <div className="wi-field"><label>开场白</label><textarea value={welcome} rows={2} onChange={(e) => setWelcome(e.target.value)} placeholder={bot.welcome || "你好，有什么可以帮你的吗？"} /></div>
        </div>

        {/* 右：实时预览 */}
        <div className="wi-preview">
          <div className="wi-prev-lbl">实时预览</div>
          <div className="wi-bubble-demo" style={{ ["--wc" as string]: color }}>
            <div className="wi-pv-head" style={{ background: color }}>
              <span className="wi-pv-id">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={previewLogo} alt="" /><b>{title || bot.name}</b></span>
              <span style={{ opacity: .85 }}>✕</span>
            </div>
            <div className="wi-pv-body">
              <div className="wi-pv-msg">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={previewLogo} alt="" /><div className="wi-pv-bubble">{welcome || bot.welcome || "你好，有什么可以帮你的吗？"}</div></div>
              {(bot.examples ?? []).slice(0, 2).map((q, i) => <div key={i} className="wi-pv-chip" style={{ color }}>{q}</div>)}
            </div>
            <div className="wi-pv-input"><span>请详细描述你的问题</span><span className="wi-pv-send" style={{ background: color }}>➤</span></div>
            <div className="wi-pv-foot">Powered by <b>Runke.ai</b></div>
          </div>
          {bot.published && enabled && (
            <a className="link-blue" style={{ display: "inline-block", marginTop: 14, fontSize: 13 }} href={`${origin}/widget/${bot.id}`} target="_blank" rel="noreferrer">在新标签页打开真实小部件 ↗</a>
          )}
        </div>
      </div>
    </div>
  );
}

type ApiToken = components["schemas"]["ApiTokenOut"];

function fmtTs(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ApiTokens({ bot }: { bot: BotOut }) {
  const qc = useQueryClient();
  const [created, setCreated] = useState<components["schemas"]["ApiTokenCreated"] | null>(null);
  const { data: tokens } = useQuery({
    queryKey: ["tokens", bot.id],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/bots/{bot_id}/tokens", { params: { path: { bot_id: bot.id } } });
      if (error) throw error;
      return data.data as ApiToken[];
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/v1/bots/{bot_id}/tokens", { params: { path: { bot_id: bot.id } }, body: { name: "Runke-Token" } });
      if (error) throw error;
      return data.data;
    },
    onSuccess: (d) => { setCreated(d); qc.invalidateQueries({ queryKey: ["tokens", bot.id] }); },
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/v1/bots/{bot_id}/tokens/{token_id}", { params: { path: { bot_id: bot.id, token_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tokens", bot.id] }),
  });
  const list = tokens ?? [];

  return (
    <div className="dp-pane fade-in">
      <div className="dp-intro">
        <div className="dp-intro-text">
          <p>用于其他应用程序和平台的访问令牌，外部应用以 <code>Authorization: Bearer rk-…</code> 调用本智能体的对话接口。</p>
          <p>令牌仅在创建时完整显示一次，请妥善保存。不要在浏览器或公开场合泄露；泄露的令牌请及时删除。</p>
        </div>
        <button className={"btn-primary" + (add.isPending ? " dis" : "")} disabled={add.isPending} onClick={() => add.mutate()}>{add.isPending ? "签发中…" : "添加新令牌"}</button>
      </div>
      <div className="dp-table">
        <div className="dp-thead">
          <span>名称</span><span>API密钥</span><span>创建时间</span><span>最后使用时间</span><span>过期时间</span><span>状态</span><span>操作</span>
        </div>
        {list.length === 0 ? (
          <div className="dp-empty"><IcEmptyBox s={56} style={{ color: "var(--ink-4)" }} /><div>暂无API令牌</div></div>
        ) : (
          list.map((t) => (
            <div className="dp-trow" key={t.id}>
              <span className="dp-name">{t.name}</span>
              <span className="muted mono">{t.prefix}••••••</span>
              <span className="muted">{fmtTs(t.created_at)}</span>
              <span className="muted">{fmtTs(t.last_used_at)}</span>
              <span className="muted">{t.expires_at ? fmtTs(t.expires_at) : "永不过期"}</span>
              <span><span className="pill pill-on">有效</span></span>
              <span className="dp-ops">
                <button className="icon-btn" onClick={() => del.mutate(t.id)}>
                  <IcTrash s={17} style={{ color: "var(--ink-2)" }} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
      {created && <NewTokenModal bot={bot} token={created} onClose={() => setCreated(null)} />}
    </div>
  );
}

function NewTokenModal({ bot, token, onClose }: { bot: BotOut; token: components["schemas"]["ApiTokenCreated"]; onClose: () => void }) {
  const [copied, setCopied] = useState("");
  const curl = `curl -N -X POST ${API_BASE}/api/v1/openapi/chat \\
  -H "Authorization: Bearer ${token.key}" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"你好"}'`;
  const copy = (text: string, which: string) => { navigator.clipboard?.writeText(text); setCopied(which); setTimeout(() => setCopied(""), 1600); };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="qr-modal pop-in" style={{ width: 600, padding: 28, display: "block" }} onClick={(e) => e.stopPropagation()}>
        <button className="qr-close" onClick={onClose}><IcClose s={20} style={{ color: "var(--ink-3)" }} /></button>
        <h3 className="dp-h3" style={{ marginBottom: 6 }}>令牌已创建</h3>
        <p className="dp-sub" style={{ marginBottom: 16 }}>请立即复制保存——关闭后将无法再次查看完整密钥。</p>
        <div className="tk-key">
          <code>{token.key}</code>
          <button className="btn-primary" onClick={() => copy(token.key, "key")}>{copied === "key" ? "已复制 ✓" : "复制"}</button>
        </div>
        <div className="wi-lbl" style={{ marginTop: 22 }}>调用示例（{bot.name}）</div>
        <pre className="tk-curl">{curl}</pre>
        <button className="btn-text" style={{ marginTop: 8 }} onClick={() => copy(curl, "curl")}>{copied === "curl" ? "已复制 ✓" : "复制调用示例"}</button>
        <p className="dp-sub" style={{ marginTop: 12 }}>返回 SSE 流；首个事件含 <code>conversation_id</code>，后续请求可带上以延续会话。需先「发布」该智能体。</p>
      </div>
    </div>
  );
}

function WeixinDeploy() {
  const [emps, setEmps] = useState(SEED_WX);
  const [qr, setQr] = useState(false);
  const [secs, setSecs] = useState(34);
  useEffect(() => {
    if (!qr) return;
    const id = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 60)), 1000);
    return () => clearInterval(id);
  }, [qr]);
  const toggle = (i: number) => setEmps((e) => e.map((x, j) => (j === i ? { ...x, on: !x.on } : x)));
  return (
    <div className="dp-pane fade-in">
      <h3 className="dp-h3">关联员工并部署</h3>
      <p className="dp-sub">
        在以下平台发布你的Bot，即表示你已充分理解并同意遵循各发布渠道服务条款（包括但不限于任何隐私政策、社区指南、数据处理协议等）
      </p>
      <button className="btn-ghost" onClick={() => { setQr(true); setSecs(34); }}>
        <IcPlus s={16} /> 关联员工
      </button>
      <div className="dp-table wx">
        <div className="dp-thead wx"><span>员工</span><span>渠道</span><span>授权</span><span>是否启用</span></div>
        {emps.map((e, i) => (
          <div className="dp-trow wx" key={i}>
            <span className="wx-emp">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.src} alt="" />
              <span><b>{e.name}</b><i>{e.role}　{e.empId}</i></span>
            </span>
            <span className="wx-channel">
              <IcWeixin s={18} style={{ color: "#2DBC4E" }} /> 企业微信{" "}
              <span className="link-blue" style={{ marginLeft: 10 }}>+ 新增场景</span>
            </span>
            <span><span className="link-blue" onClick={() => { setQr(true); setSecs(34); }}>配置授权</span></span>
            <span>
              <button className="tg-wrap" onClick={() => toggle(i)}>
                <span className={"tg" + (e.on ? " on" : "")}><span className="tg-dot" /></span>
                <span className="tg-label">{e.on ? "启用" : "停用"}</span>
              </button>
            </span>
          </div>
        ))}
      </div>
      {qr && <QrModal secs={secs} onClose={() => setQr(false)} />}
    </div>
  );
}

function QrModal({ secs, onClose }: { secs: number; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="qr-modal pop-in" onClick={(e) => e.stopPropagation()}>
        <button className="qr-close" onClick={onClose}><IcClose s={20} style={{ color: "var(--ink-3)" }} /></button>
        <div className="qr-left">
          <div className="qr-illus"><div className="qr-phone" /><div className="qr-laptop" /></div>
          <h4>使用想要托管的企微账号扫码</h4>
          <ul>
            <li>扫码托管后，扫码账号将托管在云端电脑上</li>
            <li>企微App上方将显示：Windows/Mac/iPad/Android Pad已录登</li>
            <li>托管后云端电脑将24小时在线，关闭网页或电脑不影响</li>
          </ul>
        </div>
        <div className="qr-right">
          <div className="qr-title"><IcWeixin s={20} style={{ color: "#2DBC4E" }} /> 企业微信扫码授权</div>
          <div className="qr-code"><QrGrid /></div>
          <div className="qr-refresh">↻ 刷新 ({secs}s)</div>
        </div>
      </div>
    </div>
  );
}

function QrGrid() {
  const cells: boolean[] = [];
  let s = 7;
  for (let i = 0; i < 441; i++) {
    s = (s * 9301 + 49297) % 233280;
    cells.push(s / 233280 > 0.5);
  }
  const corner = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7);
  return (
    <div className="qr-grid">
      {cells.map((v, i) => {
        const r = Math.floor(i / 21);
        const c = i % 21;
        const on = corner(r, c)
          ? r % 6 === 0 || c % 6 === 0 || (r > 1 && r < 5 && c > 1 && c < 5) || (r > 1 && r < 5 && c > 15 && c < 19) || (r > 15 && r < 19 && c > 1 && c < 5)
          : v;
        return <span key={i} className={on ? "on" : ""} />;
      })}
    </div>
  );
}
