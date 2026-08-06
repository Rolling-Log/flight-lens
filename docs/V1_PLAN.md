# V1 执行计划

1. 正式基线：单仓多应用、文档、ADR、Git 和 CI；
2. 领域核心：SearchIntent、Offer、Connector、全价、去重、排序、Neon Schema；
3. API：并行编排、来源状态、审计、限流、超时和降级；
4. 双输入前端：条件同步、进度、结果、覆盖、价格与来源；
5. 实时购买交接来源：SerpApi Google Flights 与 Skyscanner Live Prices；Amadeus、Duffel 仅作交叉核验；
6. Staging：Netlify Web、Railway API、Neon、回归和验收报告。

发布门槛仍是两个来源都完成真实生产查询、消费者购买跳转和价格复核；只有 Connector 代码或 Sandbox 响应不算完成。
