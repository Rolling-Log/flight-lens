# 部署

V2 免费层使用 Netlify Web + Render API + Neon Postgres。Development、Staging 和 Production 应使用独立数据库分支和独立密钥。

网页不展示内部版本号；本文件中的版本名称仅用于开发和发布管理。

## 1. Render API

Render 从 monorepo 根目录构建，`render.yaml` 定义免费 Web Service：

- Build：`pnpm install --frozen-lockfile && pnpm build:api`；
- Start：`pnpm --filter @flight-lens/api start`；
- Healthcheck：`/health`。

Render 环境变量：

```text
NODE_ENV=production
WEB_ORIGINS=https://<netlify-domain>
DATABASE_URL=<neon-pooled-url>
OPENAI_INTENT_PARSER_ENABLED=false
MONITOR_WAKE_SECRET=<random-secret>
MONITOR_BATCH_MAX=5
MONITOR_EXECUTION_TIMEOUT_MS=45000
NTFY_BASE_URL=https://ntfy.sh
SERPAPI_API_KEY=<secret>
SERPAPI_MONTHLY_CREDIT_CAP=<hard-cap>
FLYAI_API_KEY=<secret>
```

`PORT` 由 Render 注入。API 默认监听 `::`。上线后验证 `/health`、CORS、安全响应头、监控队列和 Connector 数量。

## 2. Netlify Web

- Base directory：仓库根目录；
- Package directory：`apps/web`；
- Build command：`pnpm build:web`；
- Build scope 环境变量：`NEXT_PUBLIC_API_BASE_URL=https://<render-api-domain>`；
- Netlify 不配置数据库、Connector、监控或 AI 密钥。

`NEXT_PUBLIC_API_BASE_URL` 是公开地址。未配置时公网 Web 会明确报错，不回退演示数据。

## 3. Neon

- Runtime 使用池化 `DATABASE_URL`；
- Migration 使用 `DATABASE_DIRECT_URL`；
- Migration 不由 Render 实例自动执行；
- Production Migration 必须先在 Staging 验证。

## 4. GitHub Actions 定时唤醒

`.github/workflows/monitor.yml` 每小时调用一次内部唤醒端点，每次最多排队 `MONITOR_BATCH_MAX` 个到期提醒。仓库配置：

```text
Variable: FLIGHT_LENS_API_URL=https://<render-api-domain>
Secret: FLIGHT_LENS_MONITOR_WAKE_SECRET=<与 Render 相同>
```

唤醒密钥只用于内部端点，不放在 Netlify 或浏览器。pg-boss 使用 Neon 的独立 `pgboss` schema、单提醒 singleton key 和有限重试；不新增常驻付费 Worker。

## 5. 发布顺序

1. 在 V2 分支完成 `pnpm check` 与 `pnpm test:e2e`；
2. 对 Neon Staging 执行 Migration；
3. 部署 Render Staging，验证 `/health`、pg-boss schema 和本地解析；
4. 将 Render Staging URL 注入 Netlify Staging 的 Build scope；
5. 部署 Netlify Staging，完成浏览器到 Render 的端到端验证；
6. 执行真实来源、提醒幂等、通知失败和回滚验收；
7. 经产品负责人确认后再合并 `main` 和发布 Production。

免费 Render 实例可能休眠，GitHub Actions 唤醒和提醒到达时间不提供实时 SLA。任何平台出现不可控收费或自动升级时，先暂停对应环境。

## 6. 价格历史与判断边界

- 外部市场历史来自 SerpApi 同一次 Google Flights 查询响应中的 `price_insights`，不会为了画历史曲线再发起一次供应商请求；
- 只有航线、出发/返程日期、行程类型、舱位、成人数、币种和价格口径全部一致时才用于五档判断；
- 外部历史是来源展示价，不等于已核验支付总价；本站观测的含税全价、来源展示价和分开购买价保持独立；
- SerpApi 没有返回可靠历史时，页面明确显示无外部历史，不伪造或用一分钟内重复查询填充 180 天曲线；
- 免费额度和项目硬上限继续由 Connector 在每次供应商请求前校验。环境变量只保存密钥，不把真实值写入仓库。
