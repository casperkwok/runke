"use client";

import { useState } from "react";

import { Svg, type IcProps } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { useVoices, type Voice } from "@/lib/rk/voices";

const IcWave = (p: IcProps) => (
  <Svg {...p}>
    <path d="M4 12h2M9 7v10M14 4v16M19 9v6" />
  </Svg>
);

type Filter = "all" | "system" | "cloned" | "女" | "男";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "system", label: "系统音色" },
  { key: "cloned", label: "克隆音色" },
  { key: "女", label: "女声" },
  { key: "男", label: "男声" },
];

export function VoiceCard({
  v,
  active,
  onClick,
}: {
  v: Voice;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={"voice-card" + (active ? " on" : "")}
      onClick={onClick}
    >
      <span className={"voice-av " + (v.gender === "男" ? "male" : "female")}>
        <IcWave s={20} />
      </span>
      <span className="voice-main">
        <b className="voice-name">
          {v.name}
          {v.cloned && <em className="voice-badge clone">克隆</em>}
          {v.system && <em className="voice-badge sys">系统</em>}
        </b>
        <i className="voice-lang">{v.gender} · {v.lang}</i>
        <span className="voice-tags">
          {((v.tags ?? []) as string[]).map((t) => (
            <em key={t} className="voice-tag">{t}</em>
          ))}
        </span>
        {v.scene && <i className="voice-scene">{v.scene}</i>}
      </span>
    </button>
  );
}

/* 选音色弹窗：value=当前音色 id，onConfirm 回传选中 id */
export function VoicePicker({
  value,
  onClose,
  onConfirm,
}: {
  value?: string | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  const { data: voices } = useVoices();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(value ?? null);

  const list = (voices ?? []).filter((v) => {
    if (filter === "system" && !v.system) return false;
    if (filter === "cloned" && !v.cloned) return false;
    if ((filter === "女" || filter === "男") && v.gender !== filter) return false;
    if (q && !v.name.includes(q) && !v.lang.includes(q)) return false;
    return true;
  });

  return (
    <RkModal
      title="选择音色"
      w={620}
      onClose={onClose}
      footer={
        <>
          <button className="btn-outline" onClick={onClose}>取消</button>
          <button
            className="btn-create"
            disabled={!sel}
            onClick={() => { if (sel) { onConfirm(sel); onClose(); } }}
          >
            确认选择
          </button>
        </>
      }
    >
      <div className="voice-pick-bar">
        <div className="voice-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={"vf-chip" + (filter === f.key ? " on" : "")}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          className="voice-search"
          placeholder="搜索音色"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="voice-grid">
        {list.map((v) => (
          <VoiceCard key={v.id} v={v} active={sel === v.id} onClick={() => setSel(v.id)} />
        ))}
        {list.length === 0 && <div className="bound-empty">没有匹配的音色</div>}
      </div>
    </RkModal>
  );
}
