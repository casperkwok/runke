# Runke — 智能体平台

一个全栈的 AI Agent 平台：**单 Agent 运行时 + 跨轮 Workflow 引擎 + RAG 知识库**，外加一个「AI 自己改工作流」的可视化编排器。

> 这是一个学习 / 研究向的完整实现，不是生产级产品：示例数据是虚构的，单机部署，没有多租户隔离与限流。

---

## 能做什么

- **单 Agent**：`model + harness` 的最小运行时，包含工具循环、记忆、流式输出（SSE）。
- **Workflow**：跨轮状态机，节点覆盖 `start / llm / intent / cond / reply / kb / variable / human / skill / code / voice / end`。
- **AI 编排**：用自然语言建图、改图；agent 自己跑预览、自测、自修，过程通过 SSE 直播到画布。
- **RAG**：LlamaIndex + pgvector，文档解析 → 分块 → 入库 → 检索，支持 Agentic RAG。
- **会话与 CRM**：bot / 会话 / 消息 / 客户 / 线索 / 组织。
- **语音**：预留实时语音链路，配套实现见 [realtime-voice-agent](https://github.com/casperkwok/realtime-voice-agent)。

## 技术栈

| | |
|---|---|
| 后端 | FastAPI · SQLAlchemy 2.0 (async) · PostgreSQL 16 + pgvector · Redis · LlamaIndex |
| Agent / Workflow | 自研运行时与跨轮状态机（原设计基于 LangGraph，实现时改为自研，见 `OKR.md`） |
| 前端 | Next.js 16 (App Router) · TanStack Query · shadcn/ui · React Flow · Zustand |
| 接口 | RESTful + OpenAPI，前端类型由 schema 生成 |
| 部署 | Docker Compose：app + postgres + redis |

## 目录

```
runke-backend/     FastAPI 后端
  app/agents/      单 Agent 运行时（runtime / presets / tools）
  app/workflows/   Workflow 引擎（跨轮状态机）
  app/rag/         RAG（LlamaIndex + pgvector）
  app/api/v1/      RESTful 路由
runke-frontend/    Next.js 前端
  src/app/studio/  工作流编排与 AI 编排
ARCHITECTURE.md    前后端统一架构设计
OKR.md             目标、里程碑与进度
深入了解节点重构复盘.md   一次真实节点重构的完整复盘
LEARNING.md        ★ 按模块的阅读与动手路径
```

## 快速开始

### 1. 后端

```bash
cd runke-backend
cp .env.example .env          # 填入 DEEPSEEK_API_KEY
docker compose up -d postgres redis
uv sync
uv run alembic upgrade head
uv run python scripts/seed.py            # demo 用户
uv run python scripts/seed_recruiter.py  # 一个招聘对话示例 bot
uv run uvicorn app.main:app --reload --port 8088
```

演示账号：`demo@runke.dev` / `demo1234`。接口文档：`http://localhost:8088/docs`。

### 2. 前端

```bash
cd runke-frontend
npm install
npm run dev        # http://localhost:3000
```

前端默认连 `http://localhost:8088`，可用 `NEXT_PUBLIC_API_BASE` 覆盖。

## 学习路径

先读 [`LEARNING.md`](LEARNING.md)。推荐的顺序：

1. `runke-backend/app/agents/runtime.py`（~100 行）——模型 + 工具循环。
2. `runke-backend/app/workflows/engine.py`（~525 行）——跨轮状态机与节点调度。
3. `runke-backend/app/rag/`——解析、入库、检索。
4. `runke-frontend/src/app/studio/`——AI 编排编辑器与 SSE 过程直播。
5. `runke-backend/tests/`——P1–P4 的端到端测试。

## 已知限制

- Workflow 引擎是自研实现，不是 LangGraph；`ARCHITECTURE.md` 是最初的设计，`OKR.md` 记录了实现偏差。
- 示例数据中的公司、人物、电话均为虚构，仅用于演示。
- 没有生产级的多租户、限流、审计与权限模型。

## License

MIT
