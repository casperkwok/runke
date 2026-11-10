# runke-backend

Runke 智能体平台后端：FastAPI + PostgreSQL(pgvector) + Redis + LlamaIndex。

> 架构见 `../ARCHITECTURE.md`，目标与进度见 `../OKR.md`，学习路径见 `../LEARNING.md`。
> 状态：MVP（P0–P5）+ AI 编排。Workflow 引擎为**自研跨轮状态机**（最初设计基于 LangGraph，实现时改为自研，偏差记录在 `OKR.md`）。

## 本地起步

```bash
cp .env.example .env

# 起依赖（postgres+pgvector / redis）
docker compose up -d postgres redis

# 装依赖（uv）
uv sync                      # 仅核心依赖（P0/P1）
# uv sync --extra agents     # P2 智能体运行时
# uv sync --extra rag        # P3 RAG

# 建表 + 种子数据
uv run alembic upgrade head
uv run python scripts/seed.py            # demo 用户
uv run python scripts/seed_recruiter.py  # 一个招聘对话示例 bot

# 跑起来
uv run uvicorn app.main:app --reload --port 8088
```

演示账号：`demo@runke.dev` / `demo1234`。

- 存活：`GET /api/v1/health`
- 就绪（含 DB/Redis 探活）：`GET /api/v1/health/ready`
- 交互文档：`GET /docs`
- 导出 OpenAPI：`uv run python scripts/export_openapi.py`

## 全栈一键

```bash
docker compose up --build      # app + postgres + redis
```

## 测试

```bash
uv run pytest
```

## 目录
```
app/
├── main.py          应用装配
├── core/            config / db / redis / logging / security
├── api/v1/          路由层（RESTful，统一信封）
├── schemas/         Pydantic DTO
├── models/          SQLAlchemy ORM
├── repositories/    数据访问
├── services/        业务逻辑
├── agents/          单 Agent 运行时（model + harness）  [P2]
├── workflows/       自研跨轮 Workflow 引擎             [P4]
├── rag/             LlamaIndex + pgvector             [P3]
└── integrations/    第三方/LLM/OSS
```
