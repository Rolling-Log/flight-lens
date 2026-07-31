# Wego 测试凭据申请

Wego 是 Skyscanner 审批期间的付费备选，不是已确认的 V1 第二来源。

官方页面说明：

- 申请邮箱：`affiliates@wego.com`；
- 可先申请最长两周的 Test API Key；
- 正式 API 页面当前标价为每年 USD 1,000；
- 要求真实用户触发、Search-to-Click 不低于 5%，结果只使用 Wego handoff。

商业页面存在无关可疑外链，且完整 API Agreement 需要 Google 登录才能读取。因此付款或签约前，必须以 Wego 的书面回复和最新版合同为准。

## 申请邮件草稿

Subject: Test API access request — Flight Lens China-focused metasearch

```text
Hello Wego Affiliates team,

We are building Flight Lens, a search-only flight metasearch product focused on
domestic China routes and itineraries departing from or arriving in China.

The product does not issue tickets or collect payment. It normalizes live fare
results from authorized sources, clearly identifies the actual airline/OTA
seller, and sends users through the source-provided booking handoff.

We would like to request a two-week Test API key for Wego Flights API.

Before testing, please confirm in writing:

1. May Wego results be displayed and compared alongside other authorized flight
   metasearch/API sources in one user-initiated result page?
2. Is CNY pricing and China domestic/international inventory supported for
   siteCode CN?
3. Is USD 1,000 still the current annual production API fee?
4. Which current API Agreement and branding rules apply?
5. Are there payment-method IDs recommended for users in Mainland China?

Our implementation creates one Wego search per explicit user action, polls only
that Search ID, does not preload handoff links through automated clicks, and
accepts only official https://handoff.wego.com/flights/continue links.

Product name: Flight Lens (航探)
Current stage: V1 development / pre-launch

Thank you.
```

不要在邮件中发送 SerpApi、Skyscanner、数据库或部署凭据。
