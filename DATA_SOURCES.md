# 数据源策略

## 成本硬约束

- V1 优先使用长期存在的 `$0` 免费计划或不向本项目收费的合作；付费来源必须经过单独的价值、授权和月度预算审批；
- 所有来源都必须设置应用级硬配额，不允许自动升级、自动超额或产生不可控账单；
- 免费额度或批准预算耗尽时必须公开标记来源不可用，不能静默切换套餐；
- 供应商后来改变价格政策时，Connector 默认停用，重新审查后才能恢复。

## 优先级

1. 航司 NDC、直连或正式 API；
2. GDS、航信或授权聚合服务；
3. OTA 开放平台或合作接口；
4. Affiliate 或元搜索合作 Feed；
5. 获准的官网核验。

浏览器自动化只用于补充验证，不绕过验证码、登录、访问控制或付费限制。

## V1 的 2+2 来源结构

“四个 Connector”不是“四个都能进入最低价”。当前采用两个独立门槛：

1. V1 发布门槛：至少 2 个 production `purchase_handoff` 来源，能够把用户合法带到继续核验或购买的来源页面；
2. 稳定运营目标：在上述 2 个来源之外，再接入至少 2 个 production `verification` 来源，用于发现价格或行程反例；
3. Sandbox、测试 token、缓存样本和只有代码没有凭据的 Connector 都不计入 production 数量；
4. 每个来源登记 `inventoryFamily`，用于披露库存依赖，避免把同一上游的多个包装 API 夸大为独立证据。

当前进度为：购买交接 `1/2`，生产核验 `0/2`，生产运营来源合计 `1/4`。

## 进入最低价比较的硬门槛

一个来源能返回航班和价格，并不等于它适合本产品。进入“最低可购买价”的 Offer 必须同时满足：

1. 来源授权允许展示价格；
2. 价格是当前查询的实时或可验证结果，而不是演示/缓存样本；
3. 含税费和所有用户明确要求的必要项目；
4. 能合法交接到实际航司/OTA 的对应购买页，或带完整搜索条件的官方来源结果页；
5. 可在交接前再次核验价格与有效期；
6. 平台名称、数据来源和购买方不混为一谈。

只提供由接入方继续下单/出票能力、却没有消费者购买落点的 API，可以用于发现或交叉核验，但不能单独形成最终推荐。

精确 Offer 落点与来源结果页必须明确区分。后者可以基于已返回的实时 Booking Option 参与价格比较，但按钮和风险说明必须告知用户需要重新选择相同行程，不能称为“一键购买此报价”。

## V1 候选审查（2026-07-31）

| 来源 | 当前角色 | 结论 | V1 发布条件 |
|---|---|---|---|
| Skyscanner Flights Live Prices | 购买交接 Connector 已实现，合作申请已提交 | 已实现 create/poll、PriceUnit、leg/segment、实际 agent、deeplink、多票与自助中转拦截、官方品牌展示；2026-07-31 已提交 Partnerships 申请，等待审批 | 获批 API Key、生产查询、deeplink 与支付页价格复核 |
| SerpApi Google Flights | 已完成首个生产受控验证；仅允许 `$0` Free 计划 | 已实现单程/往返选择、booking options、实际售卖方、GET 精确落点与官方 Google Flights 条件结果页降级；POST 请求不会被违规改写。官方 Free 计划当前为每月 250 次、无需信用卡，不是限时试用；运行时会在搜索前拒绝付费账号或不足额度，并禁止自动灵活日期扩搜。实时查询使用默认快速模式而非更慢的 `deep_search`，为用户等待时间和上游超时留出边界。附近机场使用官方支持的逗号分隔多出发机场参数，只展开 V1 已登记机场组并在来源报告披露 | 绝不自动升级；再验证国内和入境路线、往返链路、价格新鲜度和落点重选提示 |
| Wego Affiliate Flights | 暂不接入 | 生产 API 当前要求年费，测试 Key 最长两周；V1 尚未证明足以承担该固定成本的用户价值，已移除 Connector 和申请材料 | 只有在授权允许多源比较、用户价值已验证且预算获批后重审 |
| Travelpayouts / Aviasales Search API | 拒绝接入 | 2025-11-01 起的新 Search API 要求已有 50,000 MAU，且官方使用规则禁止与其他航班元搜索 API 合并；与本产品核心冲突 | 不接入；Data API 也不能伪装成实时可购买价格 |
| Kiwi.com Tequila | 暂不接入 | 2024 年起新合作改为邀请制，只面向与其战略匹配的选定合作方 | 仅在取得明确邀请与允许多源比较的合同后重审 |
| Amadeus Self-Service Flight Offers | 生产核验候选；Connector 与固定响应测试已完成 | 只有官方 production 域名才标记为生产；可提供 published GDS fare，但不覆盖低成本航司等重要内容，且没有消费者购买 deeplink | 创建开发者应用并取得 production 凭据；仅作核验，不进入可购买最低价 |
| Duffel Flights API | 生产核验候选；Connector 与固定响应测试已完成 | 只有 `duffel_live_` token 才标记为生产；Test mode 不是真实时刻/价格，标准流程要求接入方继续创建订单 | 完成账户与 live mode 审核；仅作核验，不进入可购买最低价 |
| PKFARE Flight Buyer API | 中国覆盖合作候选 | 包含中国航信、GDS、航司直连等广泛内容，但面向 OTA/旅行社继续下单出票 | 若取得仅搜索+合法消费者交接合作再接入；否则只核验 |

