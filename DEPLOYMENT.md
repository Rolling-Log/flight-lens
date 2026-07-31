# 部署

## Web

- Netlify；
- Base directory 保持仓库根目录；
- Package directory 设为 `apps/web`；
- 构建命令 `pnpm build:web`，发布目录 `apps/web/.next`；
- Production 对应 `main`；
- 环境变量 `NEXT_PUBLIC_API_BASE_URL`。

## API

- Railway；
- 这是依赖共享包的 pnpm monorepo，Service Root Directory 必须保持仓库根目录；
- 配置使用仓库根目录的 `railway.toml`；
- 构建命令会先构建 API 的全部 workspace 依赖，再构建 API；
- API 监听 Railway 注入的 `0.0.0.0:$PORT`；本地仍可使用 `API_PORT`；
- 健康检查 `/health`；
- Staging 与 Production 使用不同环境变量。

## Database

- Neon；
- Development、Staging、Production 分支隔离；
- Runtime 使用 `DATABASE_URL`；
- Migration 使用 `DATABASE_DIRECT_URL`；
- 生产 Migration 必须先在 Staging 验证。
- Migration 不由每个 API 实例自动执行，避免多实例同时迁移；发布时按版本 Runbook 单独执行。

生产部署仅在用户确认大版本后执行。
