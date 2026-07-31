# 运维

V1 监控 API 健康、Connector 成功率与延迟、搜索成功率、Offer 新鲜度、价格偏差及数据库连接。

V1 后端运行在 Netlify Function。Serverless 实例内的限流和缓存只提供局部保护，不能视为跨实例的全局配额控制；供应商免费额度必须由 Connector 的 fail-closed 配额门禁与低调用量 Staging 验收共同保护。若未来公开流量需要全局原子配额，必须先在 Neon 中实现事务门禁再开放。

Netlify Free 会向 Function 自动注入 AI Gateway 的 OpenAI 环境变量，并按调用消耗 Netlify credits。应用默认 `OPENAI_INTENT_PARSER_ENABLED=false`，即使平台注入密钥也只使用本地确定性解析；只有用户明确批准并同时配置开关与密钥后才允许外部模型调用。

人工落地页核价只通过受控终端执行 `@flight-lens/database` 的 `price:verify` CLI。它按标准化 Offer ID 更新最近一条待核价记录，输出预期价、观察价、状态、金额差和绝对偏差基点；不提供无认证公网管理接口。

降级原则：

- 单来源失败不终止其他来源；
- 全部来源失败返回可重试错误，不返回空航班；
- AI 不可用时切换表单；
- 数据库不可用时不得伪造审计成功；
- 免费额度未知或已接近硬阈值时停止外部调用；
- 生产回滚到上一个已验证 Git Tag。
