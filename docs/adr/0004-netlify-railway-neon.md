# ADR-0004：Netlify Web + Railway API + Neon

状态：已接受，替代 ADR-0002。

## 决策

V1 前端部署到 Netlify，Fastify API 作为独立长驻服务部署到 Railway，持久化使用 Neon Postgres。浏览器通过 `NEXT_PUBLIC_API_BASE_URL` 直接访问 Railway 公网域名，API 使用明确的 `WEB_ORIGINS` 白名单处理 CORS。

Railway 服务从仓库根目录构建，只构建 API 及其 workspace 依赖；运行时监听 Railway 注入的 `PORT` 和 IPv6 未指定地址 `::`。`/health` 用作部署健康检查，`SIGTERM`/`SIGINT` 触发 Fastify 优雅关闭。

## 原因

- 用户已明确选择 Netlify、Railway、Neon 作为 V1 部署栈；
- 长驻 API 避免把 Connector 的轮询、超时和审计写入塞进 Netlify Function 生命周期；
- 前后端仍保持单仓和共享契约，不因部署分离提前拆成多个仓库；
- 独立 API 域名让 CORS、限流、健康检查和故障边界更明确。

## 约束与后果

- Netlify 构建必须注入具有 Build scope 的 `NEXT_PUBLIC_API_BASE_URL`；
- Railway 必须注入 `WEB_ORIGINS`、供应商密钥和 Neon `DATABASE_URL`，不得提交 Secret；
- V1 Railway 保持单副本；实例内限流不能冒充全局原子配额；
- 任何付费套餐都必须设置明确月度预算和硬停止，不允许自动超额；
- 旧 Netlify Function Staging 证据不再满足当前架构的发布门禁，必须重新完成跨域搜索、审计落库、健康检查和回滚演练。
