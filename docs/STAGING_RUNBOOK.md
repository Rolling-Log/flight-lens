# Staging Runbook

本清单用于 Netlify Web、Railway API 与 Neon Postgres 的隔离预发布环境。Production 不复用 Staging 数据库、密钥或域名。

## 0. 前置条件

- 候选提交在 `develop` 或专用 release 分支；
- `pnpm check` 与 `pnpm test:e2e` 全部通过；
- 不在代码、构建日志或命令输出中打印密钥；
- Netlify、Railway、Neon 登录由用户在 Microsoft Edge 完成；
- Skyscanner 未审批前可创建基础设施，但双来源发布门禁仍不通过。

## 1. Neon

1. 创建独立 Staging project 或 branch；
2. 取得池化连接作为 Railway 的 `DATABASE_URL`；
3. 取得直连连接，仅在迁移会话中作为 `DATABASE_DIRECT_URL`；
4. 从仓库根目录执行：

   ```bash
   pnpm --filter @flight-lens/database db:migrate
   ```

5. 验证 `searches`、`connector_runs`、`offers` 与 landing-page verification 表存在；
6. 执行一条 Staging 搜索，确认审计数据写入且不包含供应商密钥或 Token。

对 API 响应中的一个 `Offer.id` 完成人工落地页核价后，在已注入 Staging 数据库变量的受控终端运行：

```bash
pnpm --filter @flight-lens/database build
pnpm --filter @flight-lens/database price:verify -- \
  --offer-id '<Offer.id>' \
  --outcome observed \
  --amount '2460.00' \
  --currency CNY \
  --evidence 'staging-check:<ticket-or-screenshot-reference>'
```

无票时使用 `--outcome sold_out` 并省略 `--amount`；落地页故障时使用 `landing_unavailable`。不得把含 Token 的完整跳转 URL 当作证据引用。

Migration 不放入 API 的自动启动流程，避免扩容或并行部署时重复执行。

## 2. Railway API

1. 从仓库根目录导入服务，Root Directory 保持 `/`；
2. Config path 使用 `/railway.toml`；
3. 创建 `staging` 环境并配置：

   - `NODE_ENV=production`
   - `WEB_ORIGINS=<Netlify Staging HTTPS origin>`
   - `DATABASE_URL=<Neon pooled URL>`
   - 已获授权的 Connector 密钥
   - 可选 `OPENAI_API_KEY`；未配置时表单搜索仍必须可用

4. 不手动设置 `PORT`，API 使用 Railway 注入值；
5. 生成 Staging 公网域名；
6. 验证 `/health` 为 200，并核对 Connector 数和数据库状态；
7. 检查构建日志：共享 packages 必须先于 API 构建。

## 3. Netlify Web

1. 连接同一仓库；
2. Base directory 保持仓库根目录；
3. Package directory 设为 `apps/web`；
4. 使用仓库 `netlify.toml`：

   - Build command：`pnpm build:web`
   - Publish directory：`apps/web/.next`

5. 配置 `NEXT_PUBLIC_API_BASE_URL=<Railway Staging HTTPS URL>`；
6. 部署预览并确认响应头、安全策略和移动端布局。

## 4. 端到端验收

1. 先验证表单输入，再验证对话输入；
2. 执行 `V1_ACCEPTANCE.md` 的受控样本；
3. 对最低价至少完成一次来源落地页人工复核；
4. 确认核价 CLI 写回观察价或无票状态，并核对返回的偏差基点；
5. 确认来源覆盖、失败、缓存、价格口径、核验时间和跳转精度都可见；
6. 验证 Web 只请求 Railway API，不直接持有供应商密钥；
7. 暂停一个 Connector，确认部分失败不会被描述为“全网最低”；
8. 回滚到上一个已验证部署，再恢复候选部署。

## 5. 留痕与清理

- 记录 Git commit、三个 Staging 环境标识、测试时间和结果，不记录密钥；
- 失败时保留脱敏日志和复现条件；
- 临时预览不再使用后关闭，避免持续费用；
- 未经用户确认，不合并 `main`、不打正式 Tag、不部署 Production。
