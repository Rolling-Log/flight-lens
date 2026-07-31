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

V2 的价格提醒与后台复查在同一个 Railway 项目内增加 Worker 和 Cron Service。V1 不部署独立 Worker；Redis 只有在 V3 前的吞吐与重试压测证明 Postgres 任务表不足时才引入。

## 原则

- V1 使用模块化单体，不拆微服务；
- 前端不持有供应商或 AI 密钥；
- Connector 只返回统一契约；
- 价格、过滤、去重、资格和排序使用确定性代码；
- 搜索请求有全局时限，每个来源有独立时限；
- 搜索返回覆盖报告，失败不被伪装成“无票”；
- V1 不引入 Redis，短期缓存和任务状态使用内存与 Postgres；
- 外部航班 API 是数据源，不是本项目的额外部署平台；
- 所有持久化变更通过 Migration。

## 环境

- Development：本地 Web、API 与 Neon 开发分支；
- Staging：Netlify Preview、Railway Staging、Neon Staging 分支；
- Production：版本确认后部署，独立 Neon Production 分支。
