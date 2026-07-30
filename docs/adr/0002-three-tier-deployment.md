# ADR-0002：Netlify + Railway + Neon

状态：已接受。

前端部署 Netlify，持续 API 和后续 Worker 部署 Railway，持久化使用 Neon Postgres。V1 不增加 Redis、独立队列、对象存储或搜索引擎，除非实测证明必要。
