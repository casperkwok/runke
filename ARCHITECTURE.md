# Runke 智能体平台 — 前后端统一架构设计

> 本文档是 `blurr` + `BlurrPro` + `leadgen` 三个旧项目的**统一重构方案**。
> 目标：一个干净的全新 Python 后端 + 全新前端，构成一个**支持单 Agent 编排与 Workflow 编排**的智能体平台。
> 旧项目（blurr / BlurrPro / leadgen）是内部历史参考，本仓库未包含其代码；文中涉及 `legacy/` 与数据迁移的章节仅保留设计记录。

---

## 1. 设计目标与原则

1. **干净重写**：不沿用旧代码结构，只迁移业务语义。统一技术栈、统一数据层。
2. **RESTful 规范**：抛弃旧的 `/api/v1/bot/getEnterpriseBots` 驼峰动词式接口，改为资源化 REST。
3. **统一数据层**：MySQL + MongoDB + Supabase 三套 → **PostgreSQL（含 pgvector）+ Redis**。
4. **智能体平台双机制**：同时支持
   - **单 Agent 编排**（autonomous agent，`agent = model + harness`）
   - **Workflow 编排**（显式 DAG/状态图，节点可含 agent、工具、条件分支）
5. **面向未来的 Agent 抽象**：单 Agent 不写死成「一个 prompt + 一次调用」，而是 `model + harness（工具循环/记忆/中断恢复）`，便于演进到 multi-agent、长任务、人审介入。
6. **MIT 友好**：RAG 选 MIT 许可的 LlamaIndex，避免引入重型外部服务。

---

## 2. 技术栈总览

### 后端 `runke-backend`
| 关注点 | 选型 | 说明 |
|---|---|---|
| Web 框架 | **FastAPI** | 保留团队熟悉度；async 全链路 |
| ORM | **SQLAlchemy 2.0 (async) + asyncpg** | 统一访问 Postgres |
| 迁移 | **Alembic** | schema 版本化 |
| 校验/DTO | **Pydantic v2** | request/response schema |
| 配置 | **pydantic-settings** | `.env` 驱动，类型安全 |
| 缓存/会话 | **Redis** | 会话、限流、缓存 |
| 数据库 | **PostgreSQL 16 + pgvector** | 业务数据 + 向量数据共库 |
| Agent 编排 | **LangGraph** | 单 agent 与 workflow 的统一底座（见 §5） |
| LLM SDK | **langchain-openai / -anthropic** 等 provider 适配 | 仅作 model 接入层，不用旧 chains |
| RAG | **LlamaIndex（MIT）+ pgvector** | 内嵌库，非外部服务（见 §6） |
| 包管理 | **uv**（或 poetry） | `pyproject.toml` 单一依赖源 |
| 部署 | **Docker Compose**：app + postgres(pgvector) + redis | |

> **关于 LangChain vs LangGraph（重要）**：旧 `leadgen` 用的是 langchain 0.1 的 chains/AgentExecutor，已是遗留范式。新平台**以 LangGraph 为编排底座**：
> - 单 Agent = LangGraph 预置的 ReAct 风格 agent（`model + tools` 的循环 harness）。
> - Workflow = LangGraph `StateGraph` 自定义节点图。
> - `langchain` 仅作为 model/tool 的轻量适配层使用，不再用其 chain 抽象。

### 前端 `runke-frontend`
| 关注点 | 选型 | 说明 |
|---|---|---|
| 框架 | **Next.js (App Router) + TypeScript** | 沿用团队栈，重做信息架构 |
| 数据请求 | **TanStack Query**（替代裸 SWR + fetch） | 统一缓存/重试/失效 |
| UI | **shadcn/ui + Tailwind** | 与旧 blurr 一致，去掉 antd 混用 |
| 状态 | **Zustand** | 轻量客户端状态 |
| 接口客户端 | **OpenAPI 生成的 typed client** | 后端导出 OpenAPI → 前端类型自动同步 |
| 鉴权 | Bearer JWT（替代旧 `X-AUTH-TOKEN`） | |

> 前后端通过**后端自动生成的 OpenAPI schema** 对齐，前端 API 类型由 schema codegen，杜绝手写漂移。

---

## 3. 系统分层与目录结构

