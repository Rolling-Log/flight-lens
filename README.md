# 航探 Flight Lens

面向中国航线的透明航班 Offer 搜索与决策层。

航探编排多个合法数据来源，把航班、运价、税费、行李、退改、资格条件和销售平台标准化为可比较的 Offer。产品只提供搜索、解释和来源跳转，不出票、不收款。

## 当前状态

- 当前版本：V1 开发候选；正式购买交接来源 1/2；
- Web：Next.js，部署到 Netlify；
- API：Fastify 独立服务，部署到 Railway；
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
apps/api            Railway Fastify API
packages/contracts  API 与领域契约
packages/domain     确定性搜索、全价、去重与排序
packages/connectors 数据源适配器
packages/database   Neon Schema 与 Migration
docs                产品、架构与运行文档
```

航探不会在证据不足时宣称“全网最低”。结论必须包含成功、失败和超时来源、统一价格口径以及报价核验时间。只能跳到来源结果页的报价会显示为“抓取时来源展示价”，而不是可支付总价。

详细范围见 [PRD](./PRD.md)，工程决策见 [ARCHITECTURE](./ARCHITECTURE.md)，部署步骤见 [DEPLOYMENT](./DEPLOYMENT.md)，V1 发布门禁见 [V1_ACCEPTANCE](./docs/V1_ACCEPTANCE.md)。
