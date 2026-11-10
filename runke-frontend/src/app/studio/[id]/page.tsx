"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { IcBack, IcPencil, IcSend } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { api } from "@/lib/api/client";
import { botAvatar } from "@/lib/rk/avatar";
import { useAuth } from "@/lib/store/auth";
import { DeployConfig } from "./DeployConfig";
import { GlobalConfig } from "./GlobalConfig";
import { SingleAgentEditor, type SingleAgentHandle } from "./SingleAgentEditor";
import { WorkflowExp, type WorkflowExpHandle } from "./WorkflowExp";

type Tab = "build" | "global" | "deploy";

export default function StudioPage() {
  const { id: botId } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const token = useAuth((s) => s.token);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("build");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const wfRef = useRef<WorkflowExpHandle>(null);
  const saRef = useRef<SingleAgentHandle>(null);
  const [editMeta, setEditMeta] = useState(false);

  const saveMeta = useMutation({
    mutationFn: async (body: { name: string; bot_role: string; description: string }) => {
      const { error } = await api.PATCH("/api/v1/bots/{bot_id}", { params: { path: { bot_id: botId } }, body });
      if (error) throw error;
    },
    onSuccess: () => { setEditMeta(false); qc.invalidateQueries({ queryKey: ["bot", botId] }); },
  });

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !token) router.replace("/login");
  }, [mounted, token, router]);

  const { data: bot } = useQuery({
    queryKey: ["bot", botId],
    enabled: !!token,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/bots/{bot_id}", {
        params: { path: { bot_id: botId } },
      });
      if (error) throw error;
      return data.data;
    },
  });

  const publishWorkflow = useMutation({
    mutationFn: async () => {
      await wfRef.current?.save();
      const { error } = await api.PATCH("/api/v1/bots/{bot_id}", {
        params: { path: { bot_id: botId } },
        body: { published: true },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot", botId] }),
  });

  if (!bot) return null;
  const isWorkflow = bot.orchestration_type === "workflow";
  const avatar = botAvatar(bot);

  const stamp = () =>
    setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));

  const handlePublish = async () => {
    if (isWorkflow) publishWorkflow.mutate();
    else {
      await saRef.current?.save();
      stamp();
      qc.invalidateQueries({ queryKey: ["bot", botId] });
    }
  };

  const TABS: [Tab, string][] = [
    ["build", isWorkflow ? "工作流" : "编排"],
    ["global", "全局配置"],
    ["deploy", "发布渠道"],
  ];

  return (
    <div className="editor-root">
      <div className="ed-topbar">
        <button className="ed-back" onClick={() => router.push("/bots")}>
          <IcBack s={20} />
        </button>
        <div className="ed-agent">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatar} alt="" />
          <div>
            <div className="ed-agent-name">
              <button className="ed-name-edit" onClick={() => setEditMeta(true)} title="编辑名称与描述">{bot.name} <IcPencil s={14} /></button>
              <span className="mode-tag">{isWorkflow ? "工作流模式" : "标准模式"}</span>
            </div>
            <div className="ed-agent-role">
              {savedAt ? `自动保存于 ${savedAt}` : bot.bot_role || "智能助手"}
              {!bot.published && <span className="pending-tag">待发布</span>}
            </div>
          </div>
        </div>
        <div className="ed-tabs">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              className={"ed-tab" + (tab === k ? " on" : "")}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn-publish" onClick={handlePublish}>
          <IcSend s={17} style={{ color: "#fff" }} /> 发 布
        </button>
      </div>

      <div className="ed-body">
        {tab === "global" ? (
          <GlobalConfig bot={bot} onSaved={stamp} />
        ) : tab === "deploy" ? (
          <DeployConfig bot={bot} onSaved={stamp} />
        ) : isWorkflow ? (
          <WorkflowExp ref={wfRef} bot={bot} />
        ) : (
          <SingleAgentEditor ref={saRef} bot={bot} onSaved={stamp} />
        )}
      </div>

      {editMeta && (
        <EditMetaModal
          name={bot.name}
          role={bot.bot_role ?? ""}
          description={bot.description ?? ""}
          busy={saveMeta.isPending}
          onClose={() => setEditMeta(false)}
          onSave={(name, bot_role, description) => saveMeta.mutate({ name, bot_role, description })}
        />
      )}
    </div>
  );
}

function EditMetaModal({ name: name0, role: role0, description: desc0, busy, onClose, onSave }: { name: string; role: string; description: string; busy: boolean; onClose: () => void; onSave: (name: string, role: string, description: string) => void }) {
  const [name, setName] = useState(name0);
  const [role, setRole] = useState(role0);
  const [desc, setDesc] = useState(desc0);
  return (
    <RkModal title="编辑助手信息" w={520} onClose={onClose}
      footer={<><button className="btn-text" onClick={onClose}>取消</button><button className={"btn-primary" + (name.trim() && !busy ? "" : " dis")} disabled={!name.trim() || busy} onClick={() => onSave(name.trim(), role.trim(), desc.trim())}>{busy ? "保存中…" : "保存"}</button></>}>
      <div className="fld-lbl">助手名称 <span className="req">*</span></div>
      <div className="fld-wrap"><input className="fld" maxLength={30} placeholder="请输入助手名称" value={name} onChange={(e) => setName(e.target.value)} /><span className="fld-count">{name.length}/30</span></div>
      <div className="fld-lbl" style={{ marginTop: 16 }}>角色 / 职位 <span className="muted" style={{ fontWeight: 400 }}>· 副标题</span></div>
      <div className="fld-wrap"><input className="fld" maxLength={30} placeholder="如：萌宠赵医生（选填）" value={role} onChange={(e) => setRole(e.target.value)} /><span className="fld-count">{role.length}/30</span></div>
      <div className="fld-lbl" style={{ marginTop: 16 }}>描述</div>
      <textarea className="np-textarea" style={{ minHeight: 80 }} maxLength={200} placeholder="一句话描述这个助手的用途（选填）" value={desc} onChange={(e) => setDesc(e.target.value)} />
    </RkModal>
  );
}
