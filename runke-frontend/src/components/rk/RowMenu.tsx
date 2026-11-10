"use client";

/* 行操作菜单（移植自 Runke产品原型/knowledge.jsx RowMenu）。
   菜单用 portal 渲染到 body 并 fixed 定位，避免被表格 overflow:hidden 裁切。 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { IcMore, type IcProps } from "@/components/icons/rk";

export interface RowMenuItem {
  label: string;
  icon: (p: IcProps) => React.ReactElement;
  danger?: boolean;
  onClick: () => void;
}

export function RowMenu({ items }: { items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", h);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", h);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen((o) => !o);
  };

  return (
    <span className="rowmenu">
      <button ref={btnRef} className="icon-btn" onClick={toggle}>
        <IcMore s={18} style={{ color: "var(--ink-3)" }} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="menu-pop pop-in"
            style={{ position: "fixed", top: pos.top, right: pos.right, minWidth: 110, zIndex: 1000 }}
          >
            {items.map((it, i) => (
              <button
                key={i}
                className={"menu-item" + (it.danger ? " danger" : "")}
                onClick={() => {
                  it.onClick();
                  setOpen(false);
                }}
              >
                <it.icon s={16} style={it.danger ? {} : { color: "var(--ink-2)" }} /> {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
