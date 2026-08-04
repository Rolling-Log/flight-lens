# 测试策略

- Contracts：Schema 和边界值；
- Domain：金额、汇率、全价、去重、去返程 leg、总耗时、经停和排序；
- Connectors：录制响应的契约测试与错误分类；
- API：路由、校验、限流、超时和覆盖报告；
- Web：双输入同步、加载、错误、空状态和结果；
- E2E：一次完整搜索与来源跳转；
- Staging：两个真实来源的受控查询。

Playwright E2E 在桌面 Chromium 和移动端 Chromium 中验证：完整对话解析、缺失条件的保守追问与部分回填、条件确认、表单同步、表单修改后切回对话仍提交最新 `SearchIntent`、搜索、来源覆盖、跨日、六种排序入口、来源跳转精度和不售票声明。测试使用本地固定响应，不消耗供应商配额；CI 在 `pnpm check` 后执行 `pnpm test:e2e`。

真实供应商测试必须控制调用量，不在公开 CI 中暴露密钥。
灵活日期测试必须验证实际探测日期和部分失败披露，不能只验证输入字段存在。
SerpApi 契约测试必须覆盖 booking token 请求携带原始搜索参数、opaque POST 不被改写、官方结果页降级和交接精度提示。
SerpApi 真实查询前必须验证账号仍为 `$0` 计划且剩余额度足够；付费计划或低额度都应在消耗搜索积分前失败。
缓存测试必须验证 `CACHE_HIT`/`CACHE_STALE_FALLBACK` 被披露，不能只验证第二次请求更快。
Web 单元测试必须锁定本地分离 API 与 Netlify 同域 `/api` Route Handler 的地址选择，Staging 验证不能只检查 `/api/health`，还必须从页面执行一次不消耗供应商额度的意图解析。

2026-07-31 已完成一次 SerpApi 生产受控查询；真实凭据只存在于 Git 忽略的本地环境文件中。Skyscanner 生产验证等待 Partnerships 审批，不在 CI 中伪造。
