"use client";

import type { ReactNode } from "react";

import { IcClose } from "@/components/icons/rk";

/* 原型 Modal（.modal-overlay + .kmodal），见 Runke产品原型/knowledge-modals.jsx */
export function RkModal({
  title,
  icon,
  w = 540,
  onClose,
  children,
  footer,
}: {
  title: string;
  icon?: ReactNode;
  w?: number;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="kmodal pop-in" style={{ width: w }} onClick={(e) => e.stopPropagation()}>
        <div className="kmodal-head">
          <span className="row" style={{ gap: 10 }}>
            {icon}
            <h3>{title}</h3>
          </span>
          <button className="icon-btn" onClick={onClose}>
            <IcClose s={20} style={{ color: "var(--ink-3)" }} />
          </button>
        </div>
        <div className="kmodal-body">{children}</div>
        {footer && <div className="kmodal-foot">{footer}</div>}
      </div>
    </div>
  );
}
