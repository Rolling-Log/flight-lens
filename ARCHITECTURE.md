# 系统架构

```text
Browser
   ↓ HTTPS
Netlify
   └─ Next.js Web
   ↓ HTTPS + restricted CORS
Railway
   └─ Fastify API
      ├─ Intent Parser
      ├─ Search Orchestrator
      ├─ Connector Registry
      ├─ Normalize / Deduplicate / Price
      ├─ Adversarial Review
      └─ Audit
   ↓ pooled connection
Neon Postgres
```

## V1 部署边界

- Netlify 只承载 Web，不持有数据库、供应商或模型密钥；
- 浏览器通过构建期注入的 `NEXT_PUBLIC_API_BASE_URL` 访问 Railway；
- Railway 从仓库根目录构建共享 pnpm monorepo，并运行独立 Fastify 进程；
- Fastify 默认监听 `::` 和 Railway 注入的 `PORT`；
- Railway 使用 `/health` 作为部署健康检查；
- Railway 仅允许 `WEB_ORIGINS` 中登记的 Netlify HTTPS Origin；
- Neon Runtime 使用池化连接，Migration 使用独立直连连接。

## 原则

- V1 使用模块化单体，不拆微服务；
- 前端不持有供应商、数据库或 AI 密钥；
- Connector 只返回统一契约；
- 价格、过滤、去重、资格和排序使用确定性代码；
- 搜索请求有全局时限，每个来源有独立时限；
- 搜索返回覆盖报告，失败不被伪装成“无票”；
- V1 不引入 Redis、对象存储或搜索引擎；
- 进程内缓存和限流不被视为跨副本全局保护；
- 供应商额度由 Connector 的账户级 fail-closed 门禁保护；
- 外部航班 API 是数据源，不是本项目的部署平台；
- 所有持久化变更通过 Migration；
- Railway 收到 `SIGTERM` 或 `SIGINT` 时先关闭 Fastify 和数据库连接。

## 环境

- Development：本地 Web、本地 API 与 Neon 开发分支；
- Staging：Netlify Staging、Railway Staging Service 与 Neon Staging 分支；
- Production：正式 Tag 对应 Netlify、Railway 与 Neon Production 分支。
