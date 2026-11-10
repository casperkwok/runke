# Runke 智能体平台 — OKR 与项目拆解

> 状态：**已对齐（2026-06-06）**。MVP 范围锁定 **P0–P3**；Objective 优先级 **O1 → O2 → O3**。
> 配套文档：架构见 `ARCHITECTURE.md`，学习路径见 `LEARNING.md`。
> 周期：2026 Q3。当前聚焦 **MVP（P0–P3）**，O3/前端与 P4–P7 列为 MVP 后续。
>
> **进度（2026-06-06）：MVP P0–P3 完成 ✅，并已加做 P4 Workflow ✅** — 骨架/鉴权/CRUD/单 Agent 流式(DeepSeek V4)/RAG+Agentic RAG/Workflow 条件编排 均真实跑通。
> **Objective 2 全部 KR（2.1 单 Agent / 2.2 Workflow / 2.3 RAG）已达成。** 后端 KR1.1 达成、KR1.2 进行中。O3 前端基座+端到端+Workflow可视化编排(KR3.2)已达成。剩余可选: P5 CRM / P6 数据迁移 / 闭环打磨。
>
> **进度（2026-06-12）：KR2.2 / KR3.2 代际超额 —— 「AI 编排」成为唯一工作流编辑器**（分支 `worktree-wf-exp-copilot`）：
> Claude Code 式 agent 工具循环（edit_graph/run_preview/manage_variables/set_plan）+ SSE 过程直播（计划卡/工具状态条/逐轮自测直播/画布点亮），
> 一句话建图、AI 自测自修（实测从全挂默认分支自主修复至全通过）、AI 自管变量；精简卡画布（自动布局+拖拽/连线/侧边栏微调，点选=AI 上下文）；
> 图 lint 确定性护栏（分支连线/断头/不可达/reply 滥用/llm+cond 冒充意图/命名硬约束）。旧编辑器删除，图回归 workflow_definition（含实验图提升迁移），
> 存量 pet_doctor 24 节点状态机实测零回归。期间已完成 P5 CRM/全局配置/聊天管家/网站集成/语音集成。
> KR1.2 视为基本达成（全线 REST + OpenAPI typed client）。**剩余欠账：KR1.3/P6 数据迁移未动**；
> 备注：KR2.2 实现为自研引擎（`app/workflows/engine.py`，跨轮状态机），未用 LangGraph——目标实质达成，措辞与实现有偏差，特此记账。
> 下一步候选：AI 编排 golden 评测集（防规范回归）/ 编排模式库（Skill 思想领域化）/ P6 数据迁移。

---

## 北极星

把 `blurr + BlurrPro + leadgen` 三个零散旧项目，重构为**一个干净、统一、可演进的智能体平台**：
统一 Python 后端（FastAPI + PostgreSQL）+ 全新前端，**同时支持单 Agent 编排与 Workflow 编排**，
对外 RESTful，RAG 内嵌（LlamaIndex + pgvector）。

---

## Objective 1 — 交付统一后端，替代三个旧项目

| KR | 指标 | 目标 |
|---|---|---|
| KR1.1 | 后端骨架可运行（P0+P1） | `docker compose up` 起 app+postgres+redis，`/health` 通，登录+bot/会话 RESTful CRUD 跑通 |
| KR1.2 | 接口 RESTful 化 | 旧 `/api/v1/*` 驼峰动词接口 100% 以资源式 REST 重建，后端导出 OpenAPI |
| KR1.3 | 数据层统一 | MySQL/Mongo/Supabase → PostgreSQL(+pgvector)+Redis；历史数据迁移脚本完成并通过行数/抽样校验 |

## Objective 2 — 建成「单 Agent + Workflow」双机制智能体平台

| KR | 指标 | 目标 |
|---|---|---|
| KR2.1 | 单 Agent 运行时 | AgentRuntime（model+harness）跑通，流式 `runs` SSE，迁移 ≥2 个预置 agent（pet_doctor 等） |
| KR2.2 | Workflow 引擎 | 基于 LangGraph StateGraph，跑通 ≥1 个含 agent/工具/分支节点的多节点 workflow |
| KR2.3 | RAG 接入 | LlamaIndex+pgvector 落地，知识库支持 vector/graph/hybrid 模式，agent `rag_search` 工具可用 |

## Objective 3 — 前端重做并端到端打通

| KR | 指标 | 目标 |
|---|---|---|
| KR3.1 | 前端基座 | Next.js(App Router)+TanStack Query+OpenAPI typed client，登录与核心页面 |
| KR3.2 | Workflow 可视化 | 节点拖拽编排 + 运行观测（SSE 事件流） |
| KR3.3 | 端到端 Demo | 登录 → 建 bot → 挂知识库 → 单 agent 对话 → 跑一个 workflow，全链路通 |

---

## 项目拆解（里程碑 ↔ KR）

| 阶段 | 内容 | 对应 KR |
|---|---|---|
| **P0** 骨架 | 新仓库、pyproject(uv)、Docker(pg+redis)、config、/health、OpenAPI 导出 | KR1.1 |
| **P1** 鉴权+核心 | JWT auth、bots、conversations、messages（RESTful） | KR1.1 KR1.2 |
| **P2** 单 Agent | AgentRuntime、tools、runs+SSE、预置 agent 迁移 | KR2.1 |
| **P3** RAG | LlamaIndex+pgvector、knowledge-bases/documents、rag_search | KR2.3 |
| **P4** Workflow | StateGraph 引擎、节点类型、workflow CRUD+运行 | KR2.2 |
| **P5** CRM/周边 | customers、employees、leads、insights | KR1.2 |
| **P6** 数据迁移 | legacy → Postgres 迁移 + 校验 | KR1.3 |
| **P7** 前端 | 信息架构重做、typed client、workflow 可视化 | KR3.* |

---

## 已对齐结论（2026-06-06）
1. **节奏**：先锁 **MVP = P0–P3**（骨架 + 鉴权 + bot/会话 + 单 Agent 对话 + RAG）。P4–P7 列为 MVP 后续。
2. **优先级**：**O1 → O2 → O3**（先后端基座，再智能体平台，最后前端）。
3. **MVP 可演示边界**：登录 → 建 bot → 挂一个知识库 → 单 agent 流式对话跑通。
4. **度量**：MVP 阶段以「**跑通**」为准，量化指标（延迟/召回）放到 MVP 之后。

## MVP 后续（暂缓，不在本期）
- O2 的 KR2.2（Workflow 引擎，P4）
- O3 前端全部（P7）、Workflow 可视化
- P5 CRM/周边、P6 数据迁移
