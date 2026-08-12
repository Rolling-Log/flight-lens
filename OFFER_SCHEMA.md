# Offer 数据模型

`Offer = Itinerary + Fare + Taxes + Ancillaries + Rules + Seller + Eligibility + Timestamp + Evidence`

## 不变量

- 所有金额使用整数最小货币单位；
- 原始币种与人民币换算值同时保留；
- 汇率带来源和时间；
- 非人民币原价参与比较时必须同时提供 `totalPriceCny` 与 `exchangeRate`；汇率证据包含基准币、报价币、数值、来源和 `quotedAt`，缺失或币种不一致即不可比较；
- 总价可追溯到构成项；
- 每个 Offer 有 seller、fetchedAt 和 environment；
- seller 交接精度明确为 `exact_offer` 或 `search_results`；后者不能显示成精确报价直达；
- `legs` 明确区分单程、去程和返程，`segments` 通过 `legIndex` 归属；
- 每个 leg 的总耗时包含中转等待时间，不能用航段飞行时长简单相加代替；
- 往返各一段直飞必须表示为两个 `stopCount = 0` 的 leg，不能误算为一次中转；
- 没有完整税费时不得标记为“可比全价”；
- 会员、新客、银行卡、App 专享等资格价不得进入无门槛自然最低价；资格条件保留在 `eligibility`，并回写为不可比较原因；
- 代码共享同时保存营销和实际承运航司；
- 当地时间带 IANA 时区或可靠 UTC 偏移；
- 深链和证据不得含密钥或敏感身份信息。
- 供应商要求原样 POST 的 opaque payload 不进入前端、不写审计库，也不得为了构造链接而改写。

V1 对 leg 与 segment 的引用关系、机场、时间、经停数和总耗时执行确定性一致性校验；不一致的 Offer 不参与最低价或推荐。

Neon 审计写入每个可比 Offer 时同步建立一条 `pending_landing_page_verification` 价格核验记录，保存当时预期金额、币种和最小证据引用。后续观察到来源最终页价格后更新 `observedAmountMinor` 和状态；未复核时不得计算为已验证偏差。

受控运维核价使用数据库包的 `price:verify` CLI，不开放匿名公网写接口。状态包括：

- `verified_match`：观察价与预期价一致；
- `verified_price_changed`：观察价与预期价不同；
- `sold_out`：来源落地页已无票；
- `landing_unavailable`：落地页无法完成核验。

偏差以 `observed - expected` 的最小货币单位和绝对基点计算；100 基点等于 1%。证据只保存脱敏引用，不保存带 Token 的完整跳转 URL、Cookie 或个人信息。
