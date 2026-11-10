"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  IcChevDown,
  IcChevUp,
  IcClose,
  IcPlus,
  IcSend,
  SIcBook,
  SIcDrag,
  SIcFolder,
  SIcGear,
  SIcHi,
  SIcImage,
  SIcMinus,
  SIcModel,
  SIcRole,
  SIcSpark,
  SkIcTool,
  Svg,
  type IcProps,
} from "@/components/icons/rk";
import { Markdown } from "@/components/rk/Markdown";
import { RkModal } from "@/components/rk/Modal";
import { VoiceCallUI, type VoiceTurn } from "@/components/rk/VoiceCallUI";
import { VoicePicker } from "@/components/rk/VoicePicker";
import { api, streamCompletion } from "@/lib/api/client";
import { botAvatar } from "@/lib/rk/avatar";
import { BoundSkillRow, SkillPicker, useSkills } from "@/lib/rk/skills";
import { useVoices, voiceById } from "@/lib/rk/voices";
import { useToast } from "@/components/ui/use-toast";
import type { components } from "@/lib/api/schema";

type BotOut = components["schemas"]["BotOut"];

export interface SingleAgentHandle {
  save: () => Promise<void>;
}

const MODELS = ["RunkeAI 4.0", "RunkeAI 3.5", "精调销售大模型高级版"];


/* ---------- 折叠卡片（.sa-card） ---------- */
function SectionCard({
  icon,
  title,
  right,
  children,
  defaultOpen = true,
}: {
  icon: ReactNode;
  title: string;
  right?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sa-card">
      <div className="sa-card-head">
        <span className="sa-card-title">{icon}{title}</span>
        <span className="row" style={{ gap: 12 }}>
          {right}
          <button className="icon-btn" onClick={() => setOpen((o) => !o)}>
            {open ? (
              <IcChevUp s={18} style={{ color: "var(--ink-3)" }} />
            ) : (
              <IcChevDown s={18} style={{ color: "var(--ink-3)" }} />
            )}
          </button>
        </span>
      </div>
      {open && <div className="sa-card-body">{children}</div>}
    </div>
  );
}

const SIcVoice = (p: IcProps) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;

const AiBtn = () => (
  <button className="ai-btn">
    <SIcSpark s={14} /> AI 优化
  </button>
);

interface VarOpt { group: string; label: string; token: string }
function buildVarOptions(bot: BotOut): VarOpt[] {
  const opts: VarOpt[] = [];
  ((bot.variables as { name: string; scope: string; label?: string }[]) ?? []).forEach((v) => {
    if (!v.name?.trim()) return;
    const scope = v.scope === "session" ? "session" : "global";
    opts.push({ group: scope === "session" ? "会话变量" : "全局变量", label: v.label?.trim() ? `${v.label}（${v.name}）` : v.name, token: `${scope}.${v.name}` });
  });
  [["customer.name", "客户姓名"], ["customer.company", "客户公司"], ["customer.intent", "客户意向"]].forEach(([t, l]) => opts.push({ group: "客户", label: l, token: t }));
  [["sys.time", "当前时间"], ["sys.channel", "渠道"]].forEach(([t, l]) => opts.push({ group: "系统", label: l, token: t }));
  return opts;
}

