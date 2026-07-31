# 系统架构

```text
Netlify
   ├─ Next.js Web
   └─ Next.js Route Handler → Netlify Function → Fastify API
   ├─ Intent
   ├─ Search Orchestrator
   ├─ Connector Registry
   ├─ Normalize / Deduplicate / Price
   ├─ Adversarial Review
   └─ Audit
   ↓
Neon Postgres
```

V1 不部署常驻进程、独立 Worker、Redis、对象存储或搜索引擎。V2 的价格提醒先评估 Netlify Scheduled Functions 与用户触发式复查，并继续受免费额度硬停止约束；只有 V3 前的实测证明必要且存在长期免费方案时才增加新组件。

## 原则

- V1 使用模块化单体，不拆微服务；
- 前端不持有供应商或 AI 密钥；
- 浏览器与 API 同域，减少 CORS、跨站密钥暴露和独立后端运维面；
- Serverless 实例不执行自动 Migration，数据库连接使用 Neon 池化入口；
- Connector 只返回统一契约；
- 价格、过滤、去重、资格和排序使用确定性代码；
- 搜索请求有全局时限，每个来源有独立时限；
- 搜索返回覆盖报告，失败不被伪装成“无票”；
- V1 不引入 Redis，短期缓存和任务状态使用内存与 Postgres；
- 外部航班 API 是数据源，不是本项目的额外部署平台；
- 不使用试用到期收费、自动升级或必须绑卡的部署服务；
- 所有持久化变更通过 Migration。

## 环境

- Development：本地 Web、API 与 Neon 开发分支；
- Staging：独立 Netlify Staging 项目与 Neon Staging 分支；
- Production：版本确认后部署，独立 Neon Production 分支。
