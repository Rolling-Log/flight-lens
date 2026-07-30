# Offer 数据模型

`Offer = Itinerary + Fare + Taxes + Ancillaries + Rules + Seller + Eligibility + Timestamp + Evidence`

## 不变量

- 所有金额使用整数最小货币单位；
- 原始币种与人民币换算值同时保留；
- 汇率带来源和时间；
- 总价可追溯到构成项；
- 每个 Offer 有 seller、fetchedAt 和 environment；
- 没有完整税费时不得标记为“可比全价”；
- 代码共享同时保存营销和实际承运航司；
- 当地时间带 IANA 时区或可靠 UTC 偏移；
- 深链和证据不得含密钥或敏感身份信息。
