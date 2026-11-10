"use client";

/* 知识库（真实接后端：增删改查 + 文档上传入向量库 + 检索）。样式移植自原型。 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";

import {
  IcChevDown,
  IcKnowledge,
  IcEditMenu,
  IcPencil,
  IcPlus,
  IcTrash,
  Svg,
  type IcProps,
} from "@/components/icons/rk";
import { RkModal } from "@/components/rk/Modal";
import { RowMenu } from "@/components/rk/RowMenu";
import { api, uploadKbFile } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Kb = components["schemas"]["KnowledgeBaseOut"];
type Doc = components["schemas"]["DocumentOut"];

const KIcText = (p: IcProps) => <Svg {...p}><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M8 8h8M8 12h8M8 16h5" /></Svg>;
const KIcTable = (p: IcProps) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M3.5 14.5h17M9 4.5v15M15 4.5v15" /></Svg>;
const KIcQa = (p: IcProps) => <Svg {...p}><rect x="3.5" y="4" width="17" height="14" rx="2.5" /><path d="M8 20l3-2.5M9.3 8.4a2.4 2.4 0 1 1 3 2.3c-.7.3-1.3.7-1.3 1.6" /><circle cx="11" cy="14.3" r=".9" fill="currentColor" stroke="none" /></Svg>;
const KIcSearch = (p: IcProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></Svg>;
const KIcUpload = (p: IcProps) => <Svg {...p}><path d="M7 16a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5a3.5 3.5 0 0 1 .5 7H16" /><path d="M12 11v8M9 14l3-3 3 3" /></Svg>;

type KType = "text" | "table" | "qa";
const KTYPES: Record<string, { label: string; color: string; soft: string; Icon: (p: IcProps) => ReactNode }> = {
  text: { label: "文本", color: "#2D6FF7", soft: "#E8F0FE", Icon: KIcText },
  table: { label: "表格", color: "#27A857", soft: "#E5F6EC", Icon: KIcTable },
  qa: { label: "问答", color: "#F5862E", soft: "#FDEEDF", Icon: KIcQa },
};
const kt = (t: string) => KTYPES[t] || KTYPES.text;
const fmtTime = (iso: string) => iso.slice(0, 16).replace("T", " ");

const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
  <button className="tg-wrap" onClick={onClick}><span className={"tg" + (on ? " on" : "")}><span className="tg-dot" /></span></button>
);

export default function KnowledgePage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "detail">("list");
  const [modal, setModal] = useState<null | "create" | "edit">(null);
  const [cur, setCur] = useState<Kb | null>(null);

  const { data: kbs, isLoading } = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/knowledge-bases");
      if (error) throw error;
      return data.data;
    },
  });

  const create = useMutation({
    mutationFn: async (body: { name: string; description: string; kb_type: string }) => {
      const { error } = await api.POST("/api/v1/knowledge-bases", { body });
      if (error) throw error;
    },
    onSuccess: () => { setModal(null); qc.invalidateQueries({ queryKey: ["knowledge-bases"] }); },
  });
  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: components["schemas"]["KnowledgeBaseUpdate"] }) => {
      const { error } = await api.PATCH("/api/v1/knowledge-bases/{kb_id}", { params: { path: { kb_id: id } }, body });
      if (error) throw error;
    },
    onSuccess: () => { setModal(null); qc.invalidateQueries({ queryKey: ["knowledge-bases"] }); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/v1/knowledge-bases/{kb_id}", { params: { path: { kb_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["knowledge-bases"] }),
  });

  if (view === "detail" && cur) {
    return <KbDetail kb={cur} onBack={() => { setView("list"); qc.invalidateQueries({ queryKey: ["knowledge-bases"] }); }} />;
  }

  const empty = !isLoading && (kbs?.length ?? 0) === 0;

  return (
    <div className="page kb-page">
      <div className="page-head">
        <h1>知识库</h1>
        {!empty && (
          <button className="btn-create" onClick={() => setModal("create")}><IcPlus s={17} sw={2.2} style={{ color: "#fff" }} /> 创建知识库</button>
        )}
      </div>

      {isLoading ? null : empty ? (
        <div className="empty-state fade-in">
          <div className="empty-illus"><IcKnowledge s={64} style={{ color: "#C3CBDC" }} /></div>
          <h3>知识库，智慧起点</h3><p>请点击创建属于自己的知识库吧</p>
          <button className="btn-ghost lg" onClick={() => setModal("create")}>创建知识库</button>
        </div>
      ) : (
        <div className="kb-table fade-in">
          <div className="kbt-head"><span>名称</span><span>类型</span><span>文档数</span><span>编辑时间</span><span>是否启用</span><span>操作</span></div>
          {kbs?.map((it) => {
            const t = kt(it.kb_type);
            return (
              <div className="kbt-row" key={it.id} onClick={() => { setCur(it); setView("detail"); }}>
                <span className="kbt-name">
                  <span className="kt-badge" style={{ background: t.soft }}><t.Icon s={20} style={{ color: t.color }} /></span>
                  <span><b>{it.name}</b><i>{it.description || "暂无简介"}</i></span>
                </span>
                <span className="muted">{t.label}</span>
                <span className="muted">{it.document_count} 篇</span>
                <span className="muted">{fmtTime(it.updated_at)}</span>
                <span onClick={(e) => e.stopPropagation()}><Toggle on={it.enabled} onClick={() => update.mutate({ id: it.id, body: { enabled: !it.enabled } })} /></span>
                <span className="kbt-ops" onClick={(e) => e.stopPropagation()}>
                  <span className="link-blue" onClick={() => { setCur(it); setView("detail"); }}>查看</span>
                  <RowMenu items={[
                    { label: "编辑", icon: IcEditMenu, onClick: () => { setCur(it); setModal("edit"); } },
                    { label: "删除", icon: IcTrash, danger: true, onClick: () => remove.mutate(it.id) },
                  ]} />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {modal === "create" && <KbModal onClose={() => setModal(null)} onSubmit={(v) => create.mutate(v)} />}
      {modal === "edit" && cur && <KbModal kb={cur} onClose={() => setModal(null)} onSubmit={(v) => update.mutate({ id: cur.id, body: v })} />}
    </div>
  );
}

function TypeCards({ value, onPick }: { value: string; onPick: (k: KType) => void }) {
  return (
    <div className="type-cards">
      {(Object.keys(KTYPES) as KType[]).map((k) => {
        const t = KTYPES[k];
        return (
          <button key={k} className={"type-card" + (value === k ? " on" : "")} onClick={() => onPick(k)}>
            <span className="kt-badge" style={{ background: t.soft }}><t.Icon s={22} style={{ color: t.color }} /></span>
            <span>{t.label}类型</span>
          </button>
        );
      })}
    </div>
  );
}

function KbModal({ kb, onClose, onSubmit }: { kb?: Kb; onClose: () => void; onSubmit: (v: { name: string; description: string; kb_type: string }) => void }) {
  const [type, setType] = useState<string>(kb?.kb_type || "text");
  const [name, setName] = useState(kb?.name || "");
  const [desc, setDesc] = useState(kb?.description || "");
  return (
    <RkModal title={kb ? "编辑知识库" : "创建知识库"} w={560} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>取消</button><button className={"btn-primary" + (name.trim() ? "" : " dis")} disabled={!name.trim()} onClick={() => onSubmit({ name: name.trim(), description: desc, kb_type: type })}>确认</button></>}>
      <TypeCards value={type} onPick={setType} />
      <div className="fld-lbl">知识库名称 <span className="req">*</span></div>
      <div className="fld-wrap">
        <input className="fld" maxLength={20} placeholder="给知识库起个名字" value={name} onChange={(e) => setName(e.target.value)} />
        <span className="fld-count">{name.length}/20</span>
      </div>
      <div className="fld-lbl">简介</div>
      <textarea className="fld ta" placeholder="简单介绍下知识库的用途" value={desc} onChange={(e) => setDesc(e.target.value)} />
    </RkModal>
  );
}

/* ---------------- 详情：真实文档列表 + 上传 + 检索测试 ---------------- */
function KbDetail({ kb, onBack }: { kb: Kb; onBack: () => void }) {
  const qc = useQueryClient();
  const t = kt(kb.kb_type);
  const [upload, setUpload] = useState(false);
  const [detailTab, setDetailTab] = useState<"docs" | "test">("docs");
  const [viewDoc, setViewDoc] = useState<Doc | null>(null);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["kb-docs", kb.id],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/knowledge-bases/{kb_id}/documents", { params: { path: { kb_id: kb.id } } });
      if (error) throw error;
      return data.data;
    },
  });

  const delDoc = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/v1/documents/{doc_id}", { params: { path: { doc_id: id } } });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kb-docs", kb.id] }),
  });

  const empty = !isLoading && (docs?.length ?? 0) === 0;

  if (viewDoc) {
    return <DocParaView kb={kb} doc={viewDoc} onBack={() => setViewDoc(null)} onHome={onBack} />;
  }

  return (
    <div className="page kb-page">
      <div className="kb-crumb" style={{ marginBottom: 14 }}>
        <span className="link-muted" onClick={onBack}>知识库</span>
        <span className="cr-sep">/</span>
        <span className="kt-badge sm" style={{ background: t.soft }}><t.Icon s={15} style={{ color: t.color }} /></span>
        <b>{kb.name}</b>
      </div>

      <div className="kb-subtabs">
        <button className={"kb-subtab" + (detailTab === "docs" ? " on" : "")} onClick={() => setDetailTab("docs")}>数据集</button>
        <button className={"kb-subtab" + (detailTab === "test" ? " on" : "")} onClick={() => setDetailTab("test")}>搜索测试</button>
      </div>

      {detailTab === "test" ? (
        <SearchTest kbId={kb.id} />
      ) : empty ? (
        <div className="empty-state fade-in" style={{ height: "calc(100% - 110px)" }}>
          <div className="empty-illus"><KIcText s={56} style={{ color: "#C3CBDC" }} /></div>
          <h3>尚未添加内容</h3><p>上传文本/文件，自动分块入向量库</p>
          <button className="btn-ghost lg" onClick={() => setUpload(true)}>上传内容</button>
        </div>
      ) : (
        <>
          <div className="kb-detail-bar">
            <span />
            <button className="btn-create" onClick={() => setUpload(true)}><IcPlus s={16} sw={2.2} style={{ color: "#fff" }} /> 添加内容</button>
          </div>
          <div className="kb-table doc fade-in">
            <div className="kbt-head doc"><span>文档ID</span><span>文档名称</span><span>分块数</span><span>状态</span><span>创建时间</span><span>操作</span></div>
            {docs?.map((d: Doc, i: number) => (
              <div className="kbt-row doc" key={d.id} onClick={() => setViewDoc(d)}>
                <span className="muted">{i + 1}</span>
                <span className="kbt-name"><span className="doc-ic" style={{ background: t.color }}><KIcText s={13} style={{ color: "#fff" }} /></span><b style={{ fontWeight: 500 }}>{d.title || "未命名文档"}</b></span>
                <span className="muted">{d.chunk_count}</span>
                <span className="muted">{d.chunk_count > 0 ? "成功入库" : "处理中"}</span>
                <span className="muted">{fmtTime(d.created_at)}</span>
                <span className="kbt-ops" onClick={(e) => e.stopPropagation()}>
                  <span className="link-blue" onClick={() => setViewDoc(d)}>查看</span>
                  <RowMenu items={[{ label: "删除", icon: IcTrash, danger: true, onClick: () => delDoc.mutate(d.id) }]} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {upload && <UploadModal kbId={kb.id} onClose={() => setUpload(false)} onDone={() => { setUpload(false); qc.invalidateQueries({ queryKey: ["kb-docs", kb.id] }); }} />}
    </div>
  );
}

function DocParaView({ kb, doc, onBack, onHome }: { kb: Kb; doc: Doc; onBack: () => void; onHome: () => void }) {
  const t = kt(kb.kb_type);
  const { data: chunks, isLoading } = useQuery({
    queryKey: ["doc-chunks", doc.id],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/documents/{doc_id}/chunks", { params: { path: { doc_id: doc.id } } });
      if (error) throw error;
      return data.data.chunks;
    },
  });
  const n = chunks?.length ?? 0;
  return (
    <div className="page kb-page">
      <div className="kb-crumb">
        <span className="link-muted" onClick={onHome}>知识库</span><span className="cr-sep">/</span>
        <span className="kt-badge sm" style={{ background: t.soft }}><t.Icon s={15} style={{ color: t.color }} /></span>
        <span className="link-muted" onClick={onBack}>{kb.name}</span><span className="cr-sep">/</span>
        <b>{doc.title || "未命名文档"}</b>
      </div>
      <div className="kb-detail-bar">
        <button className="btn-outline" onClick={onBack}>返回文档列表</button>
        <b className="para-count">共 {n} 个段落</b>
      </div>
      {isLoading ? null : (
        <div className="para-list fade-in">
          {chunks?.map((c, i) => (
            <div className="para-card" key={i}>
              <div className="para-n">{i + 1} / {n}</div>
              <div className="para-text">{c}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadModal({ kbId, onClose, onDone }: { kbId: string; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (t: string, content: string) => {
    if (!content.trim()) return;
    setBusy(true);
    try {
      const { error } = await api.POST("/api/v1/knowledge-bases/{kb_id}/documents", {
        params: { path: { kb_id: kbId } },
        body: { title: t || "未命名文档", content },
      });
      if (error) throw error;
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const [err, setErr] = useState<string | null>(null);
  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      for (const f of Array.from(files)) {
        await uploadKbFile(kbId, f);
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <RkModal title="添加内容" w={620}
      icon={<span className="kt-badge sm" style={{ background: KTYPES.text.soft }}><KIcText s={15} style={{ color: KTYPES.text.color }} /></span>}
      onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>取消</button><button className={"btn-primary" + (text.trim() && !busy ? "" : " dis")} disabled={!text.trim() || busy} onClick={() => submit(title, text)}>{busy ? "入库中…" : "确认入库"}</button></>}>
      <button className="dropzone" onClick={() => fileRef.current?.click()}>
        <div className="dz-title"><KIcUpload s={20} style={{ color: "var(--primary)" }} /> {busy ? "解析入库中…" : "单击上传文件"}</div>
        <div className="dz-sub">支持 pdf / docx / pptx / xlsx / csv / txt / md，自动解析、分块、向量化入库</div>
      </button>
      {err && <div className="np-hint" style={{ color: "var(--n-kb)" }}>{err}</div>}
      <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.markdown,.json,.log,.tsv" style={{ display: "none" }} onChange={(e) => onFiles(e.target.files)} />
      <div className="fld-lbl">或粘贴文本 · 标题</div>
      <input className="fld" placeholder="文档标题（选填）" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="fld-lbl">内容</div>
      <textarea className="fld ta" style={{ minHeight: 160 }} placeholder="把要让智能体掌握的资料粘贴到这里…" value={text} onChange={(e) => setText(e.target.value)} />
    </RkModal>
  );
}

interface SearchCfg { mode: "semantic" | "fulltext" | "hybrid"; rerank: boolean; topK: number; minScore: number; optimize: boolean }
const DEFAULT_CFG: SearchCfg = { mode: "semantic", rerank: false, topK: 5, minScore: 0, optimize: false };

function SearchTest({ kbId }: { kbId: string }) {
  const [q, setQ] = useState("");
  const [chunks, setChunks] = useState<components["schemas"]["Chunk"][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<SearchCfg>(DEFAULT_CFG);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [optimized, setOptimized] = useState<string | null>(null);

  const run = async (query?: string) => {
    const text = (query ?? q).trim();
    if (!text || busy) return;
    setBusy(true);
    setOptimized(null);
    try {
      const { data, error } = await api.POST("/api/v1/knowledge-bases/{kb_id}/queries", {
        params: { path: { kb_id: kbId } },
        body: {
          query: text, top_k: cfg.topK, mode: cfg.mode, min_score: cfg.minScore,
          rerank: cfg.rerank, optimize: cfg.optimize, history: history.slice(0, 6),
        },
      });
      if (error) throw error;
      setChunks(data.data.chunks);
      setOptimized(data.data.optimized_query ?? null);
      setHistory((h) => [text, ...h.filter((x) => x !== text)].slice(0, 10));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-layout fade-in">
      <div className="st-left">
        <div className="st-card">
          <div className="st-card-head">
            <b>输入测试内容</b>
            <button className="ghost-pill" onClick={() => setCfgOpen(true)}><SIcGearSt s={15} /> 搜索配置</button>
          </div>
          <textarea className="st-input" placeholder="输入需要测试的内容" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className={"st-run" + (q.trim() && !busy ? " on" : "")} disabled={!q.trim() || busy} onClick={() => run()}>
            {busy ? "测试中…" : "测试"}
          </button>
        </div>
        <div className="st-card">
          <div className="st-card-head"><b>测试历史</b></div>
          {history.length === 0 ? (
            <div className="st-hist-empty">暂无测试历史</div>
          ) : (
            history.map((h, i) => (
              <button key={i} className="st-hist-item" onClick={() => { setQ(h); run(h); }}>
                <span className="st-hist-q">{h}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="st-result">
        {chunks === null ? (
          <div className="st-empty">
            <KIcSearch s={40} style={{ color: "var(--ink-4)" }} />
            <div>测试结果将在这里展示</div>
          </div>
        ) : chunks.length === 0 ? (
          <div className="st-empty"><KIcSearch s={40} style={{ color: "var(--ink-4)" }} /><div>未检索到相关内容</div></div>
        ) : (
          <div className="st-chunks">
            {optimized && (
              <div className="st-optimized"><b>问题已优化为</b>{optimized}</div>
            )}
            <div className="st-chunks-cap">共召回 {chunks.length} 个片段 · {cfg.mode === "semantic" ? "语义检索" : cfg.mode === "fulltext" ? "全文检索" : "混合检索"}{cfg.rerank ? " · 已重排" : ""}</div>
            {chunks.map((c, i) => (
              <div className="st-chunk" key={i}>
                <div className="st-chunk-head">
                  <span className="st-chunk-n">片段 {i + 1}</span>
                  <span className="st-score">相关度 {c.score.toFixed(3)}</span>
                </div>
                <div className="st-chunk-text">{c.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {cfgOpen && <SearchConfigModal cfg={cfg} onClose={() => setCfgOpen(false)} onSave={(c) => { setCfg(c); setCfgOpen(false); }} />}
    </div>
  );
}

const SIcGearSt = (p: IcProps) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6 6l1.5 1.5M16.5 16.5 18 18M6 18l1.5-1.5M16.5 7.5 18 6" /></Svg>;

function SearchConfigModal({ cfg, onClose, onSave }: { cfg: SearchCfg; onClose: () => void; onSave: (c: SearchCfg) => void }) {
  const [tab, setTab] = useState<"mode" | "filter" | "opt">("mode");
  const [draft, setDraft] = useState<SearchCfg>(cfg);
  const set = (p: Partial<SearchCfg>) => setDraft((d) => ({ ...d, ...p }));
  const MODES: { key: SearchCfg["mode"]; title: string; desc: string; real: boolean }[] = [
    { key: "semantic", title: "语义检索", desc: "使用向量进行文本相关性查询", real: true },
    { key: "fulltext", title: "全文检索", desc: "传统全文关键词检索，适合精确匹配术语", real: true },
    { key: "hybrid", title: "混合检索", desc: "向量 + 全文综合结果，RRF 算法排序", real: true },
  ];
  return (
    <RkModal title="知识库搜索配置" w={620} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>关闭</button><button className="btn-primary" onClick={() => onSave(draft)}>完成</button></>}>
      <div className="sc-tabs">
        {([["mode", "搜索方式"], ["filter", "搜索过滤"], ["opt", "问题优化"]] as const).map(([k, label]) => (
          <button key={k} className={"sc-tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === "mode" && (
        <div className="sc-modes">
          {MODES.map((m) => (
            <button key={m.key} className={"sc-mode" + (draft.mode === m.key ? " on" : "")} disabled={!m.real} onClick={() => m.real && set({ mode: m.key })}>
              <span className={"sc-radio" + (draft.mode === m.key ? " on" : "")} />
              <span><b>{m.title}</b><i>{m.desc}</i></span>
            </button>
          ))}
          <div className="sc-row">
            <span>结果重排</span>
            <button className="tg-wrap" onClick={() => set({ rerank: !draft.rerank })}><span className={"tg" + (draft.rerank ? " on" : "")}><span className="tg-dot" /></span></button>
          </div>
        </div>
      )}
      {tab === "filter" && (
        <div className="sc-filter">
          <div className="sc-slider-row">
            <span className="sc-lbl">引用上限</span>
            <input type="range" min={1} max={20} value={draft.topK} onChange={(e) => set({ topK: Number(e.target.value) })} />
            <span className="sc-val">{draft.topK}</span>
          </div>
          <div className="sc-slider-row">
            <span className="sc-lbl">最低相关度</span>
            <input type="range" min={0} max={1} step={0.05} value={draft.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} />
            <span className="sc-val">{draft.minScore.toFixed(2)}</span>
          </div>
        </div>
      )}
      {tab === "opt" && (
        <div className="sc-opt">
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>开启问题优化后，连续对话时会根据对话记录用 AI 补全问题缺失的信息，提高知识库搜索精度。</p>
          <div className="sc-row">
            <span>使用问题优化</span>
            <button className="tg-wrap" onClick={() => set({ optimize: !draft.optimize })}><span className={"tg" + (draft.optimize ? " on" : "")}><span className="tg-dot" /></span></button>
          </div>
        </div>
      )}
    </RkModal>
  );
}
