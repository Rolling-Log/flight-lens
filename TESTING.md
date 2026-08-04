# 测试策略

- Contracts：Schema 和边界值；
- Domain：金额、汇率、全价、去重、去返程 leg、总耗时、经停和排序；
- Connectors：录制响应的契约测试与错误分类；
- API：路由、校验、限流、超时和覆盖报告；
- Web：双输入同步、加载、错误、空状态和结果；
- E2E：一次完整搜索与来源跳转；
- Staging：两个真实来源的受控查询。

CI 在功能校验前执行 `pnpm audit --prod --audit-level high`，高危生产依赖漏洞必须阻断候选。每次框架或安全覆盖升级后还需本地运行不降级阈值的 `pnpm audit --prod`，并重新执行完整 `pnpm check` 与 Playwright E2E。

Playwright 使用 `@axe-core/playwright` 在桌面与移动端检查初始页、结果页和来源弹窗，`serious` 或 `critical` 违规必须阻断候选。审查同时在 `prefers-reduced-motion: reduce` 下运行，并验证弹窗初始焦点、Escape 关闭与焦点返回；不得通过关闭颜色对比规则规避失败。

Playwright E2E 在桌面 Chromium 和移动端 Chromium 中验证：完整对话解析、缺失条件的保守追问与部分回填、条件确认、表单同步、表单修改后切回对话仍提交最新 `SearchIntent`、搜索、来源覆盖、跨日、六种排序入口、来源跳转精度和不售票声明。测试使用本地固定响应，不消耗供应商配额；CI 在 `pnpm check` 后执行 `pnpm test:e2e`。

真实供应商测试必须控制调用量，不在公开 CI 中暴露密钥。
灵活日期测试必须验证实际探测日期和部分失败披露，不能只验证输入字段存在。
SerpApi 契约测试必须覆盖 booking token 请求携带原始搜索参数、opaque POST 不被改写、官方结果页降级和交接精度提示。
SerpApi 真实查询前必须验证账号仍为 `$0` 计划且剩余额度足够；付费计划或低额度都应在消耗搜索积分前失败。
缓存测试必须验证 `CACHE_HIT`/`CACHE_STALE_FALLBACK` 被披露，不能只验证第二次请求更快。
Web 单元测试必须锁定本地分离 API 与 Netlify 同域 `/api` Route Handler 的地址选择，Staging 验证不能只检查 `/api/health`，还必须从页面执行一次不消耗供应商额度的意图解析。
附近机场测试必须覆盖已配置出发机场组的展开、未配置机场的显式披露以及 Connector 执行说明向来源报告的传递；V1 不得扩展目的地机场。
API 测试必须使用永不完成的审计存储替身，证明审计超过预算时搜索仍在边界内返回，并披露 `AUDIT_PERSIST_TIMEOUT`；真实 Staging 请求不得无限等待数据库。
搜索专用限流测试必须证明单个 API 实例内同一客户端每分钟仅允许 2 次额度消耗型请求，同时健康检查等只读端点仍可用。Netlify Edge 与 Fastify 按 IP 限流属于纵深防御，Staging 可用无效请求观察，但在缺少跨实例确定性证据时不得把某一次第三次返回 429 写成全域保证；禁止用真实搜索消耗额度来压测。跨实例最终保护由 SerpApi 账户级月度 credit 上限承担。
Web E2E 必须注入至少一个超预算或其他不满足限定条件的 Offer，证明它不会出现在主结果卡片中，同时页面披露被隐藏的数量；API 与审计仍应保留该 Offer 及不可比较原因。
Web 单元测试必须覆盖生产 Offer、超时、供应商失败、正常空结果、新鲜缓存和旧缓存降级的来源徽标；0 Offer 的生产来源故障不得回退成 Sandbox 文案。
Contracts 与 Domain 测试必须证明外币报价缺少汇率来源或时间时被阻断，基准币与人民币报价币一致时才允许换算；资格价必须被回写为不可比较且不能进入自然最低价。
SerpApi 测试必须证明付费套餐、剩余额度不足和月度安全上限三类门禁都只调用账户端点，不得发出 `/search.json`；账户用量字段缺失也必须 fail-closed。

2026-07-31 已完成一次 SerpApi 生产受控查询；真实凭据只存在于 Git 忽略的本地环境文件中。Skyscanner 生产验证等待 Partnerships 审批，不在 CI 中伪造。
