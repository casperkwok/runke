"use client";

/* 语音外呼（接真实后端 /call-tasks + /call-records）。
   外呼任务：绑定语音智能体 + 资源包，管理状态/进度。
   通话记录：每通语音通话(预览/外呼)结束自动生成，转写=会话消息。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { IcClose, IcPlus, IcTrash, Svg, type IcProps } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { SelectBox } from "@/components/rk/Select";
import { api } from "@/lib/api/client";
import { useVoices } from "@/lib/rk/voices";
import { useToast } from "@/components/ui/use-toast";
import type { components } from "@/lib/api/schema";

type Task = components["schemas"]["CallTaskOut"];
type Rec = components["schemas"]["CallRecordOut"];
type RecDetail = components["schemas"]["CallRecordDetail"];

const IcPlay = (p: IcProps) => <Svg {...p}><path d="M7 5l11 7-11 7V5Z" /></Svg>;
const IcPause = (p: IcProps) => <Svg {...p}><rect x="7" y="5" width="3.5" height="14" rx="1" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" /></Svg>;

const TASK_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "st-draft" },
  running: { label: "进行中", cls: "st-run" },
  paused: { label: "已暂停", cls: "st-pause" },
  done: { label: "已完成", cls: "st-done" },
  canceled: { label: "已取消", cls: "st-cancel" },
};
const REC_STATUS: Record<string, string> = { completed: "已完成", no_answer: "未接通", failed: "失败" };
const DIRECTION: Record<string, string> = { outbound: "外呼", inbound: "呼入", preview: "预览" };

function fmtDur(s: number): string {
  const m = Math.floor(s / 60), ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

export default function OutboundPage() {
  const [tab, setTab] = useState<"tasks" | "records">("tasks");
  return (
    <div className="page">
      <div className="page-head">
        <h1>语音外呼</h1>
        <div className="seg" style={{ width: 220 }}>
          <button className={"seg-btn" + (tab === "tasks" ? " on" : "")} onClick={() => setTab("tasks")}>外呼任务</button>
          <button className={"seg-btn" + (tab === "records" ? " on" : "")} onClick={() => setTab("records")}>通话记录</button>
        </div>
      </div>
      {tab === "tasks" ? <TasksTab /> : <RecordsTab />}
    </div>
  );
}

function TasksTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [create, setCreate] = useState(false);
  const { data: tasks = [] } = useQuery({
    queryKey: ["call-tasks"],
    queryFn: async () => { const { data, error } = await api.GET("/api/v1/call-tasks"); if (error) throw error; return data.data as Task[]; },
  });

  const patch = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await api.PATCH("/api/v1/call-tasks/{task_id}", { params: { path: { task_id: id } }, body: { status } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["call-tasks"] }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await api.DELETE("/api/v1/call-tasks/{task_id}", { params: { path: { task_id: id } } }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["call-tasks"] }),
  });

  return (
    <>
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="btn-create" onClick={() => setCreate(true)}><IcPlus s={17} sw={2.2} style={{ color: "#fff" }} /> 新建任务</button>
      </div>
      <div className="rk-table">
        <div className="rk-tr rk-th">
          <span style={{ flex: 2 }}>任务名称</span><span style={{ flex: 1.4 }}>智能体</span><span style={{ flex: 1.4 }}>资源包</span>
          <span style={{ flex: 1 }}>音色</span><span style={{ flex: 1 }}>状态</span><span style={{ flex: 1.2 }}>进度</span><span style={{ width: 120 }}>操作</span>
        </div>
        {tasks.map((t) => {
          const st = TASK_STATUS[t.status] ?? TASK_STATUS.draft;
          return (
            <div className="rk-tr" key={t.id}>
              <span style={{ flex: 2, fontWeight: 600 }}>{t.name}</span>
              <span style={{ flex: 1.4 }}>{t.bot_name || "—"}</span>
              <span style={{ flex: 1.4 }}>{t.pack_name || "—"}</span>
              <span style={{ flex: 1 }}>{t.voice_name || "默认"}</span>
              <span style={{ flex: 1 }}><em className={"task-pill " + st.cls}>{st.label}</em></span>
              <span style={{ flex: 1.2 }}>{t.done}/{t.total} 接通{t.connected}</span>
              <span className="row" style={{ width: 120, gap: 8 }}>
                {(t.status === "draft" || t.status === "paused") && (
                  <button className="icon-btn" title="启动" onClick={() => patch.mutate({ id: t.id, status: "running" })}><IcPlay s={16} style={{ color: "#16a34a" }} /></button>
                )}
                {t.status === "running" && (
                  <button className="icon-btn" title="暂停" onClick={() => patch.mutate({ id: t.id, status: "paused" })}><IcPause s={16} style={{ color: "#E8862E" }} /></button>
                )}
                <button className="icon-btn" title="删除" onClick={() => { if (confirm("删除该任务？")) del.mutate(t.id); }}><IcTrash s={16} style={{ color: "#e5484d" }} /></button>
              </span>
            </div>
          );
        })}
        {tasks.length === 0 && <div className="bound-empty" style={{ padding: 40 }}>还没有外呼任务，点击「新建任务」创建</div>}
      </div>
      {create && <CreateTaskModal onClose={() => setCreate(false)} onDone={() => { setCreate(false); qc.invalidateQueries({ queryKey: ["call-tasks"] }); toast({ title: "已创建外呼任务" }); }} />}
    </>
  );
}

function CreateTaskModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: bots = [] } = useQuery({ queryKey: ["bots"], queryFn: async () => { const { data, error } = await api.GET("/api/v1/bots"); if (error) throw error; return data.data; } });
  const { data: packs = [] } = useQuery({ queryKey: ["customer-packs"], queryFn: async () => { const { data, error } = await api.GET("/api/v1/customers/packs"); if (error) throw error; return data.data as unknown as { id: string; name: string }[]; } });
  const { data: voices = [] } = useVoices();
  const [name, setName] = useState("");
  const [botId, setBotId] = useState("");
  const [packId, setPackId] = useState("");
  const [voiceId, setVoiceId] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/api/v1/call-tasks", { body: { name, bot_id: botId, pack_id: packId || null, voice_id: voiceId || null } });
      if (error) throw error;
    },
    onSuccess: onDone,
  });

  return (
    <RkModal title="新建外呼任务" w={520} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>取消</button>
        <button className="btn-create" disabled={!name || !botId || create.isPending} onClick={() => create.mutate()}>创建</button></>}>
      <div className="vform">
        <label className="vfld"><span>任务名称</span><input value={name} placeholder="如：暑期招聘主动投递回访" onChange={(e) => setName(e.target.value)} /></label>
        <label className="vfld"><span>语音智能体</span>
          <SelectBox value={botId} onChange={setBotId} ph="选择智能体"
            options={bots.map((b) => ({ value: b.id, label: b.name }))} />
        </label>
        <label className="vfld"><span>目标资源包</span>
          <SelectBox value={packId} onChange={setPackId} ph="选择资源包（可空）"
            options={[{ value: "", label: "不指定" }, ...packs.map((p) => ({ value: p.id, label: p.name }))]} />
        </label>
        <label className="vfld"><span>音色</span>
          <SelectBox value={voiceId} onChange={setVoiceId} ph="跟随智能体默认音色"
            options={[{ value: "", label: "跟随智能体默认" }, ...voices.map((v) => ({ value: v.id, label: v.name }))]} />
        </label>
      </div>
    </RkModal>
  );
}

function RecordsTab() {
  const [sel, setSel] = useState<string | null>(null);
  const { data: recs = [] } = useQuery({
    queryKey: ["call-records"],
    queryFn: async () => { const { data, error } = await api.GET("/api/v1/call-records"); if (error) throw error; return data.data as Rec[]; },
  });
  return (
    <>
      <div className="rk-table">
        <div className="rk-tr rk-th">
          <span style={{ flex: 1.4 }}>智能体</span><span style={{ flex: 1.2 }}>联系人</span><span style={{ flex: 0.8 }}>方向</span>
          <span style={{ flex: 0.8 }}>时长</span><span style={{ flex: 1.2 }}>意向</span><span style={{ flex: 0.9 }}>状态</span><span style={{ flex: 1.4 }}>时间</span>
        </div>
        {recs.map((r) => (
          <div className="rk-tr clickable" key={r.id} onClick={() => setSel(r.id)}>
            <span style={{ flex: 1.4, fontWeight: 600 }}>{r.bot_name || "—"}</span>
            <span style={{ flex: 1.2 }}>{r.contact || r.phone || "—"}</span>
            <span style={{ flex: 0.8 }}>{DIRECTION[r.direction] ?? r.direction}</span>
            <span style={{ flex: 0.8 }}>{fmtDur(r.duration_sec)}</span>
            <span style={{ flex: 1.2 }}>{r.intent || "—"}</span>
            <span style={{ flex: 0.9 }}>{REC_STATUS[r.status] ?? r.status}</span>
            <span style={{ flex: 1.4, color: "var(--ink-3)", fontSize: 13 }}>{new Date(r.created_at).toLocaleString("zh-CN")}</span>
          </div>
        ))}
        {recs.length === 0 && <div className="bound-empty" style={{ padding: 40 }}>还没有通话记录。在智能助手预览里拨打语音、或外呼接通后会自动生成。</div>}
      </div>
      {sel && <RecordDrawer id={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function RecordDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["call-record", id],
    queryFn: async () => { const { data, error } = await api.GET("/api/v1/call-records/{rec_id}", { params: { path: { rec_id: id } } }); if (error) throw error; return data.data as RecDetail; },
  });
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer pop-in-right" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>通话详情</h3>
          <button className="icon-btn" onClick={onClose}><IcClose s={20} style={{ color: "var(--ink-3)" }} /></button>
        </div>
        <div className="drawer-body">
          {data && (
            <>
              <div className="rec-meta">
                <div><i>智能体</i><b>{data.bot_name || "—"}</b></div>
                <div><i>联系人</i><b>{data.contact || data.phone || "—"}</b></div>
                <div><i>方向</i><b>{DIRECTION[data.direction] ?? data.direction}</b></div>
                <div><i>时长</i><b>{fmtDur(data.duration_sec)}</b></div>
                <div><i>意向</i><b>{data.intent || "—"}</b></div>
                <div><i>状态</i><b>{REC_STATUS[data.status] ?? data.status}</b></div>
              </div>
              {data.summary && <div className="rec-summary"><div className="rec-cap">通话纪要</div><p>{data.summary}</p></div>}
              <div className="rec-cap">通话转写</div>
              <div className="rec-transcript">
                {(data.transcript ?? []).length === 0 && <div className="bound-empty">无转写内容</div>}
                {(data.transcript ?? []).map((t, i) => (
                  <div key={i} className={"sa-msg " + (t.who === "me" ? "me" : "bot")}>
                    <div className={"sa-bubble " + (t.who === "me" ? "me" : "bot")}>{t.text}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
