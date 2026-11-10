"use client";

/* 预览和调试（真实链路：会话持久化 + 数据钩子 + 语音通话调试）+ 工作流运行过程组件。
 * 自旧版工作流画布（WorkflowCanvas，已删除）抽出，供 AI 编排画布（WorkflowExp）复用。 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  IcCheck,
  IcChevDown,
  IcChevRight,
  IcChevUp,
  IcClose,
  IcExperience,
  IcSend,
  IcTrash,
  IcVoiceNode as IcVoiceCfg,
} from "@/components/icons/rk";
import { Markdown } from "@/components/rk/Markdown";
import { VoiceCallUI, type VoiceTurn } from "@/components/rk/VoiceCallUI";
import { api, streamCompletion } from "@/lib/api/client";
import { avatarDataUri } from "@/lib/rk/avatar";
import { useVoices, voiceById } from "@/lib/rk/voices";
import { NODE_TYPES, type Graph } from "./wf-nodes";
import { NodeBadge } from "./wf-nodes";

export interface SessionVar { name: string; scope: string; label?: string }
export interface BotVar { name: string; scope: string; label?: string; value?: string }

/* ---------------- 预览和调试（对齐原型：对话 + 工作流运行过程）---------------- */
export interface CondRow { src: string; src_value: string; op: string; val: string; result: boolean }
interface CondEval { name: string; match: string; matched: boolean; conds: CondRow[] }
export interface StepDetail { model?: string; prompt?: string; tokens?: { input?: number; output?: number; total?: number } | null; template?: string; kb_ids?: string[]; hits?: number; writes?: Record<string, string>; candidates?: string[]; chosen_index?: number; evaluations?: CondEval[]; skill_id?: string; bot_id?: string }
export interface RunStep { node: string; type: string; title?: string; status?: string; elapsed_ms?: number; input?: string; output: string; note?: string; branch_label?: string | null; detail?: StepDetail; inputs?: Record<string, unknown>; outputs?: Record<string, unknown>; vars?: Record<string, string>; error?: string; ok: boolean }
export interface RunSummary { total_ms: number; node_count: number; ok: boolean }
interface PvMsg { id: string; who: "me" | "bot"; text: string; steps?: RunStep[]; input?: string; summary?: RunSummary }

const jstr = (o: unknown) => { try { return JSON.stringify(o, null, 2); } catch { return String(o); } };


/* 把一轮调试的执行过程压成给 AI 编排的分析请求文本 */
function briefForAI(m: PvMsg): string {
  const brief = (m.steps ?? []).map((s) => ({
    node: s.title || s.node, type: s.type, branch: s.branch_label || undefined,
    note: s.note || undefined, error: s.error || undefined,
    output: ["reply", "llm", "voice"].includes(s.type) ? (s.output || "").slice(0, 150) : undefined,
  }));
  return `我在预览调试里发了「${m.input ?? ""}」，回复是「${(m.text || "").slice(0, 200)}」。执行过程如下，请帮我分析这一轮走得对不对，不对就直接修：\n\`\`\`json\n${JSON.stringify(brief, null, 1)}\n\`\`\``;
}

/* 单节点整形成结构化 JSON（对标竞品运行过程节点） */
function stepJson(s: RunStep) {
  const o: Record<string, unknown> = {
    node: s.title || s.node, node_id: s.node, node_type: s.type, status: s.status || (s.ok ? "success" : "error"),
    duration_ms: s.elapsed_ms,
  };
  if (s.branch_label) o.matched_branch = s.branch_label;
  o.inputs = s.inputs ?? { input: s.input };
  o.outputs = s.outputs ?? { output: s.output };
  if (s.vars && Object.keys(s.vars).length) o.vars = s.vars;
  if (s.detail && Object.keys(s.detail).length) o.detail = s.detail;
  if (s.error) o.error = s.error;
  return o;
}
function traceJson(steps: RunStep[], summary: RunSummary | undefined, titleOf: (s: RunStep) => string) {
  return {
    node_count: summary?.node_count ?? steps.length,
    total_ms: summary?.total_ms,
    status: (summary?.ok ?? steps.every((s) => s.ok)) ? "success" : "error",
    execution_trace: steps.map((s) => ({ node: titleOf(s), node_type: s.type, status: s.status || (s.ok ? "success" : "error"), duration_ms: s.elapsed_ms })),
    node_timings: Object.fromEntries(steps.map((s) => [titleOf(s), s.elapsed_ms])),
  };
}

