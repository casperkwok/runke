"use client";

import { useEffect, useRef, useState } from "react";

import { IcCheck, IcChevDown } from "@/components/icons/rk";

export type SelectOption = { value: string; label?: string };

/** 自定义下拉选择（替代原生 <select>）。样式复用全局 .select-box / .sb-menu。 */
export function SelectBox({
  value,
  onChange,
  options,
  ph,
  small,
  block,
  optionLabels,
}: {
  value: string;
  onChange?: (v: string) => void;
  options?: SelectOption[] | string[];
  ph?: string;
  small?: boolean;
  block?: boolean;
  optionLabels?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opts = (options || []).map((o) => (typeof o === "string" ? { value: o, label: undefined } : o));
  const lbl = (v: string) => (optionLabels && optionLabels[v]) || opts.find((o) => o.value === v)?.label || v;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (!onChange)
    return (
      <div className={"select-box" + (small ? " sm" : "") + (block ? " block" : "")}>
        <span className={value ? "" : "ph"}>{value ? lbl(value) : ph}</span>
        <IcChevDown s={16} style={{ color: "var(--ink-3)" }} />
      </div>
    );
  return (
    <div ref={ref} className={"select-box ui" + (small ? " sm" : "") + (block ? " block" : "") + (open ? " open" : "")} onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen((o) => !o)}>
      <span className={value ? "" : "ph"}>{value ? lbl(value) : ph || "请选择"}</span>
      <IcChevDown s={16} style={{ color: "var(--ink-3)", transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }} />
      {open && (
        <div className="sb-menu" onWheel={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {opts.length === 0 && <div className="sb-empty">无可选项</div>}
          {opts.map((o) => (
            <button type="button" key={o.value} className={"sb-opt" + (o.value === value ? " on" : "")} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{lbl(o.value)}</span>
              {o.value === value && <IcCheck s={15} sw={2.2} style={{ color: "var(--primary)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