```
runke-backend/
├── app/
│   ├── main.py                  # 装配 FastAPI：路由、中间件、异常、OpenAPI
│   ├── core/
│   │   ├── config.py            # pydantic-settings
│   │   ├── security.py          # JWT、密码哈希、依赖注入式鉴权
│   │   ├── logging.py
│   │   ├── db.py                # async engine / session
│   │   └── redis.py
│   ├── api/v1/                  # 路由层（RESTful，见 §4）
│   │   ├── auth.py  bots.py  conversations.py  messages.py
│   │   ├── customers.py  employees.py  leads.py
│   │   ├── knowledge_bases.py  documents.py
│   │   ├── agents.py  workflows.py  runs.py        # 智能体平台核心
│   │   └── deps.py              # 公共依赖（当前用户、分页等）
│   ├── schemas/                 # Pydantic DTO（与 ORM 解耦）
│   ├── models/                  # SQLAlchemy ORM
│   ├── repositories/            # 数据访问层（CRUD，隔离 SQL）
│   ├── services/                # 业务逻辑（编排 repo + agent + rag）
│   ├── agents/                  # 智能体运行时（见 §5）
│   │   ├── runtime.py           # AgentRuntime：model + harness
│   │   ├── harness.py           # 工具循环、记忆、中断/恢复
│   │   ├── tools/               # 可注册工具（rag_search、crm_lookup…）
│   │   ├── models.py            # LLM provider 适配（openai/anthropic/deepseek）
│   │   └── presets/             # 预置 agent（pet_doctor、lead_qualifier…）
│   ├── workflows/               # Workflow 引擎（见 §5）
│   │   ├── engine.py            # 基于 LangGraph StateGraph 的执行器
│   │   ├── nodes/               # 节点类型：agent / tool / branch / human / rag
│   │   └── registry.py          # workflow 定义注册与加载
│   ├── rag/                     # RAG 模块（见 §6）
│   │   ├── provider.py          # RAGProvider 抽象接口
│   │   ├── llamaindex_pgvector.py
│   │   ├── ingest.py            # 文档解析/分块/embedding 入库
│   │   └── retrieve.py
│   └── integrations/            # OSS、第三方 API、外部 LLM 网关
├── alembic/                     # 迁移脚本
├── scripts/
│   └── migrate_legacy/          # MySQL/Mongo → Postgres 迁移脚本（附录 B）
├── tests/
├── pyproject.toml
├── docker-compose.yml
└── .env.example

runke-frontend/
├── app/
│   ├── (auth)/                  # 登录
│   ├── (dashboard)/
│   │   ├── bots/                # bot 管理
│   │   ├── conversations/       # 会话/消息
│   │   ├── agents/              # 单 agent 配置与调试
│   │   ├── workflows/           # workflow 可视化编排
│   │   ├── knowledge/           # 知识库 + 文档
│   │   ├── customers/ leads/    # CRM
│   │   └── insights/            # 统计
│   └── api/                     # 仅 BFF（如文件直传），业务一律走后端
├── lib/
│   ├── api/                     # OpenAPI 生成的 typed client
│   └── query/                   # TanStack Query hooks
├── components/ (shadcn/ui)
└── store/ (zustand)
```

**分层依赖方向**：`api → services → {repositories, agents, workflows, rag} → models/integrations`。
路由层只做 I/O 与校验，业务逻辑全在 services，数据访问全在 repositories。

---

## 4. RESTful API 设计（替代旧驼峰动词接口）

原则：资源名词复数 + HTTP 动词表达操作 + 嵌套表达从属 + 统一信封。

### 4.1 统一响应信封
```jsonc
// 成功
{ "data": { ... }, "meta": { "page": 1, "total": 42 } }
// 错误
{ "error": { "code": "BOT_NOT_FOUND", "message": "...", "details": {} } }
```

### 4.2 鉴权
- `POST /api/v1/auth/login` → `{ access_token, refresh_token }`
- `POST /api/v1/auth/refresh`
- 之后所有请求 `Authorization: Bearer <jwt>`（替代旧 `X-AUTH-TOKEN`）