/* 普通 textarea 的「插入变量」下拉，按光标位置插入 {{token}} */
function InsertVar({ options, onInsert }: { options: VarOpt[]; onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const groups: string[] = [];
  for (const o of options) if (!groups.includes(o.group)) groups.push(o.group);
  return (
    <span style={{ position: "relative" }}>
      <button className="ghost-pill" onClick={() => setOpen((o) => !o)}>{"{ } 插入变量"}</button>
      {open && (
        <>
          <div className="varmenu-mask" onClick={() => setOpen(false)} />
          <div className="varmenu" style={{ right: 0, top: 30 }}>
            {options.length === 0 && <div className="varmenu-empty">暂无变量，去全局配置添加</div>}
            {groups.map((g) => (
              <div key={g}>
                <div className="varmenu-group">{g}</div>
                {options.filter((o) => o.group === g).map((o) => (
                  <button key={o.token} className="varmenu-item" onClick={() => { onInsert(`{{${o.token}}}`); setOpen(false); }}>
                    <span className="varmenu-label">{o.label}</span><code>{`{{${o.token}}}`}</code>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/* ============================ 主编辑器（.sa-body） ============================ */
export const SingleAgentEditor = forwardRef<SingleAgentHandle, { bot: BotOut; onSaved?: () => void }>(
  function SingleAgentEditor({ bot, onSaved }, ref) {
    const { toast } = useToast();

    const [prompt, setPrompt] = useState(bot.system_prompt ?? "");
    const [welcome, setWelcome] = useState(bot.welcome ?? "");
    const [examples, setExamples] = useState<string[]>(bot.examples ?? []);
    const [model, setModel] = useState(bot.model || MODELS[0]);
    const params = (bot.model_params as Record<string, number>) ?? {};
    const [kbId, setKbId] = useState<string | null>(bot.knowledge_base_id ?? null);
    const [pickKb, setPickKb] = useState(false);
    const [skillIds, setSkillIds] = useState<string[]>(bot.skill_ids ?? []);
    const [pickSkill, setPickSkill] = useState(false);
    const { data: allSkills } = useSkills();

    // 语音配置（独立即时保存，不进 draft 防与防抖自动保存竞态）
    const vc0 = (bot.voice_config ?? {}) as { enabled?: boolean; voice_id?: string | null; mode?: string; outbound?: boolean; barge_in?: boolean; speed?: number };
    const [voiceOn, setVoiceOn] = useState(!!vc0.enabled);
    const [voiceId, setVoiceId] = useState<string | null>(vc0.voice_id ?? null);
    const [voiceMode, setVoiceMode] = useState<string>(vc0.mode || "call");
    const [outbound, setOutbound] = useState(!!vc0.outbound);
    const [bargeIn, setBargeIn] = useState(vc0.barge_in ?? true);
    const [voiceSpeed, setVoiceSpeed] = useState<number>(vc0.speed ?? 1.0);
    const [pickVoice, setPickVoice] = useState(false);
    const { data: voices } = useVoices();
    const curVoice = voiceById(voices, voiceId);

    const { data: kbs } = useQuery({
      queryKey: ["knowledge-bases"],
      queryFn: async () => {
        const { data, error } = await api.GET("/api/v1/knowledge-bases");
        if (error) throw error;
        return data.data;
      },
    });
    const boundKb = kbs?.find((k) => k.id === kbId) ?? null;

    const patch = useMutation({
      mutationFn: async (body: components["schemas"]["BotUpdate"]) => {
        const { data, error } = await api.PATCH("/api/v1/bots/{bot_id}", {
          params: { path: { bot_id: bot.id } },
          body,
        });
        if (error) throw error;
        return data.data;
      },
    });

    // 语音配置即时保存（写完整对象，避免部分合并）
    const persistVoice = (p: Partial<{ enabled: boolean; voice_id: string | null; mode: string; outbound: boolean; barge_in: boolean; speed: number }>) => {
      const next = { enabled: voiceOn, voice_id: voiceId, mode: voiceMode, outbound, barge_in: bargeIn, speed: voiceSpeed, ...p };
      patch.mutateAsync({ voice_config: next }).then(() => onSaved?.());
    };

    const draft = (): components["schemas"]["BotUpdate"] => ({
      system_prompt: prompt,
      welcome,
      examples,
      model,
      knowledge_base_id: kbId,
      skill_ids: skillIds,
    });

    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const first = useRef(true);
    useEffect(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        patch.mutateAsync(draft()).then(() => onSaved?.());
      }, 800);
      return () => {
        if (timer.current) clearTimeout(timer.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prompt, welcome, examples, model, kbId, skillIds]);

    useImperativeHandle(ref, () => ({
      save: async () => {
        await patch.mutateAsync({ ...draft(), published: true });
        onSaved?.();
        toast({ title: "应用已发布" });
      },
    }));

    const setEx = (i: number, v: string) => setExamples((e) => e.map((x, j) => (j === i ? v : x)));

    const varOpts = buildVarOptions(bot);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const welcomeRef = useRef<HTMLTextAreaElement>(null);
    const insertInto = (ref: React.RefObject<HTMLTextAreaElement | null>, setter: (f: (v: string) => string) => void, token: string) => {
      const ta = ref.current;
      if (!ta) { setter((v) => v + token); return; }
      const s = ta.selectionStart, e = ta.selectionEnd;
      setter((v) => v.slice(0, s) + token + v.slice(e));
      requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + token.length; });
    };

    return (
      <div className="sa-body">
        {/* 左侧配置 */}
        <div className="sa-left">
          {/* 角色设定 */}
          <SectionCard
            icon={<SIcRole s={18} style={{ color: "var(--n-intent)" }} />}
            title="角色设定"
            right={
              <>
                <InsertVar options={varOpts} onInsert={(t) => insertInto(promptRef, setPrompt, t)} />
                <AiBtn />
              </>
            }
          >
            <div className="ta-wrap">
              <textarea
                ref={promptRef}
                className="sa-textarea"
                value={prompt}
                maxLength={4000}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="描述这个智能体的角色、回答范围与沟通风格…"
              />
              <span className="ta-count">{prompt.length}/4000</span>
            </div>
          </SectionCard>

          {/* 开场白 */}
          <SectionCard
            icon={<SIcHi s={18} style={{ color: "var(--n-cond)" }} />}
            title="开场白"
            right={
              <>
                <InsertVar options={varOpts} onInsert={(t) => insertInto(welcomeRef, setWelcome, t)} />
                <AiBtn />
              </>
            }
          >
            <div className="ta-wrap">
              <textarea
                ref={welcomeRef}
                className="sa-textarea sm"
                value={welcome}
                maxLength={200}
                onChange={(e) => setWelcome(e.target.value)}
                placeholder="用户进入对话时看到的第一句话…"
              />
              <span className="ta-count">{welcome.length}/200</span>
            </div>
            <div className="sa-sublbl">引导问题</div>
            <div className="ex-list">
              {examples.map((ex, i) => (
                <div className="ex-row" key={i}>
                  <input value={ex} maxLength={100} onChange={(e) => setEx(i, e.target.value)} />
                  <span className="ex-count">{ex.length}/100</span>
                  <button className="ex-ic" onClick={() => setExamples((e) => e.filter((_, j) => j !== i))}>
                    <SIcMinus s={18} style={{ color: "var(--ink-3)" }} />
                  </button>
                  <button className="ex-ic drag">
                    <SIcDrag s={18} style={{ color: "var(--ink-4)" }} />
                  </button>
                </div>
              ))}
            </div>
            {examples.length < 5 && (
              <button className="link-blue add-ex" onClick={() => setExamples((e) => [...e, ""])}>
                <IcPlus s={15} /> 添加 <span className="muted">{examples.length}/5</span>
              </button>
            )}
          </SectionCard>

          {/* 关联知识库 */}
          <SectionCard
            icon={<SIcBook s={18} style={{ color: "var(--n-kb)" }} />}
            title="关联知识库"
            right={<span className="sec-count">{kbId ? "1 个已关联" : "未关联"}</span>}
          >
            <div className="sa-tip">
              <span className="row" style={{ gap: 8 }}>
                <span className="tip-dot">i</span>智能体可根据知识库内容回答问题
              </span>
            </div>
            {boundKb && (
              <div className="bound-skill">
                <span className="sk-ic" style={{ background: "#FFEAE4", width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center" }}>
                  <SIcBook s={17} style={{ color: "var(--n-kb)" }} />
                </span>
                <span className="bound-text" style={{ flex: 1, minWidth: 0 }}>
                  <b>{boundKb.name}</b>
                  <i style={{ display: "block", fontStyle: "normal", fontSize: 12.5, color: "var(--ink-3)" }}>
                    {boundKb.description || "知识库"}
                  </i>
                </span>
                <button className="df-ic icon-btn" onClick={() => setKbId(null)}>
                  <IcClose s={16} style={{ color: "var(--ink-3)" }} />
                </button>
              </div>
            )}
            <button className="dashed-btn" onClick={() => setPickKb(true)}>
              <IcPlus s={15} /> 添加知识库
            </button>
          </SectionCard>

          {/* 技能 */}
          <SectionCard
            icon={<SkIcTool s={18} style={{ color: "var(--primary)" }} />}
            title="技能"
            right={<span className="sec-count">{skillIds.length} 个已绑定</span>}
          >
            <div className="sa-sublbl" style={{ marginTop: 0 }}>
              已绑定技能 <span className="muted" style={{ fontWeight: 400 }}>· 来自技能库</span>
            </div>
            {skillIds.length === 0 && <div className="bound-empty">还没有绑定技能，从技能库添加工具或 SOP</div>}
            {skillIds.map((id) => {
              const sk = allSkills?.find((s) => s.id === id);
              return sk ? <BoundSkillRow key={id} skill={sk} onRemove={() => setSkillIds((s) => s.filter((x) => x !== id))} /> : null;
            })}
            <button className="dashed-btn" onClick={() => setPickSkill(true)}><IcPlus s={15} /> 添加技能</button>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>联网搜索、图片理解、长期记忆等基础能力已收敛为「内置技能」，在技能库中绑定即可。</div>
          </SectionCard>

          {/* 语音 */}
          <SectionCard
            icon={<SIcVoice s={18} style={{ color: "#16a34a" }} />}
            title="语音"
            defaultOpen={false}
            right={
              <button className="tg-wrap" onClick={(e) => { e.stopPropagation(); const v = !voiceOn; setVoiceOn(v); persistVoice({ enabled: v }); }}>
                <span className={"tg" + (voiceOn ? " on" : "")}><span className="tg-dot" /></span>
              </button>
            }
          >
            {!voiceOn ? (
              <div className="sa-tip"><span className="row" style={{ gap: 8 }}><span className="tip-dot">i</span>开启后可为智能体配置音色，用于语音通话 / 语音外呼；在右侧「预览」可切到语音直接拨打测试。</span></div>
            ) : (
              <>
                <div className="sa-sublbl" style={{ marginTop: 0 }}>音色 <span className="muted" style={{ fontWeight: 400 }}>· 来自音色库</span></div>
                {curVoice ? (
                  <div className="bound-skill">
                    <span className={"voice-av " + (curVoice.gender === "男" ? "male" : "female")} style={{ width: 34, height: 34 }}><SIcVoice s={17} /></span>
                    <span className="bound-text" style={{ flex: 1, minWidth: 0 }}>
                      <b>{curVoice.name}</b>
                      <i style={{ display: "block", fontStyle: "normal", fontSize: 12.5, color: "var(--ink-3)" }}>{curVoice.gender} · {curVoice.lang}</i>
                    </span>
                    <button className="df-ic icon-btn" onClick={() => setPickVoice(true)}>更换</button>
                  </div>
                ) : (
                  <button className="dashed-btn" onClick={() => setPickVoice(true)}><IcPlus s={15} /> 选择音色</button>
                )}
                <div className="sa-sublbl">语速 <span className="muted" style={{ fontWeight: 400 }}>· {voiceSpeed.toFixed(1)}x</span></div>
                <div className="row" style={{ gap: 10 }}>
                  <span className="muted" style={{ fontSize: 12 }}>慢</span>
                  <input type="range" min={0.8} max={2} step={0.1} value={voiceSpeed} style={{ flex: 1 }}
                    onChange={(e) => setVoiceSpeed(Number(e.target.value))}
                    onMouseUp={() => persistVoice({ speed: voiceSpeed })}
                    onTouchEnd={() => persistVoice({ speed: voiceSpeed })} />
                  <span className="muted" style={{ fontSize: 12 }}>快</span>
                </div>

                <div className="sa-sublbl">交互形式</div>
                <div className="seg">
                  <button className={"seg-btn" + (voiceMode === "call" ? " on" : "")} onClick={() => { setVoiceMode("call"); persistVoice({ mode: "call" }); }}>语音通话</button>
                  <button className={"seg-btn" + (voiceMode === "message" ? " on" : "")} onClick={() => { setVoiceMode("message"); persistVoice({ mode: "message" }); }}>语音消息</button>
                </div>
                <div className="sa-row-toggle">
                  <span><b>语音外呼</b><i>允许该智能体发起外呼任务</i></span>
                  <button className="tg-wrap" onClick={() => { const v = !outbound; setOutbound(v); persistVoice({ outbound: v }); }}><span className={"tg" + (outbound ? " on" : "")}><span className="tg-dot" /></span></button>
                </div>
                <div className="sa-row-toggle">
                  <span><b>打断响应</b><i>用户说话时可随时打断 AI 发音</i></span>
                  <button className="tg-wrap" onClick={() => { const v = !bargeIn; setBargeIn(v); persistVoice({ barge_in: v }); }}><span className={"tg" + (bargeIn ? " on" : "")}><span className="tg-dot" /></span></button>
                </div>
              </>
            )}
          </SectionCard>

          {/* 模型设置 */}
          <SectionCard
            icon={<SIcModel s={18} style={{ color: "var(--n-llm)" }} />}
            title="模型设置"
            defaultOpen={false}
            right={
              <button className="icon-btn">
                <SIcGear s={17} style={{ color: "var(--ink-3)" }} />
              </button>
            }
          >
            <select
              className="np-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {MODELS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <div className="sa-params">
              <span className="param-chip">温度 {params.temperature ?? 0.7}</span>
              <span className="param-chip">Top-P {params.top_p ?? 0.9}</span>
              <span className="param-chip">最大回复 {params.max_tokens ?? 1024}</span>
              <span className="link-blue" style={{ marginLeft: "auto" }}>
                调试参数
              </span>
            </div>
          </SectionCard>
        </div>

        {/* 右侧预览 */}
        <PreviewPanel
          bot={bot}
          avatar={botAvatar(bot)}
          welcome={welcome}
          examples={examples.filter(Boolean)}
        />

        {pickKb && (
          <KbPicker
            items={kbs ?? []}
            bound={kbId}
            onClose={() => setPickKb(false)}
            onConfirm={(id) => {
              setKbId(id);
              setPickKb(false);
            }}
          />
        )}
        {pickSkill && (
          <SkillPicker
            bound={skillIds}
            onClose={() => setPickSkill(false)}
            onConfirm={(ids) => { setSkillIds(ids); setPickSkill(false); }}
          />
        )}
        {pickVoice && (
          <VoicePicker
            value={voiceId}
            onClose={() => setPickVoice(false)}
            onConfirm={(id) => { setVoiceId(id); persistVoice({ voice_id: id }); }}
          />
        )}
      </div>
    );
  },
);

/* ---------- 知识库选择器 ---------- */
function KbPicker({
  items,
  bound,
  onClose,
  onConfirm,
}: {
  items: { id: string; name: string; description: string }[];
  bound: string | null;
  onClose: () => void;
  onConfirm: (id: string | null) => void;
}) {
  const [sel, setSel] = useState<string | null>(bound);
  return (
    <RkModal
      title="添加知识库"
      w={540}
      onClose={onClose}
      footer={
        <>
          <button className="btn-text" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={() => onConfirm(sel)}>
            确定
          </button>
        </>
      }
    >
      <div className="kb-list">
        {items.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>还没有知识库，去「知识库」创建一个。</p>
        )}
        {items.map((k) => (
          <button
            key={k.id}
            className={"kb-item" + (sel === k.id ? " sel" : "")}
            style={{ textAlign: "left", width: "100%", display: "flex", gap: 11, alignItems: "center" }}
            onClick={() => setSel(sel === k.id ? null : k.id)}
          >
            <span className="sk-ic" style={{ background: "#FFEAE4", width: 38, height: 38, borderRadius: 9, display: "grid", placeItems: "center", flex: "none" }}>
              <SIcBook s={19} style={{ color: "var(--n-kb)" }} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontWeight: 600, fontSize: 14.5 }}>{k.name}</b>
              <i style={{ display: "block", fontStyle: "normal", fontSize: 12.5, color: "var(--ink-3)" }}>
                {k.description || "知识库"}
              </i>
            </span>
          </button>
        ))}
      </div>
    </RkModal>
  );
}

/* ============================ 右侧预览（.sa-right） ============================ */
interface ToolStep { kind: string; name?: string; args?: unknown; output?: string }
interface AgentTrace { system_prompt?: string; variables?: Record<string, string>; tools?: string[]; tool_steps?: ToolStep[]; model?: string }
interface PvMsg {
  id: string;
  who: "me" | "bot";
  text: string;
  trace?: AgentTrace;
}

const jstr = (o: unknown) => { try { return JSON.stringify(o, null, 2); } catch { return String(o); } };

function AgentRunTrace({ trace }: { trace: AgentTrace }) {
  const [open, setOpen] = useState(false);
  const steps = trace.tool_steps || [];
  return (
    <div className="run-steps" style={{ marginTop: 8 }}>
      <button className="run-head" onClick={() => setOpen((o) => !o)}>
        <span className="row" style={{ gap: 8 }}>运行过程<span className="run-sum">{trace.tools?.length ? `${trace.tools.length} 个工具` : "无工具"}{steps.length ? ` · ${steps.filter((s) => s.kind === "tool_call").length} 次调用` : ""}</span></span>
        {open ? <IcChevUp s={18} style={{ color: "var(--ink-3)" }} /> : <IcChevDown s={18} style={{ color: "var(--ink-3)" }} />}
      </button>
      {open && (
        <div className="run-list fade-in" style={{ padding: 4 }}>
          {trace.tools && trace.tools.length > 0 && (
            <div className="rd-block"><div className="rd-cap">可用工具</div><div className="rd-chips">{trace.tools.map((t) => <span key={t} className="rd-chip">{t}</span>)}</div></div>
          )}
          {steps.length > 0 && (
            <div className="rd-block"><div className="rd-cap">工具调用</div>
              {steps.map((s, i) => (
                <div key={i} className={"rd-eval" + (s.kind === "tool_result" ? " on" : "")}>
                  <div className="rd-eval-head">{s.kind === "tool_call" ? `→ 调用 ${s.name}` : `← ${s.name} 返回`}</div>
                  <pre className="rd-json">{s.kind === "tool_call" ? jstr(s.args) : (s.output || "（空）")}</pre>
                </div>
              ))}
            </div>
          )}
          {trace.variables && Object.keys(trace.variables).length > 0 && (
            <div className="rd-block"><div className="rd-cap">变量快照 (JSON)</div><pre className="rd-json">{jstr(trace.variables)}</pre></div>
          )}
          <div className="rd-block"><div className="rd-cap">注入后的系统提示词</div><pre className="rd-json" style={{ whiteSpace: "pre-wrap" }}>{trace.system_prompt || "（空）"}</pre></div>
        </div>
      )}
    </div>
  );
}

function PreviewPanel({
  bot,
  avatar,
  welcome,
  examples,
}: {
  bot: BotOut;
  avatar: string;
  welcome: string;
  examples: string[];
}) {
  const [msgs, setMsgs] = useState<PvMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const convId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lsKey = "rk-sa-conv-" + bot.id;
  const varKey = "rk-sa-vars-" + bot.id;

  // 文字 / 语音 预览切换
  const vcfg = (bot.voice_config ?? {}) as { enabled?: boolean; voice_id?: string | null; speed?: number };
  const [mode, setMode] = useState<"text" | "voice">("text");
  const { data: allVoices } = useVoices();
  const previewVoice = voiceById(allVoices, vcfg.voice_id);
  // 语音转写同步进主对话线程（带「通话中…/语音 mm:ss」标签）
  const [voiceMsgs, setVoiceMsgs] = useState<VoiceTurn[]>([]);
  const [voiceLive, setVoiceLive] = useState(false);
  const [voiceDur, setVoiceDur] = useState("");
  const voiceTag = voiceLive ? "通话中…" : "语音 " + voiceDur;
  const started = msgs.length > 0 || voiceMsgs.length > 0;

  // 会话变量（仅 session 作用域），用于调试时带入（如猎头场景的 candidate_id）
  const sessionVars = ((bot.variables as { name: string; scope: string; label?: string }[]) ?? []).filter(
    (v) => v.scope === "session",
  );
  const [varVals, setVarVals] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem(varKey) || "{}"); } catch { return {}; }
  });
  const setVar = (name: string, value: string) =>
    setVarVals((s) => { const next = { ...s, [name]: value }; if (typeof window !== "undefined") localStorage.setItem(varKey, JSON.stringify(next)); return next; });

  // 开场白预览里的 {{变量}} 用已填的调试值替换（未填则留空，不显示原始代码）
  const renderWelcome = (text: string) =>
    text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k: string) => {
      const key = k.trim().replace(/^session\./, "");
      return varVals[key] ?? varVals[k.trim()] ?? "";
    });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs]);

  // 重新进入时恢复上次调试会话（持久化 convId + 重载消息含运行过程）
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(lsKey) : null;
    if (!saved) return;
    convId.current = saved;
    (async () => {
      const { data, error } = await api.GET("/api/v1/conversations/{conv_id}/messages", { params: { path: { conv_id: saved }, query: { page_size: 100 } } });
      if (error || !data) { convId.current = null; localStorage.removeItem(lsKey); return; }
      setMsgs(data.data.filter((m) => m.role !== "system").map((m) => {
        const meta = (m.meta || {}) as { agent_trace?: AgentTrace };
        return { id: m.id, who: m.role === "user" ? "me" as const : "bot" as const, text: m.content, trace: meta.agent_trace };
      }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureConv = async (): Promise<string> => {
    if (convId.current) return convId.current;
    const variables: Record<string, string> = {};
    for (const v of sessionVars) if (varVals[v.name]?.trim()) variables[v.name] = varVals[v.name].trim();
    const { data, error } = await api.POST("/api/v1/bots/{bot_id}/conversations", {
      params: { path: { bot_id: bot.id } },
      body: { title: "调试会话", variables },
    });
    if (error) throw error;
    convId.current = data.data.id;
    if (typeof window !== "undefined") localStorage.setItem(lsKey, data.data.id);
    return data.data.id;
  };

  async function ask(text?: string) {
    const q = (text ?? input).trim();
    if (!q || streaming) return;
    setInput("");
    setMsgs((m) => [...m, { id: crypto.randomUUID(), who: "me", text: q }]);
    const aid = crypto.randomUUID();
    setMsgs((m) => [...m, { id: aid, who: "bot", text: "" }]);
    setStreaming(true);
    try {
      const cid = await ensureConv();
      await streamCompletion(cid, q, (delta) => {
        setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, text: x.text + delta } : x)));
      }, (e) => {
        if (e.type === "agent_trace") {
          const tr = e as unknown as AgentTrace;
          setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, trace: tr } : x)));
        }
      });
    } catch {
      setMsgs((m) =>
        m.map((x) => (x.id === aid ? { ...x, text: x.text || "（生成失败，请检查后端配置）" } : x)),
      );
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="sa-right">
      <div className="sa-prev-head">
        <span className="row" style={{ gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatar} alt="" />
          <b>{bot.name}</b>
        </span>
        <span className="row" style={{ gap: 16 }}>
          {vcfg.enabled && (
            <span className="pv-mode">
              <button className={"pv-mode-btn" + (mode === "text" ? " on" : "")} onClick={() => setMode("text")}>文字</button>
              <button className={"pv-mode-btn" + (mode === "voice" ? " on" : "")} onClick={() => setMode("voice")}>语音</button>
            </span>
          )}
          {mode === "text" && started && (
            <button
              className="link-muted row"
              style={{ gap: 6, background: "none", border: "none", cursor: "pointer" }}
              onClick={() => {
                convId.current = null;
                setMsgs([]);
                if (typeof window !== "undefined") localStorage.removeItem(lsKey);
              }}
            >
              清空对话
            </button>
          )}
          <span className="link-muted row" style={{ gap: 6 }}>
            <SIcGear s={16} /> 调试参数
          </span>
        </span>
      </div>

      <div className="sa-prev-scroll" ref={scrollRef}>
        {!started ? (
          <div className="sa-welcome">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sa-w-avatar" src={avatar} alt="" />
            <h3>{bot.name}</h3>
            {welcome.trim() ? (
              <div className="sa-w-card">{renderWelcome(welcome)}</div>
            ) : (
              <div className="sa-w-card empty">还没有设置开场白，可在左侧「开场白」中配置</div>
            )}
            {mode === "voice" ? (
              <div className="sa-voice-hint">
                <SIcVoice s={15} style={{ color: "var(--primary)" }} /> 语音模式 · 当前音色「{previewVoice?.name || "未选择"}」，点击下方拨打测试
              </div>
            ) : (
              <div className="sa-chips">
                {examples.map((q, i) => (
                  <button key={i} className="sa-chip" onClick={() => ask(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            {sessionVars.length > 0 && (
              <div className="sa-debugvars">
                <div className="sa-debugvars-lbl">调试会话变量（发首条消息时带入）</div>
                {sessionVars.map((v) => (
                  <div className="sa-debugvar-row" key={v.name}>
                    <code title={`{{session.${v.name}}}`}>{v.label?.trim() || v.name}</code>
                    <input
                      value={varVals[v.name] ?? ""}
                      placeholder="输入测试值"
                      onChange={(e) => setVar(v.name, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="sa-thread">
            {/* 开场白作为会话首条消息常驻（仅文字模式；语音通话有自己的开场，避免重复问候） */}
            {welcome.trim() && mode === "text" && (
              <div className="sa-msg bot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={avatar} alt="" />
                <div className="sa-bubble bot">{renderWelcome(welcome)}</div>
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={"sa-msg " + m.who}>
                {m.who === "bot" && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={avatar} alt="" />
                )}
                {m.who === "bot" ? (
                  <div style={{ maxWidth: 560, minWidth: 0 }}>
                    <div className="sa-bubble bot">{m.text ? <Markdown>{m.text}</Markdown> : <span className="pv-typing"><i /><i /><i /></span>}</div>
                    {m.trace && <AgentRunTrace trace={m.trace} />}
                  </div>
                ) : (
                  <div className="sa-bubble me">{m.text}</div>
                )}
              </div>
            ))}
            {/* 语音转写：实时同步进主线程（带语音标签） */}
            {voiceMsgs.map((m, i) => (
              <div key={"v" + i} className={"sa-msg " + m.who}>
                {m.who === "bot" && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={avatar} alt="" />
                )}
                <div className={"sa-bubble " + m.who}>
                  <span className="sa-voice-tag"><SIcVoice s={12} style={{ color: "currentColor" }} /> {voiceTag}</span>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {mode === "voice" ? (
        <VoiceCallUI
          bar="sa"
          onTurns={(t) => { setVoiceMsgs(t); setVoiceLive(true); }}
          onEnded={(s) => { setVoiceLive(false); setVoiceDur(`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`); }}
          botId={bot.id}
          voice={previewVoice?.provider_voice ?? ""}
          voiceResource={previewVoice?.provider_resource}
          voiceSpeed={vcfg.speed ?? 1.0}
          voiceName={previewVoice?.name ?? ""}
          agentName={bot.name}
          agentImg={avatar}
          callVars={{
            name: varVals["cand_name"] || varVals["name"] || undefined,
            runke_vars: Object.fromEntries(
              sessionVars.map((v) => [v.name, varVals[v.name]?.trim()]).filter(([, val]) => !!val) as [string, string][],
            ),
          }}
        />
      ) : (
        <div className="sa-prev-input">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={12000}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder="请输入你的问题。"
          />
          <div className="sa-input-foot">
            <span className="row" style={{ gap: 12 }}>
              <SIcImage s={19} style={{ color: "var(--ink-3)" }} />
              <SIcFolder s={19} style={{ color: "var(--ink-3)" }} />
            </span>
            <span className="row" style={{ gap: 12 }}>
              <span className="muted" style={{ fontSize: 13 }}>{input.length}/12000</span>
              <button className={"sa-send" + (input.trim() ? " on" : "")} onClick={() => ask()}>
                <IcSend s={17} style={{ color: input.trim() ? "#fff" : "var(--ink-4)" }} />
              </button>
            </span>
          </div>
        </div>
      )}
      <div className="sa-disclaimer">
        AI 生成仅供参考。当前为应用调试环境，发布后点击体验链接即可体验发布环境效果。
      </div>
    </div>
  );
}
