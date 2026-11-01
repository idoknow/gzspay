# 安全防护说明

gzspay 不接触资金（付款仍走支付宝 / 微信 / QQ 的收款码），因此安全目标集中在**账号与会话、支付密码、金额授权、数据最小化**四件事上。
本文记录现有的防护措施、可调策略与上线检查清单；新增接口时应逐条对照。

## 1. 传输与响应头

| 措施 | 说明 |
| --- | --- |
| HTTPS | 生产部署由反向代理终结 TLS；`APP_BASE_URL` / `PUBLIC_BASE_URL` 必须是 `https://`，否则服务拒绝启动 |
| HSTS | 生产环境下发 `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| CSP | 生产环境下发 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`。主题引导脚本已抽成 `/theme-boot.js`，页面里不再有内联 `<script>` |
| 其余响应头 | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: same-origin`、`Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Resource-Policy: same-origin`、`Permissions-Policy` 只放行同源摄像头（扫码） |
| 禁止缓存 | `/api/*` 一律 `Cache-Control: no-store`，避免个人信息、卡号脱敏值被中间缓存 |

开发环境（`NODE_ENV !== production`）不下发 HSTS / CSP，因为 Vite 的 HMR 需要内联脚本与 WebSocket。

## 2. 会话

- 会话令牌 32 字节随机数（base64url），数据库只存 `sha256(token + SESSION_SECRET)`；泄露数据库无法直接冒用会话。
- Cookie 固定 `HttpOnly`、`SameSite=Lax`、`Path=/`，生产环境加 `Secure`；有效期默认 7 天（`SESSION_TTL_DAYS`）。
- 会话在每次请求时校验过期并顺带刷新 `last_seen_at`（60 秒节流，减少写库）。
- 管理员没有独立会话：管理后台复用主站会话，再按 `admins` 表校验角色（`super` / `ops` / `auditor`）。
- 用户可在「我的 → 设置 → 登录设备管理」查看全部登录设备并逐个强制退出；管理员可在用户管理里强制下线。
- 生产环境若仍使用示例密钥或密钥短于 32 字符，服务启动失败（见 `server/src/lib/security.ts`）。

## 3. 写接口与 CSRF

- 所有写请求要求自定义头 `X-Requested-With: gzspay`（跨站表单无法携带）。
- 同时校验 `Origin` / `Referer` 是否在 `APP_BASE_URL`、`PUBLIC_BASE_URL`、`EXTRA_ALLOWED_ORIGINS` 白名单内。
- 同源 Cookie 为 `SameSite=Lax`，跨站表单提交不会携带会话。

## 4. 限流与暴力破解防护

| 场景 | 默认阈值（每分钟） | 环境变量 |
| --- | --- | --- |
| 发起校园墙登录 | 20 | `RATE_LIMIT_LOGIN_PER_MINUTE` |
| OAuth 回调 | 30 | `RATE_LIMIT_CALLBACK_PER_MINUTE` |
| 创建订单（按用户） | 30 | `RATE_LIMIT_ORDER_PER_MINUTE` |
| 转账（按用户） | 10 | `RATE_LIMIT_TRANSFER_PER_MINUTE` |
| 扫卡反查身份（按用户） | 30 | `RATE_LIMIT_SCAN_PER_MINUTE` |
| 发送邮箱验证码（按用户） | 5 | `RATE_LIMIT_EMAIL_PER_MINUTE` |
| 动态码 / 发起收款（按用户） | 20 | `RATE_LIMIT_DYNAMIC_PER_MINUTE` |

- 超限统一返回 `429 RATE_LIMITED` 并带 `Retry-After`；阈值设 0 可关闭对应限流。
- 支付密码另有独立防爆破：连续错误 5 次锁定 30 分钟（`PAYMENT_MAX_ATTEMPTS` / `PAYMENT_LOCK_MINUTES`），错误次数落库，重启不清零。
- 修改支付密码必须重新验证身份，可任选邮箱验证码或校园墙再授权：后者要求授权回来的校园墙账号与当前登录账号一致（不一致直接拒绝并写审计），验证记录 5 分钟一次性，重置令牌通过接口领取而不是放进跳转 URL。
- 邮箱验证码：60 秒重发间隔、最多校验 5 次、10 分钟过期，过期或次数用尽即失效。
- 动态码：60 秒过期、一次性消费。

> 限流计数保存在进程内存里。当前部署是单进程 + SQLite，如需多实例水平扩展，应改为共享存储（Redis 等）。

## 5. 金额与业务授权

- 所有金额以「分」为单位存储与校验，服务端拒绝非正整数。
- 单笔上限 `ORDER_MAX_AMOUNT_CENTS`（默认 5000 元）、当日累计上限 `DAILY_MAX_AMOUNT_CENTS`（默认 20000 元），超限写风控日志并拒绝。
- 动态码下单时校验「令牌归属的商家」与请求里的 `merchantUserId` 一致，防止把令牌挪给其他商家使用。
- 转账限制：不能转给自己、对方冻结时拒绝、必须输入自己的支付密码，并走同一套金额上限。
- 支付密码只出现在请求体里，不落库、不回显，比较使用 `crypto.timingSafeEqual`。

## 6. 输入与文件

- 所有请求体、查询参数用 Zod 校验，字符串有长度上限；SQL 一律参数化（`queryOne/queryAll/execute`）。
- 上传的收款码截图：先按文件头确认为 PNG / JPEG（`server/src/lib/image.ts`），再交给解码器；只保存解码出的文本，不保存原图。单文件上限 5MB、单请求最多 3 个文件。
- 用户头像直接引用 QQ 官方头像地址（`https://q1.qlogo.cn/g?b=qq&nk={qq}&s=100`，可用 `QQ_AVATAR_URL_TEMPLATE` 替换），服务端不再下载或保存头像文件；前端加载失败时退回姓名首字。QQ 号不写入日志、不在页面文本中展示（仅出现在头像 URL 里）。
- 静态文件用 `express.static` 且 `index: false`，避免目录列表。

## 7. 日志与错误

- 生产环境 500 响应只返回「服务器开小差了」，堆栈写入 `system_errors` 表。
- 参数校验失败、JSON 解析失败等 4xx 一律返回中文提示；生产环境不返回 `details`（字段路径、字段名、剩余次数等只在非生产环境返回），避免把请求参数结构暴露给客户端。
- 前端不展示原始异常：`errorMessage()` 把接口错误、网络失败、渲染异常统一转成中文提示，遇到英文校验文案、堆栈、URL 等内部信息时改用兜底文案；页面渲染错误由 `ErrorBoundary` 兜底显示「页面出了点问题」。
- QQ 号、学号、邮箱、卡号、支付密码、收款码内容、会话令牌不写日志；审计日志只记操作类型与目标。
- 登录失败写 `login_logs`（记录 IP / UA / 失败原因），不记录令牌与密码。

## 8. 严重错误告警

- 触发范围：接口 5xx、进程 `uncaughtException` / `unhandledRejection`、启动迁移失败、定时清理失败、邮件发送失败。
- 所有错误先写入 `system_errors`（后台「日志 → 系统错误」可查、可导出），再判断是否需要主动推送。
- 推送通道：
  - 邮件：发给 `admins` 表里状态正常且已绑定邮箱的管理员（需要配置 SMTP）；
  - Webhook：`ALERT_WEBHOOK_URL`，JSON POST，可对接企业微信 / 钉钉 / 飞书群机器人。
- 防刷屏：同一类错误按「来源 + 归一化文案」合并，`ALERT_THROTTLE_MINUTES`（默认 10 分钟）内只告警一次，期间重复次数累计到下一次；每小时最多 `ALERT_MAX_PER_HOUR`（默认 30）次。
- 告警邮件自身发送失败只写系统错误、不再触发告警，避免递归；Webhook 失败同样只记录。
- 告警内容包含来源、上下文（方法 + 路径）、错误文案、堆栈与管理后台地址，属于内部信息，只发给管理员与管理员配置的 Webhook，不返回给客户端。
- 告警通道是否就绪可在后台「系统状态 → 严重错误告警」查看；未配置任何通道时该页会给出提示。

## 9. 上线检查清单

1. `SESSION_SECRET` 用 `openssl rand -hex 32` 生成，至少 32 字符。
2. `APP_BASE_URL`、`PUBLIC_BASE_URL` 都是 `https://`；没有证书的内网部署才设置 `ALLOW_INSECURE_BASE_URL=1`。
3. 前面有 Nginx 等反向代理时 `TRUST_PROXY=1`；直接公网监听时设为 `false`。
4. `EMAIL_CODE_DEV_MODE` 必须为 `0` / 不设置（生产开启时启动日志会告警）。
5. 校园墙 OAuth 后台登记的 redirectUri 与 `CAMPUX_REDIRECT_URI` 完全一致。
6. 验证 `curl -I https://<域名>/api/health` 能看到 HSTS、CSP 与 `Cache-Control: no-store`。
7. 跑一遍 `npm run verify` 与 `node scripts/e2e-smoke.mjs`（冒烟脚本要求全新数据库）。
8. 配置告警通道并自测：设置 `ALERT_WEBHOOK_URL`，或配置 SMTP 并给管理员绑定邮箱；在后台「系统状态」确认告警显示为「已启用」。
