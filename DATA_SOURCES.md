# 数据源策略

## 优先级

1. 航司 NDC、直连或正式 API；
2. GDS、航信或授权聚合服务；
3. OTA 开放平台或合作接口；
4. Affiliate 或元搜索合作 Feed；
5. 获准的官网核验。

浏览器自动化只用于补充验证，不绕过验证码、登录、访问控制或付费限制。

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
| SerpApi Google Flights | 已完成首个生产受控验证 | 已实现单程/往返选择、booking options、实际售卖方、GET 精确落点与官方 Google Flights 条件结果页降级；POST 请求不会被违规改写 | 再验证国内和入境路线、往返链路、价格新鲜度和落点重选提示 |
| Wego Affiliate Flights | 付费购买交接备选 Connector 已实现 | 官方 API 返回实时 Fare、实际 provider 和 Wego handoff；实现只接受官方 HTTPS handoff，并因 Search-to-Click 约束只做基准日搜索。商业页面当前标价 USD 1,000/年，可先申请最长两周测试 Key | 取得测试凭据、书面确认允许多源并列、审核最新版 API Agreement、实测中国航线/CNY/支付费/落点；未经用户确认不付费 |
| Travelpayouts / Aviasales Search API | 拒绝接入 | 2025-11-01 起的新 Search API 要求已有 50,000 MAU，且官方使用规则禁止与其他航班元搜索 API 合并；与本产品核心冲突 | 不接入；Data API 也不能伪装成实时可购买价格 |
| Kiwi.com Tequila | 暂不接入 | 2024 年起新合作改为邀请制，只面向与其战略匹配的选定合作方 | 仅在取得明确邀请与允许多源比较的合同后重审 |
| Amadeus Self-Service Flight Offers | 交叉核验 | 生产环境可提供实时 published GDS fare，但不覆盖低成本航司等重要内容，且没有消费者购买 deeplink | 仅作核验；不得单独进入可购买最低价 |
| Duffel Flights API | 交叉核验 | Test mode 明确不是真实时刻/价格；标准流程要求接入方继续创建订单 | 仅作协议与价格核验；无购买交接时不得推荐 |
| PKFARE Flight Buyer API | 中国覆盖合作候选 | 包含中国航信、GDS、航司直连等广泛内容，但面向 OTA/旅行社继续下单出票 | 若取得仅搜索+合法消费者交接合作再接入；否则只核验 |

### 官方依据

- Skyscanner API 需 Partnerships 审批，且其定价数据授权以产生最终预订为前提；展示数据时必须遵循品牌、跨日和跳转规范：<https://developers.skyscanner.net/docs/getting-started/authentication>、<https://developers.skyscanner.net/docs/getting-started/usage-guidelines>、<https://developers.skyscanner.net/docs/faqs>
- Skyscanner Live Prices 使用 `/create` + `/poll`，只有 `RESULT_STATUS_COMPLETE` 才形成完整结果；价格整数需按 `PriceUnit` 换算：<https://developers.skyscanner.net/docs/flights-live-prices/overview>、<https://developers.skyscanner.net/docs/getting-started/enums>
- SerpApi Google Flights 与 Booking Options 参数及字段：<https://serpapi.com/google-flights-api>、<https://serpapi.com/google-flights-booking-options>
- Wego Affiliate API 要求真实用户触发、至少 5% Search-to-Click、只展示 Wego handoff；Flight API 返回 Fare、Provider 与 handoff URL，凭据需联系申请。其商业页当前写明 USD 1,000/年和最长两周测试 Key，但页面夹杂明显无关外链，必须向官方重新书面确认商业条款：<https://developers.wego.com/docs/affiliate/get-started/>、<https://developers.wego.com/docs/affiliate/guides/flights/>、<https://developers.wego.com/docs/affiliate/terms-of-service/>、<https://company.wego.com/api-overview/>
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

每个 Connector 必须登记授权依据、环境、支持范围、字段、限流、成本、新鲜度、深链、失败策略和当前状态。
