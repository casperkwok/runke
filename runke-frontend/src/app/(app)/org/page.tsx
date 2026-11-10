"use client";

/* 组织架构：部门树 + 成员，接真实后端 /org。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { IcChevRight, IcEditMenu, IcPlus, IcTrash, Svg, type IcProps } from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { RowMenu } from "@/components/rk/RowMenu";
import { SelectBox } from "@/components/rk/Select";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

const OIcFolder = (p: IcProps) => <Svg {...p}><path d="M4 7a1 1 0 0 1 1-1h3.5l1.5 1.6H19a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" /></Svg>;

type Dept = components["schemas"]["DeptOut"];
type Member = components["schemas"]["MemberOut"];

export default function OrgPage() {
  const qc = useQueryClient();
  const [sel, setSel] = useState("root"); // "root" = 全部成员
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addMember, setAddMember] = useState(false);
  const [editMember, setEditMember] = useState<Member | null>(null);

  const { data: depts = [] } = useQuery({
    queryKey: ["org-depts"],
    queryFn: async () => { const { data, error } = await api.GET("/api/v1/org/departments"); if (error) throw error; return data.data as Dept[]; },
  });
  const { data: members = [] } = useQuery({
    queryKey: ["org-members", sel],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/org/members", sel === "root" ? undefined : { params: { query: { department_id: sel } } });
      if (error) throw error; return data.data as Member[];
    },
  });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["org-depts"] }); qc.invalidateQueries({ queryKey: ["org-members"] }); };
  const deptName = (id: string | null | undefined) => depts.find((d) => d.id === id)?.name || "未分配";

  const createDept = useMutation({
    mutationFn: async (body: { name: string; parent_id?: string | null }) => { const { error } = await api.POST("/api/v1/org/departments", { body }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-depts"] }),
  });
  const renameDept = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => { const { error } = await api.PATCH("/api/v1/org/departments/{dept_id}", { params: { path: { dept_id: id } }, body: { name } }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-depts"] }),
  });
  const delDept = useMutation({
    mutationFn: async (id: string) => { const { error } = await api.DELETE("/api/v1/org/departments/{dept_id}", { params: { path: { dept_id: id } } }); if (error) throw error; },
    onSuccess: () => { setSel("root"); refresh(); },
  });
  const saveMember = useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: components["schemas"]["MemberCreate"] | components["schemas"]["MemberUpdate"] }) => {
      if (id) { const { error } = await api.PATCH("/api/v1/org/members/{member_id}", { params: { path: { member_id: id } }, body }); if (error) throw error; }
      else { const { error } = await api.POST("/api/v1/org/members", { body: body as components["schemas"]["MemberCreate"] }); if (error) throw error; }
    },
    onSuccess: () => { setAddMember(false); setEditMember(null); qc.invalidateQueries({ queryKey: ["org-members"] }); },
  });
  const delMember = useMutation({
    mutationFn: async (id: string) => { const { error } = await api.DELETE("/api/v1/org/members/{member_id}", { params: { path: { member_id: id } } }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-members"] }),
  });

  const children = (pid: string | null) => depts.filter((d) => (d.parent_id ?? null) === pid).sort((a, b) => a.sort - b.sort);

  const Node = ({ node, depth }: { node: Dept; depth: number }) => {
    const kids = children(node.id);
    const open = expanded[node.id];
    return (
      <>
        <div className={"tree-node" + (sel === node.id ? " on" : "")} style={{ paddingLeft: 14 + depth * 18 }} onClick={() => setSel(node.id)}>
          <span className="tree-caret" onClick={(e) => { e.stopPropagation(); if (kids.length) setExpanded((x) => ({ ...x, [node.id]: !x[node.id] })); }}>
            {kids.length ? <IcChevRight s={14} style={{ color: "var(--ink-3)", transform: open ? "rotate(90deg)" : "none", transition: ".15s" }} /> : <span style={{ width: 14, display: "inline-block" }} />}
          </span>
          <OIcFolder s={17} style={{ color: "var(--ink-3)" }} />
          <span className="tree-name">{node.name}</span>
          <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
            <RowMenu items={[
              { label: "新建子部门", icon: IcPlus, onClick: () => { const n = prompt("子部门名称"); if (n?.trim()) { createDept.mutate({ name: n.trim(), parent_id: node.id }); setExpanded((x) => ({ ...x, [node.id]: true })); } } },
              { label: "重命名", icon: IcEditMenu, onClick: () => { const n = prompt("部门名称", node.name); if (n?.trim() && n.trim() !== node.name) renameDept.mutate({ id: node.id, name: n.trim() }); } },
              { label: "删除", icon: IcTrash, danger: true, onClick: () => { if (confirm(`删除部门「${node.name}」？子部门一并删除，成员将变为未分配。`)) delDept.mutate(node.id); } },
            ]} />
          </span>
        </div>
        {kids.length > 0 && open && kids.map((c) => <Node key={c.id} node={c} depth={depth + 1} />)}
      </>
    );
  };

  return (
    <div className="page org-page">
      <div className="page-head"><h1>组织架构</h1></div>
      <div className="org-layout fade-in">
        <div className="org-tree">
          <div className="org-tree-head">
            <span>部门</span>
            <button className="dir-add" title="新建一级部门" onClick={() => { const n = prompt("部门名称"); if (n?.trim()) createDept.mutate({ name: n.trim(), parent_id: null }); }}><IcPlus s={14} sw={2} style={{ color: "var(--ink-3)" }} /></button>
          </div>
          <div className={"org-root" + (sel === "root" ? " on" : "")} onClick={() => setSel("root")}>我的企业 · 全部成员</div>
          {children(null).map((n) => <Node key={n.id} node={n} depth={0} />)}
          {depts.length === 0 && <div className="muted" style={{ fontSize: 12.5, padding: "8px 14px" }}>点右上 + 新建部门</div>}
        </div>
        <div className="org-main">
          <div className="org-bar">
            <b>共 {members.length} 人{sel !== "root" && <span className="muted">（{deptName(sel)}）</span>}</b>
            <div className="row" style={{ gap: 12 }}>
              <button className="btn-create" onClick={() => setAddMember(true)}><IcPlus s={16} sw={2.2} style={{ color: "#fff" }} /> 添加成员</button>
            </div>
          </div>
          <div className="org-table">
            <div className="ot-head"><span>成员姓名</span><span>邮箱</span><span>手机号</span><span>部门</span><span>职务</span><span>状态</span><span>操作</span></div>
            {members.length === 0 && <div className="muted" style={{ padding: "26px 16px", fontSize: 13 }}>暂无成员，点右上「添加成员」。</div>}
            {members.map((m) => (
              <div className="ot-row" key={m.id}>
                <span className="ot-name"><b>{m.name}</b>{m.is_creator && <span className="creator-tag">创建者</span>}</span>
                <span className="muted">{m.email || "/"}</span>
                <span className="muted">{m.phone || "/"}</span>
                <span className="muted">{deptName(m.department_id)}</span>
                <span className="muted">{m.role || "/"}</span>
                <span><span className={"pill-out " + (m.status === "joined" ? "joined" : "pending")}>{m.status === "joined" ? "已加入" : "待加入"}</span></span>
                <span>{m.is_creator ? <span className="muted" style={{ fontSize: 12 }}>—</span> : (
                  <RowMenu items={[
                    { label: "编辑", icon: IcEditMenu, onClick: () => setEditMember(m) },
                    { label: "删除", icon: IcTrash, danger: true, onClick: () => { if (confirm(`删除成员「${m.name}」？`)) delMember.mutate(m.id); } },
                  ]} />
                )}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(addMember || editMember) && (
        <MemberModal
          member={editMember}
          depts={depts}
          defaultDept={sel === "root" ? "" : sel}
          busy={saveMember.isPending}
          onClose={() => { setAddMember(false); setEditMember(null); }}
          onSave={(body) => saveMember.mutate({ id: editMember?.id, body })}
        />
      )}
    </div>
  );
}

function MemberModal({ member, depts, defaultDept, busy, onClose, onSave }: {
  member: Member | null; depts: Dept[]; defaultDept: string; busy: boolean;
  onClose: () => void; onSave: (body: components["schemas"]["MemberCreate"]) => void;
}) {
  const [name, setName] = useState(member?.name ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [role, setRole] = useState(member?.role ?? "");
  const [dept, setDept] = useState<string>(member?.department_id ?? defaultDept ?? "");
  const [status, setStatus] = useState(member?.status ?? "joined");
  const ok = name.trim();
  return (
    <RkModal title={member ? "编辑成员" : "添加成员"} w={520} onClose={onClose}
      footer={<><button className="btn-text" onClick={onClose}>取消</button><button className={"btn-primary" + (ok && !busy ? "" : " dis")} disabled={!ok || busy} onClick={() => onSave({ name: name.trim(), email: email.trim(), phone: phone.trim(), role: role.trim(), department_id: dept || null, status })}>{busy ? "保存中…" : "保存"}</button></>}>
      <div className="fld-lbl">成员姓名 <span className="req">*</span></div>
      <input className="fld" placeholder="请输入姓名" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="fld-lbl">邮箱</div>
      <input className="fld" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <div className="fld-lbl">手机号</div>
      <input className="fld" placeholder="选填" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
      <div className="fld-lbl">所属部门</div>
      <SelectBox block value={dept} ph="未分配" options={[{ value: "", label: "未分配" }, ...depts.map((d) => ({ value: d.id, label: d.name }))]} onChange={setDept} />
      <div className="fld-lbl" style={{ marginTop: 16 }}>职务</div>
      <input className="fld" placeholder="如：线上客服（选填）" value={role} onChange={(e) => setRole(e.target.value)} />
      <div className="fld-lbl" style={{ marginTop: 16 }}>状态</div>
      <SelectBox block value={status} options={[{ value: "joined", label: "已加入" }, { value: "pending", label: "待加入" }]} onChange={setStatus} />
    </RkModal>
  );
}
