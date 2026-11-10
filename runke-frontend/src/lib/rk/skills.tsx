"use client";

/* 共享技能数据 + 选择器（接真实后端 /skills）。技能库与绑定共用。 */
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { IcCheck, IcClose, Svg, type IcProps } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type Skill = components["schemas"]["SkillOut"];
export type SkType = "tool" | "sop" | "builtin" | "bitable";

export const SkIcTool = (p: IcProps) => <Svg {...p}><path d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.3l-5 5a1.7 1.7 0 0 0 2.4 2.4l5-5a3.5 3.5 0 0 0 4.3-4.6l-2.1 2.1-1.8-.3-.3-1.8 2.1-2.1Z" /></Svg>;
export const SkIcSop = (p: IcProps) => <Svg {...p}><path d="M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="M13 4v4h4" /><path d="M9 13l1.5 1.5L13 12" /><path d="M9 17h6" /></Svg>;
export const SkIcBuiltin = (p: IcProps) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m9 12 2 2 4-4" /></Svg>;
export const SkIcBitable = (p: IcProps) => <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9.5h16M4 14.5h16M9.5 4v16" /></Svg>;
const SkIcSearch = (p: IcProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></Svg>;

export const SK_TYPES: Record<SkType, { label: string; color: string; soft: string; Icon: (p: IcProps) => ReactNode }> = {
  tool: { label: "工具", color: "#3B5BFF", soft: "#ECEFFF", Icon: SkIcTool },
  sop: { label: "SOP 技能", color: "#7A2BF5", soft: "#F0E9FE", Icon: SkIcSop },
  builtin: { label: "内置技能", color: "#1FA85A", soft: "#E5F6EC", Icon: SkIcBuiltin },
  bitable: { label: "飞书多维表格", color: "#00A6A6", soft: "#E1F5F5", Icon: SkIcBitable },
};

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/skills");
      if (error) throw error;
      return data.data as Skill[];
    },
  });
}

export const skillMeta = (s: Skill) =>
  s.skill_type === "builtin" ? "内置动作"
    : s.skill_type === "bitable" ? "飞书多维表格回写"
    : s.skill_type === "tool" ? `${(s.inputs || []).length} 入参`
    : `${(s.steps || []).length} 步 SOP`;

/* 已绑定技能行 */
export function BoundSkillRow({ skill, onRemove }: { skill: Skill; onRemove: () => void }) {
  const t = SK_TYPES[skill.skill_type as SkType] ?? SK_TYPES.tool;
  return (
    <div className="bound-skill">
      <span className="sk-ic" style={{ background: t.soft, width: 34, height: 34, borderRadius: 9 }}><t.Icon s={17} style={{ color: t.color }} /></span>
      <span className="bound-text"><b>{skill.name}</b><i>{skillMeta(skill)}</i></span>
      <span className="skp-tag" style={{ color: t.color, background: t.soft }}>{t.label}</span>
      <button className="df-ic" onClick={onRemove}><IcClose s={16} style={{ color: "var(--ink-3)" }} /></button>
    </div>
  );
}

/* 从技能库选择技能（真实列表） */
export function SkillPicker({ bound, onClose, onConfirm }: { bound: string[]; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(bound);
  const [q, setQ] = useState("");
  const { data: skills } = useSkills();
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const list = (skills || []).filter((s) => !q || s.name.includes(q) || s.description.includes(q));
  return (
    <RkModal title="添加技能" w={560} onClose={onClose}
      footer={<><button className="btn-text" onClick={onClose}>取消</button><button className="btn-primary" onClick={() => onConfirm(sel)}>确定（{sel.length}）</button></>}>
      <div className="kb-search" style={{ width: "100%", marginBottom: 14 }}>
        <SkIcSearch s={17} style={{ color: "var(--ink-3)" }} /><input placeholder="搜索技能库" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="skp-list">
        {list.length === 0 && <p className="muted" style={{ fontSize: 13 }}>技能库还没有技能，去「技能库」创建。</p>}
        {list.map((s) => {
          const t = SK_TYPES[s.skill_type as SkType] ?? SK_TYPES.tool;
          const on = sel.includes(s.id);
          return (
            <button key={s.id} className={"skp-item" + (on ? " on" : "")} onClick={() => toggle(s.id)}>
              <span className="sk-ic" style={{ background: t.soft, width: 38, height: 38 }}><t.Icon s={19} style={{ color: t.color }} /></span>
              <span className="skp-text"><b>{s.name}</b><i>{s.description || skillMeta(s)}</i></span>
              <span className="skp-tag" style={{ color: t.color, background: t.soft }}>{t.label}</span>
              <span className={"skp-check" + (on ? " on" : "")}>{on && <IcCheck s={14} sw={2.4} style={{ color: "#fff" }} />}</span>
            </button>
          );
        })}
      </div>
    </RkModal>
  );
}
