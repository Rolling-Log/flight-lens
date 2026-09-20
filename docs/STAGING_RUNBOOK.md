# Staging Runbook

本清单用于 Netlify Web、Render API 与 Neon Postgres 的隔离预发布环境。Production 不复用 Staging 数据库、密钥或域名。

## 当前在线开发版与发布分支（2026-09-20）

现有 `flight-lens-staging` 是用户查看新版的在线开发站点。Netlify 控制台称其主域名发布
为 Production context，这不代表产品已通过下文的正式发布验收。

| 项目 | 当前配置 |
| --- | --- |
| 仓库 | `Rolling-Log/flight-lens` |
| 网页 | `https://flight-lens-staging.netlify.app` |
| Netlify Site ID | `162a29e7-e986-4d02-9653-c841d25aae3e` |
| Netlify Production branch | `main`，自动发布开启 |
| Netlify Base / Package | 仓库根目录 / `apps/web` |
| Netlify Build / Publish | `pnpm build:web` / `apps/web/.next`，由 `netlify.toml` 保存 |
| 网页 API 构建变量 | `NEXT_PUBLIC_API_BASE_URL=https://flight-lens-api.onrender.com` |
| Render API | `flight-lens-api`，`srv-d9u0nsm417fc73ff7fv0` |
| Render Blueprint | `exs-d9u0kr1t0dsc73c9cejg`，同步分支 `main` |
| API 源码分支 | `render.yaml` 中显式指定 `main` |

本轮定位到：Netlify 原来跟踪 `codex/v2-development`，API 服务跟踪
`codex/v3-development`，Blueprint 仍跟踪 `codex/v2-development`。因此只推送 `main`
不能更新线上。后续不要为修复此问题向旧分支强推，也不要上传本机构建（可能嵌入 localhost API）。

每次发布验收：

1. 推送前通过项目要求的校验；确认 GitHub `main` 是预期提交。
2. Netlify Deploys 中确认 `Production: main @<SHA>` 状态为 **Published**，且不是旧的固定预览链接。
3. 从主域名打开网页，完成需求解析、来源弹窗和一次受控查询；不能只检查 HTTP 200。
4. 读取 API `/health` 的 `revision`，核对 Render 的成功部署提交；检查账户与数据库状态、CORS。
5. 记录两端 Deploy ID 和 SHA。若两端先后完成，兼容性未验证前不把发布判定为完成。
6. 失败时保留构建日志，回滚到前后端兼容的已验证部署；新环境变量或数据库变更需另行核对。

现有自动部署尚不等于“CI 成功后才发布”的原子发布门禁；统一门禁和在线冒烟测试列入
实施计划 M0。账户限流还需实际验证受信代理配置，不得为了部署方便恢复无条件信任转发头。

## 0. 前置条件

- 候选提交在 `develop` 或专用 release 分支；
- `pnpm check` 与 `pnpm test:e2e` 全部通过；
- 不在代码、构建日志或命令输出中打印密钥；
- 第二个独立且已授权的购买交接来源未验证前可创建基础设施，但双来源发布门禁仍不通过。

## 1. Neon

1. 使用 `flight-lens` 项目的独立 `staging` Branch；
2. 取得池化连接作为 Render 的 `DATABASE_URL`；
3. 取得直连连接，仅在迁移会话中作为 `DATABASE_DIRECT_URL`；
4. 从仓库根目录执行 `pnpm --filter @flight-lens/database db:migrate`；
5. 验证 `searches`、`connector_runs`、`offers` 与 landing-page verification 表；
6. Migration 不放入 Render 自动启动流程。

## 2. Render API

1. 使用明确标记为 Staging 的 Render Web Service，不与 Production 共用服务；
2. 从 GitHub monorepo 根目录部署，读取根目录 `render.yaml`；
3. 配置 `NODE_ENV=production`、Neon 池化 URL、已授权 Connector 密钥和额度硬上限；
4. 配置 `WEB_ORIGINS=<Netlify Staging HTTPS origin>`；Netlify URL 尚未生成时先使用预计固定 Branch URL，生成后必须复核；
5. 保持 `OPENAI_INTENT_PARSER_ENABLED=false`；
6. 生成 Render Domain，验证 `/health` 为 200、数据库状态、Connector 数和 CORS；
7. 从允许与拒绝的 Origin 分别探测，确认只允许登记的 Netlify Origin；
8. 检查 Render 日志，不得包含数据库密码、供应商 Key 或 Token。

Fastify 5.12.1 起本项目不再按代理跳数信任转发头。部署前通过 `TRUSTED_PROXY_CIDRS`
配置实际反向代理的 IP/CIDR 列表，并确认源站只允许预期代理访问。留空时忽略全部转发头；
在反向代理后留空会让客户端 IP 限流按代理地址聚合。不要填任意地址、全网 CIDR，
也不要用只检查跳数的函数恢复旧行为。需在实际托管环境验证登录限流和 HTTPS 协议信息。

认证邮件注意事项：Resend 的 `onboarding@resend.dev` 仅允许发送到 Resend 账户自身邮箱，不能用于任意外部收件人。要在 staging 验收 163、QQ 等测试邮箱，必须先在 Resend 验证自有域名，再将 `AUTH_EMAIL_FROM` 更新为该域名下的发件地址。前端遇到投递失败会明确提示发件域名配置问题，不应把失败描述为“请查收验证邮件”。

## 3. Netlify Web

1. 创建与 Production 分离的 Netlify Staging Site；
2. Base directory 为仓库根目录，Package directory 为 `apps/web`；
3. 使用 `netlify.toml`，不手工覆盖 Publish directory；
4. 在 Build scope 配置 `NEXT_PUBLIC_API_BASE_URL=<Render Staging HTTPS origin>`；
5. 不向 Netlify 注入数据库、Connector 或 AI 密钥；
6. 部署后从页面完成一次本地意图解析，确认浏览器请求直达 Render；
7. 验证安全响应头、错误状态、桌面与移动端布局。

## 4. 端到端验收

1. 先验证固定日期、1 位或多位成人的表单输入，再验证对话输入；
2. 执行 `V1_ACCEPTANCE.md` 的受控样本；
3. 对精确 Offer 和结果页重选分别完成落地页人工核价；
4. 使用 `price:verify` CLI 写回观察价、无票或落地页故障；
5. 确认结果页重选只显示“抓取时来源展示价”；
6. 确认来源覆盖、失败、缓存、核验时间和跳转精度都可见；
7. 暂停一个 Connector，确认部分失败不被描述为“全网最低”；
8. 回滚 Render API，再回滚 Netlify Web，随后恢复候选部署。

核价示例：

```bash
pnpm --filter @flight-lens/database build
pnpm --filter @flight-lens/database price:verify -- \
  --offer-id '<Offer.id>' \
  --outcome observed \
  --amount '2460.00' \
  --currency CNY \
  --evidence 'staging-check:<ticket-or-screenshot-reference>'
```

不得把含 Token 的完整跳转 URL 当作证据引用。

## 5. 留痕与清理

- 记录 Git commit、Netlify Deploy、Render Deployment、Neon Branch、测试时间和结果；
- 历史 Netlify Function 证据不计作当前 Render 架构的 Staging 通过；
- 临时预览不再使用后关闭，避免持续费用；
- 未经产品负责人确认，不合并 `main`、不打正式 Tag、不部署 Production。
