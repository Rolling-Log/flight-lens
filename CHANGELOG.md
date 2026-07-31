# Changelog

## Unreleased — V1.0.0

- 建立正式单仓多应用基线；
- 确定 Netlify、Railway、Neon 三层架构；
- 建立 SearchIntent、Offer、Connector 和数据库契约；
- 建立全价校验、去重、排序与对抗式审查核心；
- 接入 SerpApi Google Flights 与 Skyscanner Live Prices Connector；
- 将无消费者购买落点的分销 API 降级为交叉核验来源；
- 增加去程/返程 leg 模型、跨日标记和三点灵活日期探测；
- 增加 Skyscanner 官方品牌资产及购买跳转展示；
- 完成 SerpApi 首次生产查询，修复 token 链路必须携带原始搜索参数的问题；
- 区分精确 Offer 落点与 Google Flights 条件结果页重新选择，不改写 opaque POST；
- 增加统一预算/时间/行李过滤、六类确定性排序、缓存/重试披露和 Connector 健康端点；
- 增加 Playwright 桌面和移动端 E2E，并接入 GitHub Actions。
- 按零付费数据源原则移除 Wego Affiliate Flights 付费候选及其 Connector；
- SerpApi 增加 `$0` 计划与剩余额度的 fail-closed 运行时门禁，并关闭自动灵活日期扩搜；
- 增加无需外部模型密钥的 V1 中文意图解析兜底、保守追问和解析方式披露；
- 增加受控落地页核价 CLI，记录观察价、无票/故障状态、证据引用和价格偏差基点；
- 依据最新官方规则否决与多源比较冲突的 Travelpayouts Search API。
- 修正 Railway shared monorepo 构建、配置发现与平台 `PORT` 监听；
- 增加 V1 硬门禁与 Netlify、Railway、Neon Staging Runbook。
