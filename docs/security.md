# 安全防护说明

gzspay 不接触资金（付款仍走支付宝 / 微信 / QQ 的收款码），因此安全目标集中在**账号与会话、支付密码、金额授权、数据最小化**四件事上。
本文记录现有的防护措施、可调策略与上线检查清单；新增接口时应逐条对照。

## 1. 传输与响应头

| 措施 | 说明 |
| --- | --- |
| HTTPS | 生产部署由反向代理终结 TLS；`APP_BASE_URL` / `PUBLIC_BASE_URL` 必须是 `https://`，否则服务拒绝启动 |
| HSTS | 生产环境下发 `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| CSP | 生产环境下发 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`。主题引导脚本已抽成 `/theme-boot.js`，页面里不再有内联 `<script>` |
| 其余响应头 | `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: same-origin`、`Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Resource-Policy: same-origin`、`X-DNS-Prefetch-Control: off`、`Origin-Agent-Cluster: ?1`、`X-Download-Options: noopen`、`Permissions-Policy` 只放行同源摄像头（扫码） |
| 后台防收录 | `/admin` 与 `/admin/*` 额外下发 `X-Robots-Tag: noindex, nofollow` 与 `Cache-Control: no-store`，避免搜索引擎收录后台、也避免中间缓存后台页面 |
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
- 浏览器带 `Sec-Fetch-Site: cross-site` 的写请求直接拒绝（`403 CSRF_REJECTED`），作为上述校验之外的第二道判断。

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
- 用户头像不直接引用 QQ 官方地址：所有接口只下发本站代理地址 `/api/avatar/<用户 id>`，由服务端按资料里的 QQ 号去 `https://*.qlogo.cn` 拉取（只允许 https + qlogo 域名、不跟随跳转、单张 ≤2MB、按文件头确认 PNG/JPEG、内存缓存 6 小时、每人 120 次/分）后转发，页面源码、网络请求与截图里都不会出现 QQ 号；前端加载失败时退回姓名首字。
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
  - 邮件：发给 `admins` 表里状态正常且已绑定邮箱的管理员（需要配置发件通道：Resend 或 SMTP）；
  - Webhook：`ALERT_WEBHOOK_URL`，JSON POST，可对接企业微信 / 钉钉 / 飞书群机器人。
- 防刷屏：同一类错误按「来源 + 归一化文案」合并，`ALERT_THROTTLE_MINUTES`（默认 10 分钟）内只告警一次，期间重复次数累计到下一次；每小时最多 `ALERT_MAX_PER_HOUR`（默认 30）次。
- 告警邮件自身发送失败只写系统错误、不再触发告警，避免递归；Webhook 失败同样只记录。
- 告警内容包含来源、上下文（方法 + 路径）、错误文案、堆栈与管理后台地址，属于内部信息，只发给管理员与管理员配置的 Webhook，不返回给客户端。
- 告警通道是否就绪可在后台「系统状态 → 严重错误告警」查看；未配置任何通道时该页会给出提示。

## 9. 地区访问限制

- 默认关闭。管理后台「系统配置 → 地区访问限制」保存到 `app_config` 后立即生效（不用重启）；未在后台保存过时使用 `GEO_BLOCK_NON_CHINA` 等环境变量作为默认值。
- 开启后只放行中国大陆 IP，境外请求一律返回 `403 REGION_BLOCKED`（接口返回 JSON，页面请求返回一段中文提示页）。
- 归属判断依据 `server/assets/cn-ip-ranges.json`（由 `node scripts/geo/build-cn-ranges.mjs` 从 APNIC 的 CN 分配段生成，IPv4 区间 + IPv6 CIDR，零第三方依赖）。这份数据能覆盖境内运营商与校园网，但无法识别具体国家，也无法防 VPN / 机场 / 代理。
- 例外与放行：
  - 本机与内网地址（`127.0.0.0/8`、`10/8`、`172.16/12`、`192.168/16`、`::1`、`fc00::/7` 等）始终放行；
  - 例外路径（默认 `/api/health`、`/theme-boot.js`、`/sw.js`、`/manifest.webmanifest`、`/favicon.ico`）始终放行，健康检查不会被误拦；
  - 白名单可放行固定出口 / 海外管理员 IP 或 CIDR（支持单个 IP 与 CIDR，逗号分隔）。
