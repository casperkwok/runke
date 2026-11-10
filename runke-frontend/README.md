# runke-frontend

Runke 智能体平台前端。

- **Next.js 16**（App Router）+ TypeScript
- **TanStack Query** 做数据请求与缓存
- **shadcn/ui + Tailwind** 组件
- **React Flow**（`@xyflow/react`）做工作流画布
- **Zustand** 管轻量客户端状态
- 接口类型由后端 OpenAPI 生成（`openapi-typescript`），不手写

## 本地起步

```bash
cp .env.example .env.local
npm install
npm run dev        # http://localhost:3000
```

默认连 `http://localhost:8088`（后端）。修改 `NEXT_PUBLIC_API_BASE` 可切换。

## 目录

```
src/
  app/             路由（App Router）
    (app)/         登录后的主界面：bots / conversations / knowledge / customers / org
    studio/        工作流编排 + AI 编排
    login/
  components/      按页面分的组件与 shadcn/ui
  lib/
    api/           OpenAPI typed client
    store/         Zustand
    rk/            原型数据与语音客户端
```

## 构建检查

```bash
npm run build
```
