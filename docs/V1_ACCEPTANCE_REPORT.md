# V1 本地验收报告

日期：2026-08-11  
范围：不部署 Netlify / Railway / Neon，仅验收本地真实查询上限。

## 结论

V1 本地多来源真实查询链路通过：一次 `PEK → SHA` 查询中，同程返回 30 个实时页面 Offer，SerpApi / Google Flights 返回 4 个实时 Offer。系统没有用 Mock 或缓存价格填补失败来源。

四个国内 Connector 均已接入统一 Registry：

| 来源 | 实测状态 | Offer | 当前边界 |
| --- | --- | ---: | --- |
| 同程 | `success` | 30 | 页面展示价，`listed_only`，购买前必须复核 |
| 飞猪 FlyAI | `auth_error` | 0 | 官方匿名额度耗尽，需要正式 `FLYAI_API_KEY` |
| 携程 | `page_changed` | 0 | 实测为 WhaleGuard 阻断页，不生成虚假结果 |
| 去哪儿 | `page_changed` | 0 | 当前只得到搜索壳页，不误报为真实空结果 |
| SerpApi / Google Flights | `success` | 4 | 实际售卖方报价；结果页落点需重新选择核验 |

## 三航线稳定性

| 航线 | 日期 | 来源 | Offer 数 | 样例最低展示价 |
| --- | --- | --- | ---: | ---: |
| PEK → SHA | 2026-09-10 | 同程 | 30 | ¥350 |
| SHA → CAN | 2026-09-12 | 同程 | 30 | ¥350 |
| CAN → CTU | 2026-09-15 | 同程 | 30 | ¥369 |

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
- 支持单程/往返、成人数、四档舱位、预算、时间、中转和行李条件；
- 来源并行执行，硬超时，失败互不拖累；
- Offer 统一字段、成人总价、来源、时间、航段、跳转与价格核验等级；
- 同航班跨平台聚合；按价格、耗时、中转排序；按航司和中转过滤；
- 搜索中显示已配置来源，结束后逐项显示成功、空、超时、限流、需登录、验证码、页面变化或来源异常；
- Mock 仅存在于自动测试，不作为运行时降级。

## 工程验证

- 6 个 workspace 的类型检查通过；API / Web lint 通过；
- 84 个包级单元与集成测试通过；
- Edge 桌面与移动视口共 8 个 E2E 流程通过；
- API 与 Next.js 生产构建通过；
- 真实结果页在 `1440 × 900` 和 `390 × 844` 下无横向溢出或控件重叠，浏览器控制台无 warning / error。

## 尚未完成

- FlyAI 正式 Key；
- 携程与去哪儿的稳定生产成功路径；
- 同程价格的支付页二次核验与长期展示许可复核；
- 云端部署、Neon 实库迁移与线上浏览器运行环境；
- 长期 SLO、限流和页面变化监控。
