# 部署

## Web 与 API

- Netlify；
- Base directory 保持仓库根目录；
- Package directory 设为 `apps/web`；
- 构建命令 `pnpm build:web`；
- 不手工指定静态发布目录，由 Netlify OpenNext Adapter 处理 Next.js 输出；
- `apps/web/app/api/[...path]` 作为同域 API Route Handler，由 Netlify 自动配置为 Function；
- Fastify 仍是 API 核心，通过 Web `Request`/`Response` 适配层调用；
- 健康检查 `/api/health`；
- Production 对应 `main`；
- 生产环境默认同域请求，不需要 `NEXT_PUBLIC_API_BASE_URL`；
- 本地分离开发仍可用 `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`；
- Staging 与 Production 使用不同的 Netlify 项目与环境变量；
- 必须保持 `OPENAI_INTENT_PARSER_ENABLED=false`，防止 Netlify AI Gateway 自动注入的密钥触发 credits 消耗；
- 不使用 Railway：其试用到期后需要付费，与项目的零付费原则冲突。

## Database

- Neon；
- Development、Staging、Production 分支隔离；
- Runtime 使用池化 `DATABASE_URL`，适配 Serverless 并发；
- Migration 使用 `DATABASE_DIRECT_URL`；
- 生产 Migration 必须先在 Staging 验证。
- Migration 不由每个 API 实例自动执行，避免多实例同时迁移；发布时按版本 Runbook 单独执行。

Staging 可自主部署；生产部署仅在用户确认大版本后执行。任何服务出现试用到期收费、自动升级或超额扣费条件时，部署必须 fail closed。
