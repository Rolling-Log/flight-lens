# 测试策略

- Contracts：Schema 和边界值；
- Domain：金额、汇率、全价、去重、行程结构、证据门禁和排序；
- Connectors：录制响应、交接精度、额度门禁和错误分类；
- API：路由、V1 范围、CORS、限流、超时和覆盖报告；
- Web：双输入同步、Railway API 基址、加载、错误、空状态和结果；
- E2E：桌面/移动端完整搜索、来源披露、跳转精度和可访问性；
- Staging：浏览器跨域访问 Railway，并执行两个真实来源的受控查询。

CI 在功能校验前执行 `pnpm audit --prod --audit-level high`。高危生产依赖漏洞、类型错误、Lint、测试、构建或 E2E 失败都阻断候选。

Playwright 使用真实 Fastify 路由、领域排序、CORS、限流和审计接口，仅将供应商替换为固定的本地 sandbox Connector，不消耗供应商额度，并在桌面与移动端验证：

- 初始页、结果页和来源弹窗无 serious/critical Axe 违规；
- 弹窗焦点约束、Escape 关闭、焦点返回和 reduced motion；
- 对话解析、保守追问、表单回填和双输入共同 `SearchIntent`；
- V1 只提交 1 位成人和固定日期；
- 超预算等不可比 Offer 不进入主结果；
- 结果页重选显示“抓取时来源展示价”，不显示为可支付总价；
- 缺少正向证据时不展示行李或退改胜出排序；
- 来源覆盖、跨日、价格构成、跳转精度和不售票声明。

## 必测不变量

- SerpApi booking token 请求携带原始搜索参数；opaque POST 不被改写；
- 付费套餐、余额不足、月度上限和用量缺失都在 `/search.json` 前失败；
- 缓存命中与 stale fallback 对用户可见；
- 外币缺失汇率来源或时间时不可比较；
- 资格价不能进入自然最低价；
- 审计超时不能阻塞已经完成的搜索结果；
- Fastify 单实例搜索限流不影响健康检查；
- 公网 Web 缺少 `NEXT_PUBLIC_API_BASE_URL` 时不得静默请求错误地址；
- Railway 只接受 `WEB_ORIGINS` 中登记的 Netlify Origin。

真实供应商测试不进入公开 CI，不打印密钥，不使用真实搜索做压力测试。2026-07-31 已完成一次 SerpApi 受控生产查询；Skyscanner 生产验证仍等待 Partnerships 审批。
