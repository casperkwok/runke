"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  IcCopy,
  IcEditMenu,
  IcMore,
  IcPlus,
  IcTrash,
  SIcFlow,
  SIcHeadset,
  SIcRobot,
} from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { api } from "@/lib/api/client";
import { botAvatar } from "@/lib/rk/avatar";
import type { components } from "@/lib/api/schema";

type BotOut = components["schemas"]["BotOut"];
type Orch = "single" | "workflow";

export default function BotsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);

  const { data: bots, isLoading } = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/bots");
      if (error) throw error;
      return data.data;
    },
  });

  const create = useMutation({
    mutationFn: async (body: { name: string; description: string; orchestration_type: Orch }) => {
      const { data, error } = await api.POST("/api/v1/bots", { body });
      if (error) throw error;
      return data.data;
    },
    onSuccess: (bot) => {
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["bots"] });
      router.push(`/studio/${bot.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/v1/bots/{bot_id}", { params: { path: { bot_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });

  const duplicate = useMutation({
    mutationFn: async (b: BotOut) => {
      const { data, error } = await api.POST("/api/v1/bots", {
        body: {
          name: `${b.name} 副本`,
          description: b.description,
          bot_role: b.bot_role,
          welcome: b.welcome,
          orchestration_type: b.orchestration_type as Orch,
          system_prompt: b.system_prompt,
          knowledge_base_id: b.knowledge_base_id,
        },
      });
      if (error) throw error;
      return data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });

  const empty = !isLoading && (bots?.length ?? 0) === 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>智能助手</h1>
        <button className="btn-create" onClick={() => setShowCreate(true)}>
          <IcPlus s={17} sw={2.2} style={{ color: "#fff" }} /> 创建智能助手
        </button>
      </div>

      {isLoading ? null : empty ? (
        <div className="empty-state fade-in">
          <div className="empty-illus">
            <SIcHeadset s={64} style={{ color: "#C3CBDC" }} />
          </div>
          <h3>创建智能助手或客服</h3>
          <p>轻松创建，高效转化</p>
          <button className="btn-ghost lg" onClick={() => setShowCreate(true)}>
            创建智能助手
          </button>
        </div>
      ) : (
        <div className="cards-grid fade-in">
          {bots?.map((bot) => (
            <AssistantCard
              key={bot.id}
              bot={bot}
              src={botAvatar(bot)}
              onEdit={() => router.push(`/studio/${bot.id}`)}
              onDup={() => duplicate.mutate(bot)}
              onDelete={() => remove.mutate(bot.id)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateAssistantModal
          onClose={() => setShowCreate(false)}
          onCreate={(v) =>
            create.mutate({ name: v.name, description: v.desc, orchestration_type: v.type })
          }
        />
      )}
    </div>
  );
}

function AssistantCard({
  bot,
  src,
  onEdit,
  onDup,
  onDelete,
}: {
  bot: BotOut;
  src: string;
  onEdit: () => void;
  onDup: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menu]);

  return (
    <div className="a-card" onClick={onEdit}>
      <div className="a-card-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" />
        <div className="a-card-id">
          <div className="a-name">{bot.name}</div>
          <div className="a-role">
            {bot.bot_role || (bot.orchestration_type === "workflow" ? "工作流" : "单 Agent")}
          </div>
        </div>
        <span className="a-menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" onClick={() => setMenu((m) => !m)}>
            <IcMore s={20} style={{ color: "var(--ink-3)" }} />
          </button>
          {menu && (
            <div className="menu-pop pop-in" style={{ right: 0, top: 30, minWidth: 138 }}>
              <button className="menu-item" onClick={() => { setMenu(false); onEdit(); }}>
                <IcEditMenu s={16} style={{ color: "var(--ink-2)" }} /> 编辑
              </button>
              <button className="menu-item" onClick={() => { setMenu(false); onDup(); }}>
                <IcCopy s={16} style={{ color: "var(--ink-2)" }} /> 复制
              </button>
              <div className="menu-div" />
              <button className="menu-item danger" onClick={() => { setMenu(false); onDelete(); }}>
                <IcTrash s={16} /> 删除
              </button>
            </div>
          )}
        </span>
      </div>
      <div className="a-desc">
        {bot.description || "新建的智能助手，进入编辑完善它的人设、知识库与技能。"}
      </div>
    </div>
  );
}

function CreateAssistantModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (v: { name: string; desc: string; type: Orch }) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [type, setType] = useState<Orch>("single");
  return (
    <RkModal
      title="创建智能助手"
      w={620}
      onClose={onClose}
      footer={
        <>
          <button className="btn-text" onClick={onClose}>取消</button>
          <button
            className={"btn-primary" + (name.trim() ? "" : " dis")}
            disabled={!name.trim()}
            onClick={() => onCreate({ name: name.trim(), desc, type })}
          >
            创建
          </button>
        </>
      }
    >
      <div className="fld-lbl">
        助手名称 <span className="req">*</span>
      </div>
      <input
        className="fld"
        autoFocus
        placeholder="请输入助手的名字"
        value={name}
        maxLength={20}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="fld-lbl">简介</div>
      <textarea
        className="fld ta"
        placeholder="简单介绍下助手的用途（非必填）"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
      />
      <div className="fld-lbl">
        编排类型 <span className="req">*</span>
      </div>
      <div className="orch-cards">
        <button className={"orch-card" + (type === "single" ? " on" : "")} onClick={() => setType("single")}>
          <div className="orch-top">
            <SIcRobot s={22} style={{ color: "var(--primary)" }} />
            <b>单 Agent</b>
          </div>
          <div className="orch-sub">模型 + 工具，自主对话</div>
        </button>
        <button className={"orch-card" + (type === "workflow" ? " on" : "")} onClick={() => setType("workflow")}>
          <div className="orch-top">
            <SIcFlow s={22} style={{ color: "var(--primary)" }} />
            <b>工作流</b>
          </div>
          <div className="orch-sub">可视化节点编排流程</div>
        </button>
      </div>
    </RkModal>
  );
}
