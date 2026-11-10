"use client";

/* 音色库（接真实后端 /voices）。系统音色平台预置不可删，可克隆专属音色，被「编排·语音/预览/外呼」引用。 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { IcPlus, IcTrash, Svg, type IcProps } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { SelectBox } from "@/components/rk/Select";
import { api } from "@/lib/api/client";
import { playVoiceSample, useVoices } from "@/lib/rk/voices";
import { useToast } from "@/components/ui/use-toast";

const IcWave = (p: IcProps) => <Svg {...p}><path d="M4 12h2M9 7v10M14 4v16M19 9v6" /></Svg>;
const IcSearch = (p: IcProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></Svg>;
const IcPlay = (p: IcProps) => <Svg {...p}><path d="M7 5l11 7-11 7V5Z" /></Svg>;
const IcStop = (p: IcProps) => <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>;
const IcSpin = (p: IcProps) => <Svg {...p} className="spin"><path d="M12 3a9 9 0 1 0 9 9" /></Svg>;

function PlayBtn({ voiceId }: { voiceId: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const play = async () => {
    if (state === "playing") { audioRef.current?.pause(); setState("idle"); return; }
    setState("loading");
    try {
      const a = await playVoiceSample(voiceId);
      audioRef.current = a;
      setState("playing");
      a.addEventListener("ended", () => setState("idle"), { once: true });
      a.addEventListener("pause", () => setState("idle"), { once: true });
    } catch (e) {
      setState("idle");
      toast({ title: "试听失败", description: e instanceof Error ? e.message : "请确认后端已配置火山 TTS 密钥" });
    }
  };
  return (
    <button className="icon-btn" title="试听" onClick={play}>
      {state === "loading" ? <IcSpin s={16} style={{ color: "var(--primary)" }} />
        : state === "playing" ? <IcStop s={15} style={{ color: "var(--primary)" }} />
        : <IcPlay s={16} style={{ color: "var(--primary)" }} />}
    </button>
  );
}

type Filter = "all" | "system" | "cloned" | "女" | "男";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "system", label: "系统音色" },
  { key: "cloned", label: "克隆音色" },
  { key: "女", label: "女声" },
  { key: "男", label: "男声" },
];

type CloneForm = {
  name: string; gender: string; lang: string; scene: string; sample: string; provider_voice: string; provider_resource: string; tags: string;
};
const EMPTY: CloneForm = { name: "", gender: "女", lang: "中文 · 普通话", scene: "", sample: "", provider_voice: "", provider_resource: "volc.megatts.default", tags: "" };

export default function VoicesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: voices } = useVoices();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [clone, setClone] = useState(false);
  const [form, setForm] = useState<CloneForm>(EMPTY);

  const all = voices ?? [];
  const counts = {
    all: all.length,
    system: all.filter((v) => v.system).length,
    cloned: all.filter((v) => v.cloned).length,
  };
  const list = all.filter((v) => {
    if (filter === "system" && !v.system) return false;
    if (filter === "cloned" && !v.cloned) return false;
    if ((filter === "女" || filter === "男") && v.gender !== filter) return false;
    if (q && !v.name.includes(q) && !v.lang.includes(q)) return false;
    return true;
  });

  const create = useMutation({
    mutationFn: async (f: CloneForm) => {
      const { error } = await api.POST("/api/v1/voices", {
        body: {
          name: f.name,
          gender: f.gender,
          lang: f.lang,
          scene: f.scene,
          sample: f.sample,
          provider_voice: f.provider_voice,
          provider_resource: f.provider_resource,
          tags: f.tags.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
          cloned: true,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => { setClone(false); setForm(EMPTY); qc.invalidateQueries({ queryKey: ["voices"] }); toast({ title: "已创建克隆音色" }); },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/v1/voices/{voice_id}", { params: { path: { voice_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["voices"] }); },
  });

  return (
    <div className="page voice-page">
      <div className="page-head">
        <h1>音色库</h1>
        <div className="row" style={{ gap: 14 }}>
          <div className="kb-search"><IcSearch s={17} style={{ color: "var(--ink-3)" }} /><input placeholder="搜索音色" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn-create" onClick={() => setClone(true)}><IcPlus s={17} sw={2.2} style={{ color: "#fff" }} /> 克隆音色</button>
        </div>
      </div>

      <div className="voice-filters" style={{ marginBottom: 18 }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={"vf-chip" + (filter === f.key ? " on" : "")} onClick={() => setFilter(f.key)}>
            {f.label}
            {(f.key === "all" || f.key === "system" || f.key === "cloned") && (
              <em className="vf-count">{counts[f.key as "all" | "system" | "cloned"]}</em>
            )}
          </button>
        ))}
      </div>

      <div className="voice-page-grid">
        {list.map((v) => (
          <div key={v.id} className="voice-card lg">
            <span className={"voice-av " + (v.gender === "男" ? "male" : "female")}><IcWave s={22} /></span>
            <div className="voice-main">
              <b className="voice-name">
                {v.name}
                {v.cloned && <em className="voice-badge clone">克隆</em>}
                {v.system && <em className="voice-badge sys">系统</em>}
              </b>
              <i className="voice-lang">{v.gender} · {v.lang}</i>
              <span className="voice-tags">{((v.tags ?? []) as string[]).map((t) => <em key={t} className="voice-tag">{t}</em>)}</span>
              {v.scene && <i className="voice-scene">{v.scene}</i>}
              {v.sample && <p className="voice-sample">“{v.sample}”</p>}
            </div>
            <div className="voice-card-acts">
              <PlayBtn voiceId={v.id} />
              {!v.system && (
                <button className="icon-btn" title="删除" onClick={() => del.mutate(v.id)}>
                  <IcTrash s={16} style={{ color: "var(--danger, #e5484d)" }} />
                </button>
              )}
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="bound-empty">没有匹配的音色</div>}
      </div>

      {clone && (
        <RkModal
          title="克隆音色"
          w={520}
          onClose={() => setClone(false)}
          footer={
            <>
              <button className="btn-outline" onClick={() => setClone(false)}>取消</button>
              <button className="btn-create" disabled={!form.name || create.isPending} onClick={() => create.mutate(form)}>创建</button>
            </>
          }
        >
          <div className="vform">
            <label className="vfld"><span>名称</span><input value={form.name} placeholder="如：李总 · 克隆音" onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <div className="row" style={{ gap: 12 }}>
              <label className="vfld" style={{ flex: 1 }}><span>性别</span>
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option>女</option><option>男</option></select>
              </label>
              <label className="vfld" style={{ flex: 2 }}><span>语言</span><input value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value })} /></label>
            </div>
            <label className="vfld"><span>适用场景</span><input value={form.scene} placeholder="如：销售 / 商务沟通" onChange={(e) => setForm({ ...form, scene: e.target.value })} /></label>
            <label className="vfld"><span>标签（逗号分隔）</span><input value={form.tags} placeholder="沉稳, 专业" onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
            <label className="vfld"><span>火山 voice key（provider_voice）</span><input value={form.provider_voice} placeholder="S_xxx 或 zh_xxx_bigtts" onChange={(e) => setForm({ ...form, provider_voice: e.target.value })} /></label>
            <label className="vfld"><span>火山 resource_id</span>
              <SelectBox value={form.provider_resource} onChange={(v) => setForm({ ...form, provider_resource: v })}
                options={[{ value: "volc.megatts.default", label: "声音复刻（S_ 克隆音）· volc.megatts.default" }, { value: "seed-tts-2.0", label: "大模型音色 · seed-tts-2.0" }]} />
            </label>
            <label className="vfld"><span>试听文案</span><textarea rows={2} value={form.sample} onChange={(e) => setForm({ ...form, sample: e.target.value })} /></label>
          </div>
        </RkModal>
      )}
    </div>
  );
}
