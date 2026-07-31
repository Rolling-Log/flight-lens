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
- 没有合法消费者交接的报价只能用于发现或核验，不能进入最低价结论；
- 交接精度必须标记为 `exact_offer` 或 `search_results`；后者必须提示重新选择和再次核价；
- 明确区分数据聚合方、实际售卖方和用户最终跳转平台；
- 保存最小必要证据，敏感字段必须脱敏；
- 有限日期浮动默认由编排层拆成明确的精确日期探测，Connector 报告记录实际日期和部分失败；
- 若供应商以 Search-to-Click 等指标限制每次用户动作的搜索次数，Connector 必须声明不支持自动日期探测，仅查询基准日并在来源报告披露；
- 往返 Offer 必须分别输出 legs，不能把返程段计作中转；
- 异步来源必须轮询到明确完成状态；未完成会话不能伪装为完整结果；
- Mock Connector 永远标记 `demo`，生产不得启用。

`resultRole = purchase_handoff` 只表示 Connector 有能力返回消费者交接。具体 Offer 仍必须存在经过协议校验的 HTTPS deeplink，才能设置 `comparable = true`。

供应商要求原样 POST 的 opaque payload 不得为了生成 GET 链接而解码、重编码或拼接。若供应商同时返回带完整搜索条件的官方结果页 URL，可使用 `handoffPrecision = search_results`，但界面必须说明它不是精确 Offer 落点。

Wego 结果只接受 `https://handoff.wego.com/flights/continue` 作为消费者交接；其他域名或路径一律标记为不可比。Wego 单次用户动作只创建一个基准日搜索，会轮询同一 Search ID，不参与编排层的 ±N 天扩展。
