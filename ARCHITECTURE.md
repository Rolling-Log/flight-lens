# 系统架构

```text
Netlify Web
   ↓ HTTPS
Railway API
   ├─ Intent
   ├─ Search Orchestrator
   ├─ Connector Registry
   ├─ Normalize / Deduplicate / Price
   ├─ Adversarial Review
   └─ Audit
   ↓
Neon Postgres
```

## 原则

- V1 使用模块化单体，不拆微服务；
- 前端不持有供应商或 AI 密钥；
- Connector 只返回统一契约；
- 价格、过滤、去重、资格和排序使用确定性代码；
- 搜索请求有全局时限，每个来源有独立时限；
- 搜索返回覆盖报告，失败不被伪装成“无票”；
- V1 不引入 Redis，短期缓存和任务状态使用内存与 Postgres；
- 所有持久化变更通过 Migration。

## 环境

- Development：本地 Web、API 与 Neon 开发分支；
- Staging：Netlify Preview、Railway Staging、Neon Staging 分支；
- Production：版本确认后部署，独立 Neon Production 分支。
