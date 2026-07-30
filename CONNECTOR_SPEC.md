# Connector 规范

```ts
interface FlightConnector {
  readonly metadata: ConnectorMetadata;
  health(signal: AbortSignal): Promise<ConnectorHealth>;
  search(intent: SearchIntent, context: SearchContext): Promise<ConnectorResult>;
}
```

## 强制行为

- 接受 AbortSignal；
- 输出统一 Offer，不向上层泄露供应商结构；
- 报告耗时、查询时间、环境和错误分类；
- 不把超时返回为空结果；
- 不猜测缺失价格、税费或行李；
- 不能比较的报价标记为 `incomparable`；
- 保存最小必要证据，敏感字段必须脱敏；
- Mock Connector 永远标记 `demo`，生产不得启用。
