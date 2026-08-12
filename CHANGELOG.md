# Changelog

## Unreleased — V1.0.0

- 将部署架构调整为 Netlify Web + Railway Fastify API + Neon，移除 Netlify Route Handler 与 Edge Function；增加 Railway Config as Code、健康检查和优雅停机。
- 收紧正式 V1 为 1 位成人固定日期；多人和灵活日期留待后续验证，不再让默认搜索生成全部不可比结果。
- 将结果页重选报价改称“抓取时来源展示价”，并只在存在正向证据时生成行李与退改胜出排序；综合推荐改为可解释的平衡排序。
- 建立正式单仓多应用基线；
- 确定 Netlify Web + Functions、Neon 架构；
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
- 将 Railway 否决为试用转收费方案，把 Fastify API 适配为 Netlify 上的同域 Next.js Route Handler；
- 默认拒绝使用 Netlify 自动注入的 AI Gateway 密钥，防止未授权 credits 消耗；
- 增加 V1 硬门禁与 Netlify、Neon Staging Runbook。
- 修复对话解析后经表单修改再切回对话模式会恢复旧条件的问题，确保两种输入始终提交同一份最新 `SearchIntent`；成人表单范围与契约统一为 1–9 人。
- 修复 Netlify 公网部署把前端请求发往 `/v1/*` 而不是同域 Route Handler `/api/v1/*` 的问题，并加入生产/本地 API 基址回归测试。
- 让 SerpApi 在单次查询中真实展开 V1 已配置的附近出发机场组，并把已展开或无替代机场状态传递到来源覆盖报告；Skyscanner 的原生出发地扩展同样留痕。
- 为 Connector 和 Neon 审计写入分别设置 20 秒与 3 秒运行时预算；审计超时以 `AUDIT_PERSIST_TIMEOUT` 降级披露，不能再阻塞航班结果返回。
- 为 `/api/v1/searches` 增加 Netlify 边缘层与 Fastify 双层每 IP 每分钟 2 次限流，降低公开候选环境被滥用耗尽免费供应商额度的风险。
- 修复超预算、红眼、行李或中转条件不满足的 Offer 仍混入主结果卡片的问题；前端只展示可比报价，并披露隐藏数量，完整数据继续保留在 API 与审计中。
- 修复生产 Connector 超时且无 Offer 时被前端误标为 Sandbox 来源的问题；状态徽标现在由来源报告、缓存状态和 Offer 环境共同决定。
- 补齐外币换算的汇率来源与时间证据模型，并将缺失汇率证据、资格价及其他对抗式阻断项统一回写为不可比较，确保 API、前端和排序使用同一可信状态。
- 增加 SerpApi 账户级月度免费 credit 硬上限；默认 200、Staging 100，达到上限或账户用量字段缺失时在航班查询前停止，避免跨 serverless 实例滥用耗尽免费额度。
- 修复生产依赖审计发现的 Next.js、Sharp/Libvips、PostCSS 与 fast-uri 漏洞；升级到官方修复版本，审计结果由 9 个高危、7 个中危降为 0，并将高危生产依赖审计加入 CI。
- 增加 Axe 桌面与移动端可访问性门禁，修复多处 WCAG AA 文字对比度不足；补齐搜索方式标签语义、可见焦点、减少动态效果审查，以及来源弹窗的焦点约束、Escape 关闭和焦点返回。