### 4.3 核心资源端点（节选）
| 资源 | 方法 + 路径 | 取代旧接口 |
|---|---|---|
| Bots | `GET /bots`、`POST /bots`、`GET /bots/{id}`、`PATCH /bots/{id}`、`DELETE /bots/{id}` | `getEnterpriseBots` / `createBot` / `getDetail` / `delBot` |
| Bot 配置 | `PATCH /bots/{id}`（welcome/industry/knowledge 作为字段） | `botSettingWelcome` / `botSettingIndustry` / `botSettingKnowledge` |
| Conversations | `GET /bots/{id}/conversations`、`GET /conversations/{id}` | `chats/getList` / `getChatDetail` |
| Messages | `GET /conversations/{id}/messages`、`POST /conversations/{id}/messages` | `chats/getChatMessage` |
| Completion | `POST /conversations/{id}/completions`（含 `?stream=true` SSE） | `completion/chatTest` / `chat` / `sendMessage` |
| Knowledge Bases | `GET/POST /knowledge-bases`、`/knowledge-bases/{id}` | `knowledgebase/*` |
| Documents | `POST /knowledge-bases/{id}/documents`、`DELETE /documents/{id}` | KB upload/delete files |
| RAG 查询 | `POST /knowledge-bases/{id}/queries` | `rag/*` / `local_doc_query` |
| Customers | `GET/POST/PATCH/DELETE /customers` | `customer/*` |
| Employees | `GET/POST/PATCH/DELETE /employees` | `employee/*` |
| Leads | `GET /leads`、`POST /leads/searches`（生成检索任务） | leadgen `lead/*` |
| **Agents** | `GET/POST /agents`、`/agents/{id}`、`POST /agents/{id}/runs` | leadgen agent 编排 |
| **Workflows** | `GET/POST /workflows`、`/workflows/{id}`、`POST /workflows/{id}/runs` | chat workflow |
| **Runs** | `GET /runs/{id}`、`GET /runs/{id}/events`（SSE 流式） | — |

> 命名从「动词式」改为「资源式」是本次最大的对外变更，前端随之重写 API 层（用 OpenAPI codegen，低成本）。

---

## 5. 智能体平台核心：单 Agent 编排 + Workflow 编排

两种机制**共享同一运行时与持久化层（LangGraph + Postgres checkpointer）**，只是「图的来源」不同。

### 5.1 Agent = Model + Harness（单 Agent）
采用当前主流范式：**一个 agent 不是一段 prompt，而是 `模型 + 运行外壳`**。

```
AgentRuntime
├── model        # 可插拔 LLM（openai/anthropic/deepseek/…）
├── tools        # 注册的工具集（rag_search, crm_lookup, http_call, …）
├── memory       # 短期(会话上下文) + 长期(向量/结构化记忆)
├── policy       # system 提示、约束、停止条件、最大步数
└── harness      # ReAct 循环：think→act(tool)→observe→…，含
                 #   - 中断/恢复（checkpoint，支持 human-in-the-loop）
                 #   - 流式事件（runs/{id}/events）
                 #   - 可观测（每步 trace）
```

- 用 **LangGraph 预置 ReAct agent** 作为 harness 实现，model 与 tools 注入。
- **可拓展性**：未来要 multi-agent，只需把「一个 agent」当作 workflow 里的一个节点；要长任务/人审，复用 checkpoint 中断机制；要换范式（plan-execute、reflexion），只替换 harness 策略，对外接口不变。

### 5.2 Workflow 编排（显式图）
- 基于 **LangGraph `StateGraph`**：节点 = `{agent | tool | branch | human | rag | code}`，边 = 数据流 + 条件路由。
- Workflow 定义以 **JSON/YAML 持久化在 Postgres**，前端提供**可视化编排**（节点拖拽），后端 `workflows/engine.py` 加载并执行。
- 一个 workflow 节点可以**内嵌一个单 Agent**，于是两套机制天然组合：简单场景用单 agent，复杂业务用 workflow 串多个 agent/工具。

### 5.3 运行与流式
- 触发：`POST /agents/{id}/runs` 或 `POST /workflows/{id}/runs` → 返回 `run_id`。
- 观测：`GET /runs/{id}/events`（SSE），逐步推送 think/tool/output 事件。
- 持久化：LangGraph checkpointer 写 Postgres，支持断点恢复与审计。

---

## 6. RAG 模块（LlamaIndex 为底座 + pgvector，MIT）

> 这是**智能体平台的检索层**，不是简单 QA 知识库。它要同时支撑：向量召回、图谱/关系召回、结构化查询、多文档子问题分解，以及被 agent 迭代驱动的 **Agentic RAG**。因此选型标准是「**检索框架的灵活度**」，而非「单一更强的检索方法」。

### 6.1 为什么是 LlamaIndex（而非 LightRAG）
- **框架 vs 单一方法**：LlamaIndex 是 MIT 的通用检索框架，提供向量、**原生知识图谱（`PropertyGraphIndex`）**、SQL/结构化、子问题分解、混合检索等多种可插拔策略。LightRAG 只是「graph+vector」的一种固定方法——把它当底座会锁死后续对 SQL/CRM 数据、子问题分解等的扩展。
- **图谱能力 LlamaIndex 自带**：本问题不是「向量 vs 图谱」，而是「含图谱能力的框架 vs 单一图谱方法」。需要实体关系/多跳召回时用 `PropertyGraphIndex` 即可，且能与向量索引、pgvector 混用。
- **契合 `agent = model + harness`**：多跳/关联推理交给 **harness 迭代调用 `rag_search`（Agentic RAG）**，由 agent 自主决定追问与换向，比把推理压进检索器内部更灵活、可控，也不与 agent 编排能力重叠。
- **运维/成本**：LlamaIndex 普通向量入库快而省；图谱抽取按需开启在特定知识库，而非全量强制（LightRAG 每文档多次 LLM 抽取，入库慢且贵）。

