# V1 本地验收报告

日期：2026-08-11  
范围：不部署 Netlify / Railway / Neon，仅验收本地真实查询上限。

## 结论

V1 本地多来源真实查询链路通过：一次 `PEK → SHA` 查询中，同程返回 30 个实时页面 Offer，SerpApi / Google Flights 返回 4 个实时 Offer。`XIY ⇄ NNG` 往返中，同程返回 10 个明确标记的分开购买组合，SerpApi 返回 2 个原生往返 Offer。系统没有用 Mock 或缓存价格填补失败来源。

四个国内 Connector 均已接入统一 Registry：

| 来源 | 实测状态 | Offer | 当前边界 |
| --- | --- | ---: | --- |
| 同程 | `success` | 单程 30 / 往返组合 10 | 页面展示价，`listed_only`；往返由两次真实单程查询组合，不冒充原生往返价 |
| 飞猪 FlyAI | `auth_error` | 0 | 官方匿名额度耗尽，需要正式 `FLYAI_API_KEY` |
| 携程 | `page_changed` | 0 | 实测为 WhaleGuard 阻断页，不生成虚假结果 |
| 去哪儿 | `page_changed` | 0 | 匿名页面仅返回日期价格带，未返回可验证航班卡，不把日历起价冒充航班 Offer |
| SerpApi / Google Flights | `success` | 4 | Booking Options 二次核价为 `detail_verified`；结果页落点仍需重新选择并在支付页复核 |

## 三航线稳定性

| 航线 | 日期 | 来源 | Offer 数 | 样例最低展示价 |
| --- | --- | --- | ---: | ---: |
| PEK → SHA | 2026-09-10 | 同程 | 30 | ¥350 |
| SHA → CAN | 2026-09-12 | 同程 | 30 | ¥350 |
| CAN → CTU | 2026-09-15 | 同程 | 30 | ¥369 |
| PVG → NRT | 2026-09-10 | SerpApi / Google Flights | 9 | ¥1065（`detail_verified`） |
| XIY ⇄ NNG | 2026-09-11 / 2026-09-19 | 同程分开购买 + SerpApi | 10 + 2 | 同程 ¥950（¥500 + ¥450，`listed_only`） |

价格是对应测试时刻观察值，不保证持续存在。

## 可复现命令

```bash
pnpm --filter @flight-lens/connectors smoke:domestic -- PEK SHA 2026-09-10
pnpm --filter @flight-lens/api smoke:live -- PEK SHA 2026-09-10
```

本地 API 的 `.env` 需启用：

```dotenv
FLYAI_ENABLED=true
DOMESTIC_BROWSER_CONNECTORS_ENABLED=true
BROWSER_EXECUTABLE_PATH=/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge
BROWSER_HEADLESS=true
BROWSER_PROXY_SERVER=http://127.0.0.1:7890
```

## 验收功能

- 自然语言与表单输入共享 SearchIntent；
- 精确筛选支持中文、拼音、英文与 IATA 的城市/机场组合框；北京、上海、成都等城市会在搜索规划中展开机场组合；
- 支持单程/往返、成人数、四档舱位、预算、时间、中转和行李条件；
- 来源并行执行，硬超时，失败互不拖累；
- Offer 统一字段、成人总价、来源、时间、航段、跳转与价格核验等级；
- 同航班跨平台聚合；按价格、耗时、中转排序；按航司和中转过滤；
- SerpApi Booking Options 完成卖方级二次核价，并与初始列表展示价分级；
- Connector 公开结构化能力声明；不适用当前查询的来源不进入覆盖率分母；
- 同程与去哪儿往返使用两次独立单程检索，保留两段价格、链接和抓取时间，并明确标记 `split_ticket`；
- 搜索中显示已配置来源，结束后逐项显示成功、空、超时、限流、需登录、验证码、页面变化或来源异常；
- Mock 仅存在于自动测试，不作为运行时降级。

## 工程验证

- 6 个 workspace 的类型检查通过；API / Web lint 通过；
- 87 个包级单元与集成测试通过；
- Edge 桌面与移动视口共 10 个 E2E 流程通过；
- API 与 Next.js 生产构建通过；
- 真实结果页在 `1440 × 900` 和 `390 × 844` 下无横向溢出或控件重叠，浏览器控制台无 warning / error。

## 尚未完成

- FlyAI 正式 Key；
- 携程与去哪儿的稳定生产成功路径；
- `PEK → SHA` 仍只有 2 个独立成功来源，尚未达到 Goal 要求的 3 个；FlyAI Key 或用户侧真实浏览器 Connector 是当前补足路径；
- 同程价格的详情/支付页二次核验，以及所有来源的最终支付页复核；
- 云端部署、Neon 实库迁移与线上浏览器运行环境；
- 长期 SLO、限流和页面变化监控。
