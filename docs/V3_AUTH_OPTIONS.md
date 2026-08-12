# V3 账号与个人数据

## 目标

V3 为每位用户提供账号、密码和会话，让以下数据可以按用户保存、查询和删除：

- 航线偏好、航司/机场偏好、舱位和行李条件；
- 历史查询、价格历史和价格提醒；
- 通知设置与设备会话。

当前 V2 使用浏览器 `localStorage` 中的匿名 `ownerToken`。V3 登录上线后，不能把这个 token 当成身份凭证；需要提供一次性的匿名数据迁移流程，并允许用户跳过迁移或删除匿名数据。

## 推荐顺序

### 首选：Better Auth

[better-auth/better-auth](https://github.com/better-auth/better-auth) 与当前 TypeScript、Next.js、Neon/Postgres 技术栈最接近，适合直接复用账号、密码、会话、邮箱验证、密码重置和数据库适配器能力。API 仍需在 Fastify 侧验证会话并把用户 ID 传给查询、历史和提醒服务。

### 备选：Auth.js

[nextauthjs/next-auth](https://github.com/nextauthjs/next-auth) 适合把登录入口放在 Next.js。它可以使用数据库会话或 JWT，但当前 Fastify API 需要额外实现跨服务会话验证；邮箱/密码登录也需要自己补齐凭证校验、密码哈希和重置流程。因此除非 V3 把认证边界收回 Web，否则不作为首选。

### 独立身份服务：Logto 或 Ory Kratos

[logto-io/logto](https://github.com/logto-io/logto) 提供 OIDC/OAuth 2.1、多租户和 RBAC；[ory/kratos](https://github.com/ory/kratos) 是 API-first 的身份与凭证服务。两者都能覆盖更大的产品，但要额外维护身份服务、回调域名、密钥轮换和部署资源，个人学习项目暂不优先。

## V3 实施边界

1. 先建立 `users`、`sessions`、`password_resets`、`email_verifications` 和 `user_preferences` 表，密码只保存 Argon2id/bcrypt 哈希，绝不保存明文。
2. Web 负责登录/注册/退出界面；Fastify 负责会话校验、用户数据授权和所有写操作。
3. 所有 `/v2/preferences`、`/v2/alerts`、历史清理和个人查询接口改为用户会话授权；路线价格观测仍可保持公共、去身份化。
4. 为现有匿名 `ownerToken` 提供登录后一次性迁移，并记录迁移结果；迁移接口必须幂等。
5. 加入邮箱验证、忘记密码、登录失败限流、会话撤销、CSRF/CORS、审计日志和删除账号流程。
6. V3 再评估更多稳定授权来源；V2 的来源数量和浏览器会话策略不在本次账号改造中扩张。

## 验收门槛

- 新用户可以注册、验证邮箱、登录、退出和重置密码；
- 两个用户看不到彼此的偏好、提醒、历史查询和通知设置；
- 过期或撤销会话无法访问个人接口；
- 匿名数据迁移成功、重复提交不重复创建；
- 不提交任何真实密钥、密码或生产会话。
