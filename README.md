# 航探 Flight Lens

面向中国航线的透明航班 Offer 搜索与决策层。

航探编排多个合法数据来源，把航班、运价、税费、行李、退改、资格条件和销售平台标准化为可比较的 Offer。产品只提供搜索、解释和来源跳转，不出票、不收款。

## 当前状态

- 当前开发分支保留透明比价口径，并新增外部市场历史、本站查询留存、五档价格判断、价格提醒、有界日期/机场规划和匿名偏好；
- Web：Next.js，部署到 Netlify；
- API：Fastify 独立服务，免费层部署使用 Render；
- 数据库：Neon Postgres；
- 包管理：pnpm workspace。

## 本地开发

需要 Node.js 22 和 pnpm 11。

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- Web：<http://localhost:3000>
- API：<http://localhost:4000>
- 健康检查：<http://localhost:4000/health>

国内 OTA 的本地浏览器增强能力位于 `apps/edge-companion`。在 Edge 的
`edge://extensions` 开启开发人员模式，选择“加载解压缩的扩展”并选中该目录，
然后刷新航探页面。平台要求登录或验证码时，扩展会保留并置前对应标签页。

生产构建后的本地预览：

```bash
pnpm build
pnpm preview
```

完整校验：

```bash
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

## 仓库结构

```text
apps/web            Netlify Web
apps/api            Render Fastify API
apps/edge-companion 本地 Edge MV3 页面核验扩展
packages/contracts  API 与领域契约
packages/domain     确定性搜索、全价、去重与排序
packages/connectors 数据源适配器
packages/database   Neon Schema 与 Migration
docs                产品、架构与运行文档
```

航探不会在证据不足时宣称“全网最低”。结论必须包含成功、失败和超时来源、统一价格口径以及报价核验时间。只能跳到来源结果页的报价会显示为“抓取时来源展示价”，而不是可支付总价。

价格历史分成两个互不冒充的层次：同一航线、日期、行程类型、舱位、成人数和价格口径匹配时，优先展示 SerpApi 返回的 Google Flights 市场历史；本站查询留存单独展示，且把“最低可核验全价”“来源展示价”和“两张单程分开购买价”分别保存和分析。五档“贵不贵”判断只使用同口径数据，样本不足或条件不一致时明确不下结论。

价格提醒是服务端任务，不要求网页保持打开；只有部署环境同时配置 Neon、pg-boss 调度、GitHub Actions 定时唤醒和 ntfy 时才允许创建。未配置时前端会明确显示不可用，API 也会拒绝创建，避免形成虚假提醒。

详细范围见 [PRD](./PRD.md)，工程决策见 [ARCHITECTURE](./ARCHITECTURE.md)，部署步骤见 [DEPLOYMENT](./DEPLOYMENT.md)，V1 发布门禁见 [V1_ACCEPTANCE](./docs/V1_ACCEPTANCE.md)，四来源登录与验证步骤见 [PROVIDER_ONBOARDING](./docs/PROVIDER_ONBOARDING.md)，V3 账号方案见 [V3_AUTH_OPTIONS](./docs/V3_AUTH_OPTIONS.md)。

本地真实来源验收命令与 2026-08-11 的结果见 [V1_ACCEPTANCE_REPORT](./docs/V1_ACCEPTANCE_REPORT.md)。
