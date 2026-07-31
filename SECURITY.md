# 安全基线

- 密钥只在服务端和托管平台 Secret 中；
- 输入使用 Schema 校验；
- 外部 AI 只生成候选意图，必须再次通过同一 `SearchIntent` Schema；它不能调用 Connector、生成价格或绕过确定性规则；
- API 配置 CORS、限流、请求大小和超时；
- 日志默认脱敏；
- 不保存供应商 Token、支付或证件信息；
- Runtime 使用池化数据库连接，Migration 使用直连；
- 依赖锁定并进入 CI；
- 生产只允许 HTTPS；
- Web 与 API 都由 Next.js 显式设置防嗅探、禁止嵌入、Referrer、权限和跨源窗口隔离响应头；Netlify 配置保留同类兜底；
- 管理端启用前必须有强认证与最小权限。
