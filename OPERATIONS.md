# 运维

V2 监控 Render API 健康、Connector 成功率与延迟、搜索成功率、Offer 新鲜度、提醒任务、落地页价格偏差及 Neon 连接。

## 运行边界

- Render 免费层使用单个 Fastify 副本；进程内限流和缓存只对该副本有效；
- 如果增加副本或公开扩大流量，必须先在 Neon 中实现全局原子配额；
- SerpApi 额度仍由账户状态、剩余额度和月度硬上限三重 fail-closed 门禁保护；
- Fastify 监听 Render 注入的 `PORT`，并在 `SIGTERM`/`SIGINT` 时关闭应用、pg-boss 和数据库连接；
- `/health` 用于部署健康检查；Railway 上线后的持续可用性需要单独监控；
- `OPENAI_INTENT_PARSER_ENABLED=false` 是 V1 默认值，只有明确批准并配置密钥后才允许外部模型调用。

## 价格提醒

- GitHub Actions 只负责带密钥调用 `/internal/monitor/wake`，不直接执行查询；
- 每次唤醒最多选取 5 个到期提醒，任务有 45 秒预算、2 次有限重试和 5 分钟 singleton 窗口；
- `alert_runs.idempotency_key` 提供数据库级幂等，重复唤醒不会重复执行同一时间桶；
- 只有人民币最低可核验全价达到目标才推送 ntfy，展示价和分开购买价不会触发；
- ntfy 失败记录 `NOTIFICATION_FAILED`，查询审计和价格历史会先持久化；
- 匿名 owner token 只在浏览器本地保存，服务端仅保存 SHA-256 摘要。

## 人工核价

人工落地页核价只通过受控终端执行 `@flight-lens/database` 的 `price:verify` CLI。它按标准化 Offer ID 更新最近一条待核价记录，输出预期价、观察价、状态、金额差和绝对偏差基点；不提供无认证公网管理接口。

## 降级原则

- 单来源失败不终止其他来源；
- 全部来源失败返回可重试错误，不返回空航班；
- AI 不可用时继续使用本地解析或完整表单；
- 数据库不可用时不得伪造审计成功；
- 额度未知或接近硬阈值时停止外部调用；
- Render API 不可用时 Web 显示明确错误，不回退演示数据；
- 生产回滚到上一个已验证 Git Tag，并按 API、Web 顺序复核。
