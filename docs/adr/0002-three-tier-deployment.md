# ADR-0002：Netlify Web + Functions + Neon

状态：已接受。

前端部署 Netlify，Fastify API 通过 Next.js Route Handler 由 Netlify OpenNext Adapter 配置为同域 Serverless Function，持久化使用 Neon Postgres。

Railway 已否决：其当前可用账户形态是到期后付费的试用，不满足“长期零付费、无试用转收费”的项目约束。合并前后端部署可减少一个计费面、CORS 边界和运维账号，同时保留 `apps/api` 的独立测试与未来迁移能力。

V1 不增加 Redis、独立队列、对象存储、搜索引擎或常驻 Worker。Serverless 局部限流不等于全局配额保护；若公开流量需要跨实例原子门禁，应首先使用 Neon 事务实现并完成对抗测试。
