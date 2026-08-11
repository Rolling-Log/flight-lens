# 四来源接入清单

更新时间：2026-08-11

## 当前结论

| 角色 | 目标 | 当前候选 | 状态 |
| --- | ---: | --- | --- |
| 购买交接 | 2 | SerpApi Google Flights、同程实时页面 | 已在同次本地查询成功；同程价格仍需来源页复核 |
| 生产核验 | 2 | Duffel Flights、PKFARE Buyer API | Duffel 仅 Test mode；PKFARE 等买家账号与合作权限 |

Skyscanner Partner Portal 无法完成登录，当前不再阻塞 V1。Amadeus Self-Service 已停止作为新接入目标。两套 Connector 代码可以保留用于未来正式授权，但没有凭据时不注册到运行时。

只有 production 配置和真实查询才计数。Duffel Test、固定响应测试、缓存价格和只有代码没有凭据的来源都不能证明实时价格。

## 国内四来源已完成

- 飞猪：接入官方 `@fly-ai/flyai-cli`，匿名额度耗尽时返回 `FLYAI_API_KEY_REQUIRED`；
- 携程：接入 batchSearch 响应映射和 DOM 降级；当前 WhaleGuard 阻断记为 `page_changed`；
- 去哪儿：接入中文城市查询 URL 和 DOM 映射；当前搜索壳页不误报为空结果；
- 同程：公开结果页实时查询已成功，三条国内航线各返回 30 个 `listed_only` Offer；
- 所有页面 Connector 使用隔离浏览器会话，不复用用户个人 Cookie，不绕过登录、验证码或访问控制。

## 其他来源已完成

- SerpApi、FlightAPI、Skyscanner、Duffel 使用同一 Connector Registry；
- 所有密钥只从服务端环境变量读取；
- FlightAPI 使用官方单程/往返只读价格接口，并设置每进程调用上限；
- FlightAPI 明确登记为 `skyscanner-metasearch` 库存族，不与 Skyscanner 重复计数；
- FlightAPI 结果标记 `SKYSCANNER_DERIVED_SOURCE`，授权未复核前只用于本地实验；
- Duffel 请求使用 API v2 和有界的行程条件；
- 只有 `duffel_live_` token 才把 Duffel 标记为 production；
- Duffel Offer 标记为 `verification` 和 `NO_PURCHASE_HANDOFF`；
- API `/health` 和 `/v1/meta/connectors` 披露生产来源、购买交接、核验和库存族数量；
- 固定响应自动化测试不会调用供应商，也不会消耗额度。

## 需要用户登录

### FlightAPI（本地实验替代 Skyscanner）

注册：<https://api.flightapi.io/register>

登录：<https://api.flightapi.io/login>

官方页面当前提供 20 次免费调用，价格 API 每次消耗 2 credits。注册后只需要在 Dashboard 生成 API Key，不购买套餐、不添加支付卡。

本地变量：

```dotenv
FLIGHTAPI_API_KEY=
FLIGHTAPI_BASE_URL=https://api.flightapi.io
FLIGHTAPI_MAX_SEARCHES_PER_PROCESS=10
```

这个来源返回 Skyscanner 衍生的供应商价格与跳转。它能帮助验证本地多源流程，但在供应商数据授权和跳转条款确认前，不计入正式 V1 发布验收。

### Duffel

控制台：<https://app.duffel.com/>

当前账户已登录，但页面明确显示 Test mode。进入 Live 需要在控制台点击 `Go live`，填写组织、业务和 KYC 资料并接受服务协议。

本地变量：

```dotenv
DUFFEL_ACCESS_TOKEN=
DUFFEL_BASE_URL=https://api.duffel.com
```

创建订单、付款方式、余额充值或任何可能产生费用的步骤不属于当前搜索验证范围，必须另行确认。Test token 只能验证协议，不能作为真实来源。

### PKFARE（替代 Amadeus）

买家注册：<https://sign.pkfare.com/sign/sign-up>

机票业务：<https://www.pkfare.com/cn/flight>

PKFARE 官方披露接入中国航信、Amadeus、Sabre、Travelport、航司直连与第三方供应，适合补充中国航线。但它是 B2B 搜索、预订、出票平台，必须先完成买家账号和商务权限；公开文档不足以在没有账号参数时安全猜测生产认证协议。

取得 Buyer API 文档、测试凭据和 production 域名后，再实现 Connector。默认角色是 `verification`；只有合同明确允许消费者跳转且返回合法落点时，才考虑进入购买推荐。

### Skyscanner（暂停）

Partner Portal 当前停在 Auth0 密码流程，消费者天巡账号不能替代 Partner API 权限。现有 Connector 和品牌展示代码保留，但不再要求本轮继续尝试登录。

## 凭据到位后的验证顺序

每个来源单独验证，禁止第一次就并发消耗多个来源额度：

1. 只读检查账户模式、套餐、剩余额度和 production/sandbox 状态；
2. 使用固定未来日期、1 位成人、经济舱执行一次受控搜索；
3. 记录来源状态、Offer 数、价格字段、库存族、响应时间和额度变化；
4. 复核 FlightAPI 的供应商名称、Skyscanner 跳转与落地页价格；
5. Duffel 结果保持不可购买，只用于交叉核验；
6. PKFARE 在商务授权和协议明确前不发生产请求；
7. 单来源通过后才加入本地并发搜索；
8. 全部结果继续经过统一 Offer 校验、去重、条件过滤和来源披露。

## 不接入的方式

- 绕过验证码、登录、风控或移动 App 接口签名；
- 把受阻页面、登录页或搜索壳页误报为实时空结果；
- 把 FlightAPI 与 Skyscanner 计算成两个独立库存族；
- 把时刻表 API、历史最低价或缓存 indicative price 当作实时可购买价；
- 使用测试 token、演示航司或 Sandbox 数据填充 production 来源数量。
