# 部署

V1 使用 Netlify Web + Railway API + Neon Postgres。三个环境必须分别配置 Development、Staging 和 Production，不复用数据库分支或生产密钥。

## 1. Railway API

Railway 从共享 monorepo 根目录构建，仓库根目录的 `railway.json` 定义：

- Builder：Railpack；
- Build：`pnpm build:api`；
- Start：`pnpm --filter @flight-lens/api start`；
- Healthcheck：`/health`；
- Restart：失败时最多重试 3 次；
- Drain：15 秒。

Railway 环境变量：

```text
NODE_ENV=production
WEB_ORIGINS=https://<netlify-domain>
DATABASE_URL=<neon-pooled-url>
OPENAI_INTENT_PARSER_ENABLED=false
SERPAPI_API_KEY=<secret>
SERPAPI_MONTHLY_CREDIT_CAP=<hard-cap>
SKYSCANNER_API_KEY=<secret-after-approval>
```

`PORT` 由 Railway 注入。API 默认监听 `::`，无需覆盖 `API_HOST`。生成 Railway HTTPS Domain 后验证 `/health`、CORS、安全响应头和 Connector 数量。

## 2. Netlify Web

- Base directory：仓库根目录；
- Package directory：`apps/web`；
- Build command：`pnpm build:web`；
- Next.js 输出由 Netlify Adapter 处理；
- Build scope 环境变量：`NEXT_PUBLIC_API_BASE_URL=https://<railway-api-domain>`；
- Netlify 不配置 `DATABASE_URL`、Connector 密钥或 AI 密钥。

`NEXT_PUBLIC_API_BASE_URL` 是公开地址，不是秘密。未配置时公网 Web 会明确报错，不会回退到不存在的同域 API。

## 3. Neon

- Development、Staging、Production 使用独立 Neon Branch；
- Runtime 使用池化 `DATABASE_URL`；
- Migration 使用 `DATABASE_DIRECT_URL`；
- Migration 不由 Railway 实例自动执行，避免扩缩容和并行部署重复迁移；
- Production Migration 必须先在 Staging 验证。

## 4. 发布顺序

1. 在候选提交上完成 `pnpm check` 与 `pnpm test:e2e`；
2. 对 Neon Staging 执行 Migration；
3. 部署 Railway Staging，验证 `/health` 和本地解析；
4. 将 Railway Staging URL 注入 Netlify Staging 的 Build scope；
5. 部署 Netlify Staging，完成浏览器到 Railway 的端到端验证；
6. 执行真实来源、落地核价、额度门禁和回滚验收；
7. 经产品负责人确认后，合并 `main`、创建 Tag 并按同一顺序部署 Production。

不得在正式确认前创建生产部署。任何平台出现不可控收费、自动升级或超额扣费时，必须先设置预算硬停止或暂停该环境。
