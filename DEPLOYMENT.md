# 部署

## Web

- Netlify；
- 构建命令 `pnpm build:web`；
- Production 对应 `main`；
- 环境变量 `NEXT_PUBLIC_API_BASE_URL`。

## API

- Railway；
- 配置 `apps/api/railway.toml`；
- 健康检查 `/health`；
- Staging 与 Production 使用不同环境变量。

## Database

- Neon；
- Development、Staging、Production 分支隔离；
- Runtime 使用 `DATABASE_URL`；
- Migration 使用 `DATABASE_DIRECT_URL`；
- 生产 Migration 必须先在 Staging 验证。

生产部署仅在用户确认大版本后执行。
