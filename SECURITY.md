# 安全基线

- 密钥只在服务端和托管平台 Secret 中；
- 输入使用 Schema 校验；
- 外部 AI 只生成候选意图，必须再次通过同一 `SearchIntent` Schema；它不能调用 Connector、生成价格或绕过确定性规则；
- API 配置 CORS、限流、请求大小和超时；
- 消耗供应商额度的搜索路径同时使用 Netlify Edge 与 API 实例内按 IP 限流作为纵深防御；当前证据不足以把它们视作跨实例全域总量限制，因此供应商 `$0` 套餐、账户用量上限与剩余额度硬停止才是最终保护；
- SerpApi 每次搜索前读取账户级 `this_month_usage`，默认最多使用 200/250 个免费 credits；Staging 进一步限制为 100。缺少用量字段或下一次查询会越过上限时，在调用航班搜索前 fail-closed；
- 日志默认脱敏；
- 不保存供应商 Token、支付或证件信息；
- Runtime 使用池化数据库连接，Migration 使用直连；
- 依赖锁定并进入 CI；
- CI 在构建和测试前执行 `pnpm audit --prod --audit-level high`；2026-08-04 对候选依赖完成专项修复后，`pnpm audit --prod` 返回 `No known vulnerabilities found`；
- 生产只允许 HTTPS；
- Web 与 API 都由 Next.js 显式设置防嗅探、禁止嵌入、Referrer、权限和跨源窗口隔离响应头；Netlify 配置保留同类兜底；
- 管理端启用前必须有强认证与最小权限。
