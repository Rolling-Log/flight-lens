# 用户侧 Edge Connector 评估

日期：2026-08-11

## 参考项目结论

`hehu321/flight-price-assistant` 是 Manifest V3 浏览器扩展，不是可由 Railway 后端直接调用的四平台价格 API。它通过 `chrome.tabs` 打开平台页面，在用户浏览器中注入 content script，再从 DOM 提取航班卡。

该仓库的携程、去哪儿、飞猪选择器仍明确标记为需要真实 DOM 调优，README 的已完成描述主要由 mock 站点和单元测试支撑。航探现有携程、去哪儿、同程选择器池已与其主要真实页面选择器重合，直接复制不会绕过 WhaleGuard 或匿名页面限制。

仓库根目录未提供 LICENSE，因此不直接复制源码。可独立实现其“用户侧标签页 + 内容脚本 + 本地桥接”架构。

## 已选方向

### A. 航探 Edge Companion（已选择、已实现）

已新增轻量 MV3 扩展。航探本地页面通过受限的页面桥把查询交给扩展；扩展在用户已登录的 Edge 标签页执行搜索，把结构化 DOM 证据回传给本地 API，由现有 Connector、统一 Offer、排序和覆盖披露继续处理。网站仍是主界面，扩展不重复实现产品 UI。

优点：继承用户 Cookie、登录和人工验证状态；最接近国内 OTA 的真实可购买价格；可继续复用现有统一 Offer、覆盖披露与排序。

代价：本地查询要求 Edge 与扩展在线；Railway 不能独立完成这些 Connector。Connector 已标记为 `user_browser` 执行环境，页面桥只接受 `127.0.0.1` / `localhost` 的 3000、3100 端口，不传输 Cookie，结果按有界 Schema 验证。

### B. 后端启动持久化 Edge Profile

Playwright 使用单独的持久化用户目录，用户首次在这个隔离窗口登录各平台，后续后端复用会话。

优点：改动较小，仍沿用当前 Connector 接口。

代价：不能安全复用正在运行的默认 Edge Profile；本地会弹出独立浏览器；云端仍不可用；自动化特征和页面阻断风险仍高。

### C. 保持后端来源

继续使用 SerpApi、FlyAI 和正式合作 API，不增加用户侧扩展。

优点：部署模型简单，Railway 可独立运行。

代价：服务端无法继承用户登录态；当前由正式 FlyAI、SerpApi 和用户侧成功的国内 OTA 路径共同保证本地多来源结果。

## 当前实现

- 扩展目录：`apps/edge-companion`；
- 平台：携程、去哪儿、同程、飞猪；
- 国内往返：同一平台标签页依次查询两张单程，保留各自价格、URL 和时间，并标记 `split_ticket`；
- 国际查询：仅启用当前声明支持国际市场的携程 Companion，其他来源继续走 API Connector；
- 登录/验证：保留并置前对应标签页，状态分别返回 `login_required` / `captcha_required`；
- 页面变化、超时、空结果和不可用分别返回，不制造 Mock Offer；
- 携程优先监听当前页面 `batchSearch` 结构化响应，DOM 卡片为后备；结构化响应价标记 `provider_response_verified`，DOM 价标记 `listed_only`；
- 只有 Edge 返回可用航班证据时才替换同一库存族的服务端 Connector；Edge 页面失败不会再压掉成功的 FlyAI 官方 API；
- 可见机场名反解为真实 IATA，平台返回的其他城市机场不会冒充用户指定机场。

## 真实验收进度

扩展已在 Edge 开发人员模式加载。`PEK → SHA` 受控查询中，去哪儿返回 20 个卡、同程返回 30 个卡；两者与 SerpApi 在同一次 UI 查询中成功并正确聚合同航班报价。携程正常页面已人工确认存在 7 张航班卡，0.1.1 的结构化响应监听和新 DOM 后备等待扩展重载后的最终复测。飞猪页面 Companion 失败时由正式 FlyAI Connector 接管，不再降低来源覆盖。

当前 102 项包级单元/集成测试、10 项桌面/移动 E2E、类型检查、lint 和生产构建均通过。真实页面成功率只代表本次受控样本，不作为长期 SLO。