function CopyBtn({ text, label = "复制" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="rd-copy" onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}>
      {done ? "已复制" : label}
    </button>
  );
}

function StepBody({ s }: { s: RunStep }) {
  const d = s.detail || {};
  return (
    <div className="run-detail fade-in">
      {s.error && <div className="rd-error">{s.error}</div>}
      {/* 原始节点 JSON（可复制） */}
      <div className="rd-block">
        <div className="rd-cap">节点 JSON <CopyBtn text={jstr(stepJson(s))} /></div>
        <pre className="rd-json">{jstr(stepJson(s))}</pre>
      </div>
      {/* 条件分支：判定表 */}
      {s.type === "cond" && d.evaluations && (
        <div className="rd-block">
          <div className="rd-cap">条件判定</div>
          {d.evaluations.map((b, bi) => (
            <div key={bi} className={"rd-eval" + (b.matched ? " on" : "")}>
              <div className="rd-eval-head">{b.matched ? "✓ " : ""}{b.name}<span className="rd-eval-match">（{b.match}）</span></div>
              {b.conds.length === 0 ? <div className="rd-eval-row muted">（无条件）</div> : b.conds.map((c, ci) => (
                <div key={ci} className="rd-eval-row">
                  <code>{c.src}</code><span className="rd-eval-v">={c.src_value || "∅"}</span>
                  <span className="rd-eval-op">{c.op}</span><code>{c.val || "∅"}</code>
                  <span className={c.result ? "rd-yes" : "rd-no"}>{c.result ? "✓" : "✗"}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {/* 意图分类：候选 + 命中 */}
      {s.type === "intent" && d.candidates && (
        <div className="rd-block"><div className="rd-cap">分类候选</div>
          <div className="rd-chips">{d.candidates.map((c, i) => <span key={i} className={"rd-chip" + (i === d.chosen_index ? " on" : "")}>{c}</span>)}</div>
        </div>
      )}
      {/* 变量写入：前→后 */}
      {s.type === "variable" && d.writes && Object.keys(d.writes).length > 0 && (
        <div className="rd-block"><div className="rd-cap">变量写入</div>
          {Object.entries(d.writes).map(([k, v]) => <div key={k} className="rd-write"><code>{k}</code><span>{v}</span></div>)}
        </div>
      )}
      {/* 大模型：模型 + token + 渲染后 prompt */}
      {s.type === "llm" && (
        <>
          <div className="rd-meta">{d.model && <span>模型 {d.model}</span>}{d.tokens?.total != null && <span>tokens {d.tokens.input}+{d.tokens.output}={d.tokens.total}</span>}</div>
          {d.prompt && <div className="rd-block"><div className="rd-cap">渲染后的提示词</div><pre className="rd-code">{d.prompt}</pre></div>}
        </>
      )}
      {s.type === "kb" && <div className="rd-meta"><span>知识库 {(d.kb_ids || []).length} 个</span><span>命中 {d.hits ?? 0} 段</span></div>}
      <div className="rd-block"><div className="rd-cap">输入 (JSON)</div><pre className="rd-json">{jstr(s.inputs ?? { input: s.input })}</pre></div>
      <div className="rd-block"><div className="rd-cap">输出 (JSON)</div><pre className="rd-json">{jstr(s.outputs ?? { output: s.output })}</pre></div>
      {/* 该步执行后的变量快照 */}
      {s.vars && Object.keys(s.vars).length > 0 && (
        <div className="rd-block"><div className="rd-cap">变量快照 (JSON)</div><pre className="rd-json">{jstr(s.vars)}</pre></div>
      )}
    </div>
  );
}

export function RunSteps({ steps, summary, graph }: { steps: RunStep[]; summary?: RunSummary; graph: Graph }) {
  const [open, setOpen] = useState(false);
  const [exp, setExp] = useState(-1);
  const titleOf = (s: RunStep) => s.title || graph.nodes.find((n) => n.id === s.node)?.title || NODE_TYPES[s.type]?.label || s.type;
  const ok = summary?.ok ?? steps.every((s) => s.ok);
  return (
    <div className="run-steps">
      <div className="run-head-wrap">
        <button className="run-head" onClick={() => setOpen((o) => !o)}>
          <span className="row" style={{ gap: 8 }}>工作流运行过程
            <span className={"run-stat " + (ok ? "ok" : "err")}>{ok ? "成功" : "失败"}</span>
            {summary && <span className="run-sum">{summary.node_count} 步 · {summary.total_ms}ms</span>}
          </span>
          {open ? <IcChevUp s={18} style={{ color: "var(--ink-3)" }} /> : <IcChevDown s={18} style={{ color: "var(--ink-3)" }} />}
        </button>
        <CopyBtn text={jstr(traceJson(steps, summary, titleOf))} label="复制全过程" />
      </div>
      {open && (
        <div className="run-list fade-in">
          {steps.map((s, i) => {
            const isOpen = exp === i;
            return (
              <div key={i} className="run-item-wrap">
                <button className={"run-item" + (s.status === "error" ? " err" : "")} onClick={() => setExp(isOpen ? -1 : i)}>
                  <div className="run-row1">
                    <span className="run-ix">{i + 1}</span>
                    <NodeBadge type={s.type} s={20} />
                    <span className="run-name">{titleOf(s)}</span>
                    <IcChevRight s={13} style={{ color: "var(--ink-4)", transform: isOpen ? "rotate(90deg)" : "none", transition: ".15s", flex: "none" }} />
                    <span className="spacer" />
                    {s.elapsed_ms != null && <span className="run-ms">{s.elapsed_ms}ms</span>}
                    {s.ok ? <span className="rs-ok"><IcCheck s={12} sw={2.6} style={{ color: "#fff" }} /></span> : <span className="rs-err"><IcClose s={12} sw={2.6} style={{ color: "#fff" }} /></span>}
                  </div>
                  {(s.note || s.branch_label) && (
                    <div className="run-row2">
                      {s.note && <span className="run-note">{s.note}</span>}
                      {s.branch_label && <span className="run-branch-pill">{s.branch_label}</span>}
                    </div>
                  )}
                </button>
                {isOpen && <StepBody s={s} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PreviewPanel({ botId, sessionVars, botVars = [], graph, onClose, onRunStart, onTrace, saveGraph, onAskAI }: { botId: string; sessionVars: SessionVar[]; botVars?: BotVar[]; graph: Graph; onClose: () => void; onRunStart: () => void; onTrace: (steps: RunStep[]) => void; saveGraph: () => Promise<void>; onAskAI?: (text: string) => void }) {
  const welcome = String(((graph.nodes || []).find((n) => n.type === "start")?.fields as { welcome?: string } | undefined)?.welcome || "");
  const [msgs, setMsgs] = useState<PvMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [varVals, setVarVals] = useState<Record<string, string>>({});
  const convId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const botImg = avatarDataUri(botId);
  const userImg = avatarDataUri(botId + "-user");
  const lsKey = "rk-wf-conv-" + botId;

  // 文字 / 语音 预览切换（读 bot.voice_config）
  const { data: botFull } = useQuery({
    queryKey: ["bot", botId],
    queryFn: async () => { const { data, error } = await api.GET("/api/v1/bots/{bot_id}", { params: { path: { bot_id: botId } } }); if (error) throw error; return data.data; },
  });
  const vcfg = (botFull?.voice_config ?? {}) as { enabled?: boolean; voice_id?: string | null; speed?: number };
  const [mode, setMode] = useState<"text" | "voice">("text");
  const { data: allVoices } = useVoices();
  const previewVoice = voiceById(allVoices, vcfg.voice_id);
  // 语音转写同步进主线程
  const [voiceMsgs, setVoiceMsgs] = useState<VoiceTurn[]>([]);
  const [voiceLive, setVoiceLive] = useState(false);
  const [voiceDur, setVoiceDur] = useState("");
  const voiceTag = voiceLive ? "通话中…" : "语音 " + voiceDur;
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);

  // 重新打开预览时恢复上次调试会话（持久化 convId，重载历史消息）
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(lsKey) : null;
    if (!saved) return;
    convId.current = saved;
    (async () => {
      const { data, error } = await api.GET("/api/v1/conversations/{conv_id}/messages", { params: { path: { conv_id: saved }, query: { page_size: 100 } } });
      if (error || !data) { convId.current = null; localStorage.removeItem(lsKey); return; }
      setMsgs(data.data.filter((m) => m.role !== "system").map((m) => {
        const meta = (m.meta || {}) as { trace?: RunStep[]; summary?: RunSummary; input?: string };
        return { id: m.id, who: m.role === "user" ? "me" : "bot", text: m.content, steps: meta.trace, summary: meta.summary, input: meta.input };
      }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureConv = async () => {
    if (convId.current) return convId.current;
    const variables: Record<string, string> = {};
    for (const v of sessionVars) if (varVals[v.name]?.trim()) variables[v.name] = varVals[v.name].trim();
    const { data, error } = await api.POST("/api/v1/bots/{bot_id}/conversations", { params: { path: { bot_id: botId } }, body: { title: "工作流调试", variables } });
    if (error) throw error;
    convId.current = data.data.id;
    if (typeof window !== "undefined") localStorage.setItem(lsKey, data.data.id);
    return data.data.id;
  };

  async function ask() {
    const q = input.trim();
    if (!q || streaming) return;
    setInput("");
    setMsgs((m) => [...m, { id: crypto.randomUUID(), who: "me", text: q }]);
    const aid = crypto.randomUUID();
    setMsgs((m) => [...m, { id: aid, who: "bot", text: "" }]);
    setStreaming(true);
    try {
      await saveGraph(); // 先保存当前画布图，预览跑的就是眼前的编排
      onRunStart();
      const cid = await ensureConv();
      await streamCompletion(
        cid,
        q,
        (d) => setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, text: x.text + d } : x))),
        (e) => {
          if (e.type === "trace") {
            const steps = e.steps as RunStep[];
            setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, steps, input: e.input as string, summary: e.summary as RunSummary } : x)));
            onTrace(steps); // 画布按真实路径逐节点点亮
          }
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "生成失败";
      setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, text: x.text || `（${msg}）` } : x)));
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="preview-panel">
      <div className="pv-head">
        <span className="row" style={{ gap: 9, fontWeight: 700, fontSize: 16 }}><IcExperience s={20} style={{ color: "var(--primary)" }} /> 预览和调试</span>
        <span className="row" style={{ gap: 12 }}>
          {vcfg.enabled && (
            <span className="pv-mode">
              <button className={"pv-mode-btn" + (mode === "text" ? " on" : "")} onClick={() => setMode("text")}>文字</button>
              <button className={"pv-mode-btn" + (mode === "voice" ? " on" : "")} onClick={() => setMode("voice")}>语音</button>
            </span>
          )}
          <button className="icon-btn" onClick={onClose}><IcClose s={20} style={{ color: "var(--ink-3)" }} /></button>
        </span>
      </div>
      <div className="pv-scroll" ref={scrollRef}>
        {welcome.trim() && mode === "text" && (() => {
          // 用「变量默认值 + 会话调试输入」替换开场白里的 {{scope.name}} / 裸 {{name}}
          const resolve = (raw: string) => {
            const token = raw.trim();
            const bare = token.replace(/^(session|global|customer|sys)\./, "");
            if (varVals[bare]?.trim()) return varVals[bare];
            const bv = botVars.find((v) => `${v.scope}.${v.name}` === token || v.name === bare);
            return bv?.value ?? "";
          };
          const text = welcome.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k) => resolve(k)).replace(/\{\{\s*[^}]+?\s*\}\}/g, "").replace(/\s+([，。、？！])/g, "$1").trim();
          return (
            <div className="pv-row bot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={botImg} alt="" />
              <div className="pv-bot-col">
                <div className="pv-bubble bot"><Markdown>{text || welcome}</Markdown></div>
              </div>
            </div>
          );
        })()}
        {mode === "text" && msgs.length === 0 && <div className="muted" style={{ fontSize: 13, padding: "8px 4px" }}>输入一条消息，运行整个工作流并查看每个节点的执行过程。</div>}
        {mode === "text" && msgs.length === 0 && sessionVars.length > 0 && (
          <div className="sa-debugvars" style={{ margin: "10px 0 0" }}>
            <div className="sa-debugvars-lbl">调试会话变量（发首条消息时带入）</div>
            {sessionVars.map((v) => (
              <div className="sa-debugvar-row" key={v.name}>
                <code title={`{{session.${v.name}}}`}>{v.label?.trim() || v.name}</code>
                <input value={varVals[v.name] ?? ""} placeholder="输入测试值" onChange={(e) => setVarVals((s) => ({ ...s, [v.name]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}
        {msgs.map((m) =>
          m.who === "me" ? (
            <div key={m.id} className="pv-row me">
              <div className="pv-bubble me">{m.text}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={userImg} alt="" />
            </div>
          ) : (
            <div key={m.id} className="pv-row bot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={botImg} alt="" />
              <div className="pv-bot-col">
                <div className="pv-bubble bot">{m.text ? <Markdown>{m.text}</Markdown> : <span className="pv-typing"><i /><i /><i /></span>}</div>
                {m.steps && m.steps.length > 0 && <RunSteps steps={m.steps} summary={m.summary} graph={graph} />}
                {m.steps && m.steps.length > 0 && onAskAI && (
                  <button className="wfexp-askai" onClick={() => onAskAI(briefForAI(m))}>✦ 让 AI 看看这一轮</button>
                )}
              </div>
            </div>
          ),
        )}
        {/* 语音转写：实时同步进主线程（带语音标签） */}
        {voiceMsgs.map((m, i) =>
          m.who === "me" ? (
            <div key={"v" + i} className="pv-row me">
              <div className="pv-bubble me"><span className="sa-voice-tag"><IcVoiceCfg s={11} style={{ color: "currentColor" }} /> {voiceTag}</span>{m.text}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={userImg} alt="" />
            </div>
          ) : (
            <div key={"v" + i} className="pv-row bot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={botImg} alt="" />
              <div className="pv-bot-col">
                <div className="pv-bubble bot"><span className="sa-voice-tag"><IcVoiceCfg s={11} style={{ color: "currentColor" }} /> {voiceTag}</span>{m.text}</div>
              </div>
            </div>
          ),
        )}
      </div>
      {mode === "voice" ? (
        <VoiceCallUI
          onTurns={(t) => { setVoiceMsgs(t); setVoiceLive(true); }}
          onEnded={(s) => { setVoiceLive(false); setVoiceDur(`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`); }}
          botId={botId}
          voice={previewVoice?.provider_voice ?? ""}
          voiceResource={previewVoice?.provider_resource}
          voiceSpeed={vcfg.speed ?? 1.0}
          voiceName={previewVoice?.name ?? ""}
          agentName={botFull?.name ?? "智能体"}
          agentImg={botImg}
          callVars={{
            name: varVals["cand_name"] || varVals["name"] || undefined,
            runke_vars: Object.fromEntries(
              sessionVars.map((v) => [v.name, varVals[v.name]?.trim()]).filter(([, val]) => !!val) as [string, string][],
            ),
          }}
        />
      ) : (
        <div className="pv-input-bar">
          <button className="pv-clear" title="清空" onClick={() => { setMsgs([]); convId.current = null; if (typeof window !== "undefined") localStorage.removeItem(lsKey); }}><IcTrash s={18} style={{ color: "var(--ink-3)" }} /></button>
          <div className="pv-input">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="输入测试问题" />
            <button className="pv-send" onClick={ask}><IcSend s={18} style={{ color: "#fff" }} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
