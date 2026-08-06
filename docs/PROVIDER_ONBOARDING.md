# 四来源接入清单

更新时间：2026-08-06

## 目标

V1 发布与稳定运营使用不同门槛：

| 角色 | 目标 | 候选 | 当前状态 |
| --- | ---: | --- | --- |
| 购买交接 | 2 | SerpApi Google Flights、Skyscanner Live Prices | SerpApi 已生产验证；Skyscanner 等审批 |
| 生产核验 | 2 | Amadeus Flight Offers、Duffel Flights | Connector 已完成；等待账户和生产凭据 |

只有 production 配置和真实查询才计数。Amadeus Test 与 Duffel Test 都是 Sandbox；它们可验证协议，不能证明真实价格。

## 登录前已完成

- 四个 Connector 已注册到同一 Connector Registry；
- 所有密钥只从服务端环境变量读取；
- Amadeus OAuth token 会缓存并在过期前刷新；
- Duffel 请求使用 API v2 和有界的行程条件；
- Amadeus 只有 `https://api.amadeus.com` 才标记为 production；
- Duffel 只有 `duffel_live_` token 才标记为 production；
- Amadeus/Duffel Offer 均标记为 `verification` 和 `NO_PURCHASE_HANDOFF`；
- 每个来源登记独立 `inventoryFamily`；
- API `/health` 和 `/v1/meta/connectors` 分别披露生产总数、购买交接数、核验数和 2+2 readiness；
- 固定响应自动化测试不会调用供应商，也不会消耗额度。

## 需要用户登录

### Amadeus for Developers

入口：<https://developers.amadeus.com/>

登录后需要：

1. 创建一个 Self-Service 应用；
2. 先生成 Test API Key 与 Secret，验证 OAuth 和 Flight Offers Search；
3. 查看账户是否允许切换到 Production，并确认当前价格与免费额度；
4. Production 获批后生成独立生产凭据。

本地变量：

```dotenv
AMADEUS_CLIENT_ID=
AMADEUS_CLIENT_SECRET=
AMADEUS_BASE_URL=https://test.api.amadeus.com
```

真实生产验证时才把 Base URL 改为 `https://api.amadeus.com`。凭据不得粘贴到聊天、截图或提交到 Git。

### Duffel

创建账户：<https://app.duffel.com/join>

已有账户：<https://app.duffel.com/sign-in>

登录后需要：

1. 在 Developer test mode 创建 `duffel_test_` token；
2. 验证 Offer Request 协议，但不得把 Test mode 结果称为真实；
3. 查看 Going live 所需的组织资料、合规审核和计费条件；
4. 只有明确接受条件并获批后才创建 `duffel_live_` token。

本地变量：

```dotenv
DUFFEL_ACCESS_TOKEN=
DUFFEL_BASE_URL=https://api.duffel.com
```

创建订单、付款方式、余额充值或任何可能产生费用的步骤不属于当前搜索验证范围，必须另行确认。

### Skyscanner Partnerships

申请入口：<https://www.partners.skyscanner.net/contact/general>

项目记录显示申请已于 2026-07-31 提交。需要登录或检查申请邮箱，确认是否获批并取得 API Key。Skyscanner 官方要求搜索能够产生最终预订，因此 deeplink 和品牌规范是强制条件。

本地变量：

```dotenv
SKYSCANNER_API_KEY=
SKYSCANNER_BASE_URL=https://partners.api.skyscanner.net
```

## 凭据到位后的验证顺序

每个来源单独验证，禁止第一次就四来源并发：

1. 只调用只读 health 或认证接口；
2. 确认账户计划、额度、费用和 production/sandbox 环境；
3. 使用固定未来日期、1 位成人、经济舱执行一次受控搜索；
4. 记录来源状态、Offer 数、价格字段、库存族、响应时间和额度变化；
5. Amadeus/Duffel 结果保持不可购买，只用于交叉核验；
6. Skyscanner deeplink 必须复核落地页价格；
7. 单来源通过后才加入四来源本地并发搜索；
8. 全部结果继续经过统一 Offer 校验、去重、条件过滤和来源披露。

## 不接入的方式

- 携程、飞猪、去哪儿等未授权页面抓取；
- 绕过验证码、登录、风控或移动 App 接口签名；
- 将 SearchAPI、RapidAPI 等同一 Google/Skyscanner 包装器算作独立来源；
- 把时刻表 API、历史最低价或缓存 indicative price 当作实时可购买价；
- 使用测试 token、演示航司或 Sandbox 数据填充 production 来源数量。