### 6.2 设计
- **库内嵌**：LlamaIndex 作为库嵌入后端，向量存储用 **pgvector**——与业务数据共库，彻底甩掉外部 Go KB / QAnything 服务。
- **抽象**：`rag/provider.py` 定义 `RAGProvider`（`ingest()/retrieve()/query()`）。默认实现 `llamaindex_pgvector.py`（向量 + 可选 `PropertyGraphIndex`）。
- **每个知识库可配检索模式**：`vector` / `graph` / `hybrid`，按知识形态选择，而非全局一刀切。
- **可选 provider**：若某知识库需要极致图谱效果，可挂 **LightRAG（同 MIT）** 作为额外 provider，上层 `rag_search` 工具无感。
- **流程**：文档上传 → `ingest`（解析→分块→embedding[→按需实体/关系抽取]→写 pgvector）→ 查询时按知识库模式 `retrieve` → 交给 agent 的 `rag_search` 工具或 `POST /knowledge-bases/{id}/queries`。
- **作为 Agent 工具**：RAG 以 `rag_search` 工具注册进 AgentRuntime，单 agent / workflow 节点均可调用，支撑 Agentic RAG 的多轮检索。

---

## 7. 数据层：统一到 PostgreSQL + Redis

| 旧来源 | 旧内容 | 新归宿 |
|---|---|---|
| MySQL (BlurrPro) | bot、chat、customer、employee、user、industry、label… | Postgres 关系表 |
| MongoDB (leadgen) | 会话历史、agent 记忆、半结构化文档 | Postgres **JSONB** 列 / 专表 |
| Supabase (leadgen) | customers、tags、search_querys | Postgres 表（Supabase 本就是 Postgres，平迁） |
| 外部向量库/Go KB | 知识库向量 | Postgres **pgvector** |
| Redis (两者) | 缓存、会话 | Redis（保留） |

核心实体（简表）：`users / employees`、`bots`、`conversations / messages`、`customers / leads / tags`、`knowledge_bases / documents / chunks(vector)`、`agents`、`workflows`、`runs / run_events`。

迁移脚本置于 `scripts/migrate_legacy/`，详见附录 B。

---

## 8. 实施路线图（每阶段可独立跑通）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 骨架** | 新仓库、pyproject、Docker(postgres+redis)、config、健康检查、OpenAPI 导出 | `docker compose up` 起得来，`/health` 通 |
| **P1 鉴权+核心** | auth(JWT)、bots、conversations、messages（RESTful） | 前端能登录、CRUD bot、看会话 |
| **P2 智能体运行时** | AgentRuntime(model+harness)、tools、runs + SSE，迁移 pet_doctor 等预置 agent | 单 agent 对话流式跑通 |
| **P3 RAG** | LlamaIndex+pgvector、knowledge-bases/documents、rag_search 工具 | 上传文档→带知识库问答 |
| **P4 Workflow** | StateGraph 引擎、节点类型、workflow CRUD + 运行 | 简单多节点 workflow 跑通 |
| **P5 CRM/周边** | customers、employees、leads、insights | 业务面板完整 |
| **P6 数据迁移** | legacy → Postgres 迁移脚本 + 校验 | 历史数据可用 |
| **P7 前端** | Next.js 重做信息架构、TanStack Query、OpenAPI client、workflow 可视化编排 | 端到端 |

---

## 附录 A：旧 → 新 迁移映射（端点级）
> 详见 §4.3 表格；agent/workflow 语义来自 `legacy/leadgen`，业务 CRUD 来自 `legacy/BlurrPro`，前端交互参考 `legacy/blurr`。

## 附录 B：legacy 数据迁移
- BlurrPro MySQL：用 `scripts/migrate_legacy/mysql_to_pg.py`，按实体表逐表搬迁 + 类型映射。
- leadgen Mongo/Supabase：会话与记忆转 JSONB；Supabase 表直连 pg dump/restore。
- 校验：行数比对 + 抽样字段比对。

## 附录 C：安全清理（遗留问题）
旧 `config.json` 中存在**明文密钥**（MySQL 密码、阿里云 AK/SK、DeepSeek API Key、OSS 凭证）。新项目：
- 全部移入 `.env`（不入库），`.env.example` 只留占位。
- **轮换**所有已泄露在 legacy git 历史中的凭证。