- 归属未知（数据缺失、地址无法解析）时按「未知归属处理」策略：`deny`（默认）拦截、`allow` 放行。
- 前面有 CDN 时可在后台填 CDN 的国家码请求头（如 `CF-IPCountry`）。只有确认回源请求一定来自 CDN 时才启用，否则客户端可伪造该头绕过限制。
- 生效依赖真实客户端 IP：放在反向代理后面时要设置 `TRUST_PROXY=1`，否则所有请求都会被当成代理 IP（内网地址，直接放行）。
- 被拦截的请求只打印节流日志（同一 IP 10 分钟一次），不写数据库，避免被刷库；后台「系统状态」不展示拦截计数。
- 注意副作用：校园墙登录回调与站点同域，海外用户将无法登录；教育网个别海外出口可能被误判，必要时加入白名单。

## 10. 管理后台安全入口

- 默认关闭：不配置时后台仍为 `/admin`。在「系统配置 → 管理后台安全入口」填写 4–32 位字母、数字、下划线或短横线（不能与 `api`、`assets`、`login` 等已有路径冲突）后，入口变为 `/<入口名>/admin`。
- 访问 `/<入口名>/admin` 会下发 `gzs_admin_entry` Cookie（HMAC 签名、`HttpOnly`、`SameSite=Lax`、生产环境 `Secure`、有效期 8 小时）并 302 跳到 `/admin`；之后 8 小时内直接访问 `/admin` 不再校验入口。
- 未携带有效凭据直接访问 `/admin` 或 `/admin/*`：写入一条访问记录（IP、方法、路径、查询串、UA、Referer、时间）并返回普通 404「页面不存在」，不暴露后台存在。
- 记录保留最近约 3000 条，可在后台「系统状态 → 后台入口访问尝试」查看；接口为 `GET /api/admin/security/entry-visits`（仅管理员）。
- 该入口只隐藏登录页地址，不替代账号权限校验：真正的权限仍由 `admins` 表 + 主站会话 + 角色控制。

## 11. 扫描器拦截与访问统计

- **扫描器拦截**：`server/src/lib/http.ts` 的 `scannerGuard` 在地区限制之前拦截常见探测路径（`/.env`、`/.git`、`/.svn`、`/wp-admin`、`/wp-login.php`、`/phpmyadmin`、`/actuator`、`/cgi-bin`、`/nacos`、`/druid/` 等）以及 `.php/.asp/.aspx/.jsp/.cgi` 扩展名，直接返回 404（接口返回 JSON、页面返回纯文本），不进入业务路由、也不触发初始化检查；命中次数计入访问统计的「扫描器路径拦截」。
- **访问统计**（仅管理后台可见）：按天聚合记录请求路由、HTTP 状态码、访问设备/浏览器/操作系统、访问地区（中国大陆/境外/本机内网，不保存具体 IP）、扫码次数（校园卡被扫、平台动态码被扫、动态码发起收款）与安全防护拦截次数（限流、CSRF、地区拦截、后台入口探测、扫描器路径、未登录、越权、支付密码错误/锁定）。
- **隐私边界**：`traffic_counters` 表只保存 `(day, kind, name, count)` 聚合计数，**不保存 IP、User-Agent、请求参数或任何可识别个人的信息**；数据保留 400 天，由定时清理任务删除过期记录。
- 统计只通过 `GET /api/admin/traffic` 提供，仅管理员可读；前台页面、公开接口均无任何统计入口。

## 12. 支付宝「一键付款」的安全边界

- 唤起链接（`alipays://platformapi/startapp…`）由服务端用商家后台配置的收款 PID 拼接，前端拿不到 PID，只能拿到自己订单的整段链接（`GET /api/orders/:id/alipay-prefill`）：必须登录、必须是**该订单的付款人**、订单必须是待付款、商家必须已启用支付宝且填过 PID；每分钟 20 次，响应 `Cache-Control: private, no-store`。
- 收款 PID 只能由 `super` / `ops` 在后台填写或清空（`POST /api/admin/merchants/:userId/channels/:channel/pay-uid`），格式限定 `2088` 开头的 13～21 位数字，审计 detail 里 PID 打码；商家自己看不到也改不了，`auditor` 调用返回 403。
- 备注由服务端生成（固定订单号，去控制字符并按码点截断 32 字），不接受前端传入，避免把任意内容拼进 scheme 参数。
- **深度链接不是到账凭据**：唤起成功只代表打开了付款页，接口不返回任何支付结果；订单完成仍依赖商家核对到账或账单自动对账（备注＝订单号时命中），因此不构成「用链接伪造已付款」的路径。

## 13. 上线检查清单

