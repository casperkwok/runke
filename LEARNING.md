# 学习路径

这份指南按「读什么 → 改什么 → 怎么验证」组织，目标是把这个仓库当成一套智能体平台的教材，而不是只跑一遍 demo。

先按根目录 README 把后端、前端和种子数据跑起来。

---

## 0. 先看全景

三分钟建立地图：

- `ARCHITECTURE.md` —— 最初的设计：分层、数据模型、接口约定。
- `OKR.md` —— 实际做到哪、哪里和设计不一样（重点看「实现偏差」那一段）。
- `深入了解节点重构复盘.md` —— 一次真实重构的完整过程，适合看「需求怎么变成节点」。

然后记住三条主线：**Agent 运行时**、**Workflow 引擎**、**RAG**。前端的编排器只是这三条线的可视化外壳。

---

## 1. 单 Agent 运行时

**读**

- `runke-backend/app/agents/runtime.py`（~100 行）
- `runke-backend/app/agents/models.py`（provider 适配）
- `runke-backend/app/agents/tools/`（`rag_search` / `crm_tool` / `skill_tool` / `bitable_tool`）
- `runke-backend/app/agents/presets.py`

**带着问题读**

1. 一次对话里，模型和工具循环是怎么交替的？终止条件是什么？
2. 工具的参数 schema 从哪来，怎么注册？
3. 流式输出在哪一层被切成 SSE 事件？

**动手**

加一个 `weather` 工具：输入城市，返回固定 JSON。注册到运行时，建一个 bot 绑定它，在对话里让模型调用。

**验证**

- `uv run pytest tests/test_p2_completion.py`
- 前端或 `/docs` 里跑一次单 Agent 对话，确认工具调用和流式输出都正常。

---

## 2. Workflow 引擎

**读**

- `runke-backend/app/workflows/engine.py`（~525 行）
- `runke-backend/app/workflows/code_exec.py`
- `runke-backend/tests/test_p4_workflow.py`

**带着问题读**

1. 跨轮状态存在哪（`session.*` / `global.*`）？下一轮怎么恢复？
2. `intent` 与 `cond` 的区别是什么？为什么 `llm + cond` 不能冒充 `intent`？
3. 分支没命中时走哪条兜底路径？
4. 节点执行失败时，错误怎么冒泡到前端？

**动手**

加一个 `delay` 节点（等待 N 秒）或 `http` 节点（请求一个固定 URL）。要求：

- 写进节点类型判断与执行 switch；
- 更新图的 lint 规则（断头、不可达、分支未连）；
- 在前端节点面板里能选到它。

**验证**

- `uv run pytest tests/test_p4_workflow.py`
- 在 studio 里建一个 `start → delay → reply → end` 的图，跑一次预览。

---

## 3. RAG

**读**

- `runke-backend/app/rag/provider.py`（抽象接口）
- `runke-backend/app/rag/parse.py`（文档解析）
- `runke-backend/app/rag/llamaindex_pgvector.py`（入库与检索）
- `runke-backend/tests/test_p3_rag.py`

**带着问题读**

1. 分块发生在哪一步？chunk size / overlap 在哪配置？
2. embedding 模型怎么选？换模型时 pgvector 的维度怎么处理？
3. `rag_search` 工具是怎么把检索结果塞回模型上下文的？

**动手**

准备 10 个带标准答案的问题，换一组分块参数或 embedding 模型，各跑一遍，记录命中率与首字节延迟。

**验证**

- `uv run pytest tests/test_p3_rag.py`
- 用同一组问题对比两版参数，写下结论（哪怕结论是「没区别」）。

---

## 4. AI 编排（这个仓库最值得学的部分）

**读**

- `runke-backend/app/services/wf_copilot_service.py`（~742 行）
- `runke-frontend/src/app/studio/[id]/WorkflowExp.tsx`
- `runke-frontend/src/app/studio/[id]/wf-preview.tsx`

**带着问题读**

1. 模型为什么不直接输出整张图，而是调用 `edit_graph` 下发一批操作？
2. `run_preview` 怎么模拟多轮对话？为什么「每轮从 start 重入、变量跨轮持久」？
3. 图 lint 是确定性的，它拦住了哪些模型常犯的错？
4. SSE 的 `tool_start / tool_end / plan / thinking` 事件分别驱动前端什么状态？

**动手**

给 copilot 加一个 `rename_node` 工具：改节点 id 并同步所有引用。要求：

- 改完跑一遍 lint；
- 前端能实时看到工具开始 / 结束；
- 失败时把错误回灌给模型，让它自己重试。

**验证**

在 studio 里用自然语言说「把 reply 节点的名字改成打招呼」，观察计划卡、工具条、画布点亮和最终图。

---

## 5. 前端

**读**

- `runke-frontend/src/lib/api/`（OpenAPI typed client）
- `runke-frontend/src/lib/store/`（Zustand）
- `runke-frontend/src/app/studio/[id]/`（画布与编排）

**动手**

加一个只读页面：列出当前用户的 bot 和最近会话，数据全部走 typed client 与 TanStack Query。

**验证**

`npm run build` 通过，页面能拿到真实数据。

---

## 6. 下一步可以做什么

这个项目自己列过的欠账，正好是好的练习题：

- **AI 编排的 golden 评测集**：固定 10–20 条「自然语言 → 期望图」的用例，防止改提示词后回归。
- **编排模式库**：把常见的图（信息收集、条件分流、人审介入）做成模板，让 copilot 复用。
- **成本与延迟预算**：给单轮对话和 workflow 跑批各加一个 p50 / p95 看板。
- **数据迁移**：把 `legacy/` 里的旧结构迁到 Postgres（仓库里没有包含 legacy，可按自己的旧项目练）。

每做完一个，回来改 `OKR.md` 的进度——这也是这个仓库原本的工作方式。
