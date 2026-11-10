"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  BrandMark,
  IcAssistant,
  IcBack,
  IcChat,
  IcChevUp,
  IcCustomers,
  IcExperience,
  IcKnowledge,
  IcMarketing,
  IcOrg,
  IcPalette,
  IcPhone,
  IcSkillNav,
  IcWorkbench,
  type IcProps,
} from "@/components/icons/rk";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/store/auth";

type NavItem = {
  key: string;
  href: string;
  label: string;
  Icon: (p: IcProps) => React.ReactElement;
  soon?: boolean;
};

const NAV: NavItem[] = [
  { key: "experience", href: "/experience", label: "体验间", Icon: IcExperience },
  { key: "workbench", href: "/workspace", label: "工作台", Icon: IcWorkbench },
  { key: "chat", href: "/chats", label: "聊天管家", Icon: IcChat },
  { key: "assistant", href: "/bots", label: "智能助手", Icon: IcAssistant },
  { key: "knowledge", href: "/knowledge", label: "知识库", Icon: IcKnowledge },
  { key: "skills", href: "/skills", label: "技能库", Icon: IcSkillNav },
  { key: "voices", href: "/voices", label: "音色库", Icon: IcPalette },
  { key: "marketing", href: "/marketing", label: "营销触达", Icon: IcMarketing },
  { key: "outbound", href: "/outbound", label: "语音外呼", Icon: IcPhone },
  { key: "customers", href: "/customers", label: "客户管理", Icon: IcCustomers },
  { key: "org", href: "/org", label: "组织架构", Icon: IcOrg },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuth((s) => s.token);
  const clear = useAuth((s) => s.clear);
  const [mounted, setMounted] = useState(false);

  // 客户端挂载后再判断登录态：persist 已从 localStorage 同步恢复，避免刷新被弹回登录
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !token) router.replace("/login");
  }, [mounted, token, router]);

  const ready = mounted && !!token;

  const { data: me } = useQuery({
    queryKey: ["me"],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/auth/me");
      if (error) throw error;
      return data.data;
    },
  });

  if (!ready) return null;

  return (
    <div className="shell">
      <div className="sidebar">
        <div className="sb-brand">
          <Link href="/bots" className="brand clickable" aria-label="Runke">
            <span className="brand-mark bg-grad">
              <BrandMark s={30} />
            </span>
            <span className="brand-word">
              润客<span className="ai">RUNKE</span>
            </span>
          </Link>
        </div>

        <div className="sb-nav">
          {NAV.map((n) => (
            <div key={n.key}>
              {n.key === "workbench" && <div className="sb-divider" />}
              {n.soon ? (
                <button className="sb-item" style={{ opacity: 0.55, cursor: "not-allowed" }} title="即将上线">
                  <n.Icon s={20} /> {n.label}
                </button>
              ) : (
                <Link
                  href={n.href}
                  className={"sb-item" + (pathname.startsWith(n.href) ? " on" : "")}
                >
                  <n.Icon s={20} /> {n.label}
                </Link>
              )}
            </div>
          ))}
        </div>

        <SidebarUser
          name={me?.name || me?.email?.split("@")[0] || "用户"}
          email={me?.email ?? "我的账号"}
          onLogout={() => {
            clear();
            router.replace("/login");
          }}
        />
      </div>

      <div className="main">{children}</div>
    </div>
  );
}

function SidebarUser({
  name,
  email,
  onLogout,
}: {
  name: string;
  email: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const initial = name.slice(0, 1).toUpperCase();
  const avatar = (
    <span
      className="bg-grad"
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        color: "#fff",
        fontSize: 13,
        fontWeight: 700,
        flex: "none",
      }}
    >
      {initial}
    </span>
  );

  return (
    <div className="sb-user-wrap" ref={ref}>
      {open && (
        <div className="sb-user-menu pop-in">
          <div className="sb-user-head">
            {avatar}
            <div>
              <b>{name}</b>
              <i>{email}</i>
            </div>
          </div>
          <button className="sb-menu-item danger" onClick={onLogout}>
            <IcBack s={17} /> 退出登录
          </button>
        </div>
      )}
      <button className={"sb-user" + (open ? " on" : "")} onClick={() => setOpen((o) => !o)}>
        {avatar}
        <b>{name}</b>
        <IcChevUp
          s={16}
          style={{ color: "var(--ink-3)", transform: open ? "none" : "rotate(180deg)", transition: ".15s" }}
        />
      </button>
    </div>
  );
}