1. `SESSION_SECRET` 用 `openssl rand -hex 32` 生成，至少 32 字符。
2. `APP_BASE_URL`、`PUBLIC_BASE_URL` 都是 `https://`；没有证书的内网部署才设置 `ALLOW_INSECURE_BASE_URL=1`。
3. 前面有 Nginx 等反向代理时 `TRUST_PROXY=1`；直接公网监听时设为 `false`。
4. `EMAIL_CODE_DEV_MODE` 必须为 `0` / 不设置（生产开启时启动日志会告警）。
5. 校园墙 OAuth 后台登记的 redirectUri 与 `CAMPUX_REDIRECT_URI` 完全一致。
6. 验证 `curl -I https://<域名>/api/health` 能看到 HSTS、CSP 与 `Cache-Control: no-store`。
7. 跑一遍 `npm run verify` 与 `node scripts/e2e-smoke.mjs`（冒烟脚本要求全新数据库）。
8. 配置告警通道并自测：设置 `ALERT_WEBHOOK_URL`，或配置发件通道（Resend / SMTP）并给管理员绑定邮箱；在后台「系统状态」确认告警显示为「已启用」。
9. 需要只对中国大陆开放时：在后台开启地区访问限制（或设置 `GEO_BLOCK_NON_CHINA=1`），确认 `/api/health` 仍 200、境外 IP 返回 `403 REGION_BLOCKED`，并把运维出口加入白名单。
10. 建议在后台设置管理后台安全入口，确认 `/<入口名>/admin` 可进入、直接访问 `/admin` 返回 404 且能在「后台入口访问尝试」看到记录。
11. 确认扫描器路径（如 `curl -i https://<域名>/.env`）返回 404，后台「访问统计」能看到请求量、状态码、设备与地区数据；统计接口仅管理员可访问。

## 本地渗透测试（2026-11）

在本地以生产模式启动服务（`NODE_ENV=production`、独立数据库与种子数据），先做静态代码审计，再用脚本对 72 项检查做动态渗透，覆盖：安全响应头、未登录访问、会话伪造与失效、CSRF、越权读取与导出、冻结账号、管理员角色边界、SQL 注入、金额校验、上传（伪装图片 / 超大文件 / 路径穿越文件名）、静态资源路径穿越、幂等、导出公式注入、支付密码锁定与各类接口限流。最终 72/72 通过。

渗透与审计发现并修复的问题：

1. **初始化窗口抢注**：`POST /api/setup/config` 之前不需要任何凭据，配合「首个登录者成为超级管理员」可被远程接管。现在保存初始化配置必须带启动日志打印的一次性初始化令牌（`POST /api/setup/token` 校验），`ensureFirstAdmin` 也要求令牌已校验。
2. **客户端 IP 可伪造**：`TRUST_PROXY` 生产默认值改为 `false`，`requestIp()` 改用 `req.ip`。反向代理部署必须显式设置 `TRUST_PROXY=1`，直连部署保持 `false`。
3. **登录 CSRF**：OAuth `state` 同时写入 HttpOnly Cookie，回调比对后才消费；`csrfGuard` 不再放行缺失 `Origin` / `Referer` 或 `Origin: null` 的写请求。
4. **限流盲区**：付款截图上传、收款码上传、账单上传、商家代下单、动态码解析与接受、邮箱验证码、支付密码校验与重置、退出登录都补上限流；商家代输支付密码失败不再计入客户账号的锁定次数。
5. **解析型 DoS**：账单 XLSX 解析限制压缩包条目数、单条与总解压体积、压缩比与条目白名单；CSV 限制总行数与单行长度；图片解码限制总像素与单边长度。
6. **重放**：账单流水按 `(merchant_id, provider, trade_no)` 唯一，同一笔收款不能重复确认到多个订单。
7. **注入与 XSS**：审计 / 订单导出 CSV 统一做公式转义；公告 Markdown 链接白名单（仅 http(s)、mailto、站内）。
8. **信息泄露**：非参与方读取订单统一 404；只读审计员不返回学号 / 邮箱 / 卡号明文，也不能导出全站订单与日志；后台入口探测记录改为 IP 哈希 + 路径，不落 query / UA / Referer，并对 `/admin*` 探测限流。
9. **内存放大**：限流表按最后命中时间整桶清理，超过桶数上限时拒绝新 key。

回归：`server/tests/security-hardening.test.ts` 覆盖越权 404、超大上传 413、审计员导出被拒、初始化令牌、后台搜索通配符字面匹配；`npm test` 共 134 个用例通过。