### 官方依据

- Skyscanner API 需 Partnerships 审批，且其定价数据授权以产生最终预订为前提；展示数据时必须遵循品牌、跨日和跳转规范：<https://developers.skyscanner.net/docs/getting-started/authentication>、<https://developers.skyscanner.net/docs/getting-started/usage-guidelines>、<https://developers.skyscanner.net/docs/faqs>
- Skyscanner Live Prices 使用 `/create` + `/poll`，只有 `RESULT_STATUS_COMPLETE` 才形成完整结果；价格整数需按 `PriceUnit` 换算：<https://developers.skyscanner.net/docs/flights-live-prices/overview>、<https://developers.skyscanner.net/docs/getting-started/enums>
- SerpApi Google Flights 与 Booking Options 参数及字段：<https://serpapi.com/google-flights-api>、<https://serpapi.com/google-flights-booking-options>
- SerpApi 官方定价当前包含长期 `$0` Free 计划，每月 250 次且无需信用卡；项目只允许使用该计划，额度耗尽即停用来源：<https://serpapi.com/pricing>
- Wego 商业页当前写明生产年费与最长两周测试 Key；V1 暂不承担该固定成本：<https://company.wego.com/api-overview/>
- Amadeus Test 是受限缓存数据，Production 才是完整实时数据；Self-Service 不含低成本航司及部分大型航司：<https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/test-data/>、<https://developers.amadeus.com/self-service/apis-docs/guides/developer-guides/faq/>
- Duffel Test mode 不保证真实时刻或价格：<https://duffel.com/docs/api/overview/test-mode>
- PKFARE 官方说明其接入中国航信、GDS、航司直连等内容，Buyer API 的 production 域名需完成合作联调后提供：<https://www.pkfare.com/cn/flight>、<https://apifox.pkfare.com/apidoc/project-345083/doc-338127>
- Travelpayouts 新 Search API 仅开放给已有 50,000 MAU 的项目，并明确禁止与其他航班元搜索 API 合并：<https://support.travelpayouts.com/hc/en-us/articles/210995808-How-to-get-access-to-the-Aviasales-Search-API>、<https://support.travelpayouts.com/hc/en-us/articles/34788165535250-Search-API-usage-rules>
- Kiwi.com 已将新的 Tequila 合作改为邀请制：<https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/>

候选不等于已经覆盖。只有通过真实查询、价格字段核验和授权审查的来源，才能在产品中显示为“实时来源”。

### 受控生产验证记录

- 2026-07-31，SerpApi 生产账号，PVG → NRT、单程、成人经济舱、固定日期；
- 请求链路完成初始搜索与 Booking Options，返回 8 个标准化且价格口径可比的 Offer；
- 当次最低 CNY 价格为 ¥1,402，实际售卖方为 Spring；
- 售卖方返回的是 Google 要求的原样 POST 请求，因此系统没有解码或改写该请求；改用 SerpApi 返回的官方 `google_flights_url` 作为“结果页重新选择”落点；
- Connector 健康检查为 `healthy`；
- 该记录只证明单次受控查询成功，不代表第二来源、全部航线或长期 SLO 已通过。V1 多来源门禁仍为 1/2。

### Staging 扩展验证（2026-08-04）

- 北京首都 `PEK` → 上海浦东 `PVG` 单程直飞返回 4 个可比报价；最低候选价曾为 CNY 500，售卖方标示为 Trip.com；
- 上海浦东 `PVG` → 东京成田 `NRT` 往返在移除 `deep_search` 后于 17.772 秒完成，返回 4 个可比报价，最低候选价为 CNY 3,198，售卖方 Spring；
- 新加坡 `SIN` → 广州 `CAN` 单程直飞于 22.274 秒完成，返回 12 个可比报价，最低候选价为 CNY 1,007，售卖方 Scoot；
- 公开落地页复核时，同条件 `PEK` → `PVG` 的 Google Flights 当前最低价已变为 CNY 2,520，此前 Trip.com 候选不可见。该偏差验证了结果页交接的固有限制：候选价必须显示获取时间、交接精度和“购买前重新确认”提示，不能保证旧价格持续有效；
- Railway API 使用长驻 Fastify 进程，但 Connector 仍在 20 秒主动超时，Neon 审计写入最多等待 3 秒并可降级披露，避免单个供应商或数据库阻塞请求；SerpApi 使用默认快速模式并保留 `no_cache=true`，落地页仍承担最终可售性与价格复核；
- SerpApi 除 `$0` 套餐和剩余额度检查外，还使用账户级月度 credit 硬上限：代码默认 200/250，Staging 为 100。门禁依据供应商账户的全局用量而非单个 Railway 进程；并发请求仍可能在读取用量与实际扣减之间产生小幅竞态，因此 Staging 预留 150 credits 安全余量且不做真实搜索压测；
- 以上均为特定时刻的受控观察值，不代表持续价格，也不改变 V1 双来源门禁仍为 1/2 的结论。

每个 Connector 必须登记授权依据、环境、支持范围、字段、限流、成本、新鲜度、深链、失败策略和当前状态。

登录、凭据和生产验证的操作顺序见 [`docs/PROVIDER_ONBOARDING.md`](docs/PROVIDER_ONBOARDING.md)。
