# Offer 数据模型

`Offer = Itinerary + Fare + Taxes + Ancillaries + Rules + Seller + Eligibility + Timestamp + Evidence`

## 不变量

- 所有金额使用整数最小货币单位；
- 原始币种与人民币换算值同时保留；
- 汇率带来源和时间；
- 总价可追溯到构成项；
- 每个 Offer 有 seller、fetchedAt 和 environment；
- seller 交接精度明确为 `exact_offer` 或 `search_results`；后者不能显示成精确报价直达；
- `legs` 明确区分单程、去程和返程，`segments` 通过 `legIndex` 归属；
- 每个 leg 的总耗时包含中转等待时间，不能用航段飞行时长简单相加代替；
- 往返各一段直飞必须表示为两个 `stopCount = 0` 的 leg，不能误算为一次中转；
- 没有完整税费时不得标记为“可比全价”；
- 代码共享同时保存营销和实际承运航司；
- 当地时间带 IANA 时区或可靠 UTC 偏移；
- 深链和证据不得含密钥或敏感身份信息。
- 供应商要求原样 POST 的 opaque payload 不进入前端、不写审计库，也不得为了构造链接而改写。

V1 对 leg 与 segment 的引用关系、机场、时间、经停数和总耗时执行确定性一致性校验；不一致的 Offer 不参与最低价或推荐。

Neon 审计写入每个可比 Offer 时同步建立一条 `pending_landing_page_verification` 价格核验记录，保存当时预期金额、币种和最小证据引用。后续观察到来源最终页价格后更新 `observedAmountMinor` 和状态；未复核时不得计算为已验证偏差。
