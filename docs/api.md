# gzspay 接口契约

本文档是前后端共同遵守的接口约定。后端实现见 `server/src/routes/`，前端客户端见 `web/src/lib/api.ts`。

## 通用约定

- 基础路径：`/api`。
- 认证：服务端会话 Cookie（`gzs_session`，HttpOnly）。未登录返回 `401`。
- 管理后台会话：`gzs_admin` Cookie，只对 `/api/admin/**` 生效。
- 请求/响应均为 JSON（文件上传除外，使用 `multipart/form-data`）。
- 金额字段一律为「分」的整数（`amountCents`）。
- 时间为 ISO 8601 字符串（UTC）。
- 分页参数：`page`（从 1 开始，默认 1）、`pageSize`（默认 20，最大 100）。
- 分页响应：`{ "items": [], "total": 0, "page": 1, "pageSize": 20 }`。
- 写操作（POST/PATCH/PUT/DELETE）必须带请求头 `X-Requested-With: gzspay`，并满足同源校验；否则 `403`。
- 错误响应统一：

```json
{ "error": { "code": "ORDER_STATUS_INVALID", "message": "订单当前状态不能执行该操作" } }
```

### 通用错误码

| code | HTTP | 说明 |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | 未登录或会话过期 |
| `FORBIDDEN` | 403 | 无权限 |
| `CSRF_REJECTED` | 403 | 缺少请求头或来源不合法 |
| `VALIDATION_FAILED` | 400 | 参数校验失败（含 `details`） |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 唯一性冲突（学号/卡号/邮箱） |
| `PAYMENT_PASSWORD_WRONG` | 400 | 支付密码错误（含剩余次数 `details.remaining`） |
| `PAYMENT_PASSWORD_LOCKED` | 423 | 支付密码锁定（含 `details.lockedUntil`） |
| `PAYMENT_PASSWORD_NOT_SET` | 400 | 尚未设置支付密码 |
| `LOCKED` | 423 | 账号冻结 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `ORDER_STATUS_INVALID` | 409 | 订单状态不允许该操作 |
| `LIMIT_EXCEEDED` | 400 | 超出金额上限 |

### 用户公开信息 `PublicUser`

```ts
interface PublicUser {
  id: string;
  displayName: string;      // 商家名称或用户姓名
  avatarUrl: string | null; // 已缓存到头像地址；null 表示用姓名首字
  studentNoMasked: string;  // 例 2023****01
  isMerchant: boolean;
}
```

### 当前用户 `Me`

```ts
interface Me {
  id: string;
  displayName: string;
  surname: string | null;
  givenName: string | null;
  fullName: string | null;
  studentNo: string | null;      // 本人可见完整学号
  emailMasked: string | null;
  email: string | null;
  cardNo: string | null;         // 本人可见完整卡号（默认前端脱敏展示，点击后显示）
  cardNoMasked: string | null;
  avatarUrl: string | null;
  onboarded: boolean;
  onboardStep: "name" | "studentNo" | "email" | "card" | "password" | "done";
  isMerchant: boolean;
  isAdmin: boolean;
  paymentPasswordSet: boolean;
  frozen: boolean;
  notificationSettings: { newOrder: boolean; paid: boolean; settled: boolean };
  createdAt: string;
}
```

## 1. 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/auth/session` | 当前登录态：`{ authenticated, me?, onboardStep?, isAdmin }` |
| `GET` | `/api/auth/login` | 302 跳转校园墙授权页（生成 state + PKCE） |
| `GET` | `/api/auth/callback?code&state` | 校园墙回调，成功后 302 到 `APP_BASE_URL/`（新用户到 `/onboarding`） |
| `POST` | `/api/auth/logout` | 退出登录，清 Cookie |
| `POST` | `/api/auth/dev-login` | 仅开发模式：`{ sub?, name?, username? }` 直接登录，返回 `{ me }` |

## 2. 新用户引导

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/onboarding` | — | `{ step, steps: ["name","studentNo","email","card","password"], nextStep, me }`（`steps` 为步骤 key 顺序表，前端据此显示「第 N / 5 步」） |
| `POST` | `/api/onboarding/name` | `{ surname, givenName }` | 填写真实姓名 |
| `POST` | `/api/onboarding/student-no` | `{ studentNo }` | 校学号，唯一 |
| `POST` | `/api/onboarding/email/start` | `{ email }` | 发送验证码，返回 `{ sent, devCode? }`（仅开发） |
| `POST` | `/api/onboarding/email/verify` | `{ email, code }` | 校验验证码并绑定邮箱 |
| `POST` | `/api/onboarding/card` | `{ cardContent }` | 校园卡二维码内容（`gzspay:card:<卡号>`），唯一 |
| `POST` | `/api/onboarding/payment-password` | `{ password, confirm }` | 设置 6 位支付密码，完成后 `onboarded=true` |

引导步骤只能顺序推进；已完成的步骤重复提交返回当前步骤，不报错。

## 3. 支付密码

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/me/payment-password/reset/start` | — | 向绑定邮箱发验证码 `{ sent, devCode? }` |
| `POST` | `/api/me/payment-password/reset/verify` | `{ code }` | 校验验证码，返回 `{ resetToken }`（10 分钟有效） |
| `POST` | `/api/me/payment-password/reset/confirm` | `{ resetToken, password, confirm }` | 设置新密码；成功后发送提醒邮件，动态码全部失效 |
| `POST` | `/api/me/payment-password/verify` | `{ password }` | 仅用于「修改敏感信息前」二次确认，返回 `{ ok: true }` |

> 支付密码校验统一走 `verifyPaymentPassword`：连续错 5 次锁定 30 分钟并邮件提醒，进行风控日志记录。

## 4. 我的

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/me` | 返回 `Me` |
| `PATCH` | `/api/me/profile` | `{ surname?, givenName?, studentNo?, paymentPassword }`，至少一项 |
| `POST` | `/api/me/email/start` | `{ email, paymentPassword }` 发送新邮箱验证码 |
| `POST` | `/api/me/email/verify` | `{ email, code, paymentPassword }` 完成换绑 |
| `POST` | `/api/me/card` | `{ cardContent, paymentPassword }` 换绑校园卡（新卡未被占用，旧卡解绑） |
| `PATCH` | `/api/me/settings` | `{ newOrder?, paid?, settled? }` 邮件开关 |
| `GET` | `/api/me/card-qr` | `{ content, cardNoMasked }` 我的校园卡二维码内容 |
| `GET` | `/api/about` | `{ version, changelog: [{version, date, items[], groups: [{title, items[]}]}], privacy, terms, privacyUpdatedAt, termsUpdatedAt, legalEffectiveAt }`（privacy/terms 为 Markdown 原文，日期为 YYYY-MM-DD） |

## 5. 商家

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/merchant` | `{ registered, merchant? }`：含名称、备注要求、三种收款方式状态 |
| `GET` | `/api/merchant/public/:userId` | 顾客扫码后查看：商家公开信息 + 在售商品 + 备注要求 |
| `POST` | `/api/merchant/register` | multipart：`name`、`channels`(JSON 数组) + 文件 `qr_alipay`/`qr_wechat`/`qr_qq`；每个文件解码校验渠道。`noteRequirement` 仍可选传入以兼容旧客户端，但注册页不填写，注册后用 `PATCH /api/merchant` 设置 |
| `PATCH` | `/api/merchant` | `{ name?, noteRequirement? }` |
| `POST` | `/api/merchant/channels/:channel` | multipart 文件 `qr`，重新上传某渠道收款码，需 `paymentPassword` 字段 |
| `PATCH` | `/api/merchant/channels/:channel` | `{ enabled }` 启用/停用；至少保留一个启用 |
| `GET` | `/api/merchant/channels/:channel/qr` | 返回重生成的二维码 PNG（`image/png`） |
| `GET` | `/api/merchant/products` | 商品列表（含下架） |
| `POST` | `/api/merchant/products` | `{ name, priceCents, description?, active?, imageUrl? }` |
| `PATCH` | `/api/merchant/products/:id` | 同上字段可选 |
| `DELETE` | `/api/merchant/products/:id` | 删除商品 |
| `PATCH` | `/api/merchant/products/sort` | `{ ids: string[] }` 按顺序重排 |

## 6. 订单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/orders` | 付款人下单：`{ merchantUserId, items?: [{productId, quantity}], amountCents?, reservedNote, paymentPassword, idempotencyKey, source?, dynamicCodeToken? }`；成功 `201 { order: Order }` |
| `POST` | `/api/orders/merchant-create` | 商家扫客户卡代下单：`{ cardContent, items?, amountCents?, reservedNote, paymentPassword, idempotencyKey }`（`paymentPassword` 是客户在商家手机上输入的密码）；成功 `201 { order: Order }` |
| `GET` | `/api/orders` | 列表：`scope=pay|receive`、`status=pending|paid|closed|all`、`page`、`pageSize` → `{ items: OrderSummary[], total, page, pageSize }` |
| `GET` | `/api/orders/:id` | 订单详情（付款人/商家/管理员可见，含时间线、对方公开信息、可用支付方式）→ `Order` |
| `GET` | `/api/orders/:id/qr?channel=alipay` | 商家收款码 PNG（仅订单双方；必须该渠道已启用） |
| `POST` | `/api/orders/:id/pay` | 付款人点「我已支付」：`{ channel, actualNote }`，待付款 → 已支付 → 返回 `Order` |
| `POST` | `/api/orders/:id/confirm` | 商家确认收款：已支付 → 已完成；待付款（当面付款）→ 已完成 → 返回 `Order` |
| `POST` | `/api/orders/:id/not-received` | 商家点「未收到」：已支付 → 待付款，通知付款人 → 返回 `Order` |
| `POST` | `/api/orders/:id/cancel` | 商家取消：`{ reason: "金额有误"|"已线下结清"|"对方未付款"|"其他", note? }`，待付款 → 已取消 → 返回 `Order` |
| `POST` | `/api/orders/:id/appeal` | 付款人申诉：`{ reason }`，写申诉记录 → 返回 `Order` |

说明：状态流转类接口（pay/confirm/not-received/cancel/appeal）直接返回扁平 `Order` 对象（不包 `order` 字段）；两个创建接口返回 `{ order: Order }`。

幂等：两个创建接口都要传 `idempotencyKey`。同一用户 + 同一 key + 同一接口重复请求时，后端直接返回首次创建的响应（`200`，与首次返回体相同），不会重复下单。

### 订单状态

`pending_payment`（待付款）→ `paid`（已支付）→ `completed`（已完成）；`pending_payment` → `cancelled`（已取消）。
`paid` 可被商家「未收到」退回 `pending_payment`。展示筛选：`pending`=待付款，`paid`=已支付，`closed`=已完成+已取消。

### Order 对象

```ts
interface Order {
  id: string;
  orderNo: string;
  amountCents: number;
  status: "pending_payment" | "paid" | "completed" | "cancelled";
  title: string;                 // 商品摘要或「自定义付款」
  items: { name: string; priceCents: number; quantity: number }[] | null;
  reservedNote: string | null;
  actualNote: string | null;
  payChannel: "alipay" | "wechat" | "qq" | null;
  cancelReason: string | null;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  role: "payer" | "merchant";    // 当前用户在这笔订单中的角色
  createdBy: "payer" | "merchant"; // 订单由谁发起（付款人扫商家 / 商家扫客户卡）
  counterparty: PublicUser;      // 对方公开信息
  merchantName: string;
  payerNameSnapshot: string;
  noteRequirement: string;
  availableChannels: ("alipay" | "wechat" | "qq")[]; // 该商家当前启用的收款方式
  events: { id: string; type: string; actorRole: string; detail: string | null; createdAt: string }[];
  hasAppeal: boolean;
}
```

### 订单列表项 OrderSummary

```ts
interface OrderSummary {
  id: string;
  orderNo: string;
  amountCents: number;
  status: "pending_payment" | "paid" | "completed" | "cancelled";
  title: string;
  role: "payer" | "merchant";
  counterparty: PublicUser;
  hasAppeal: boolean;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}
```

## 7. 收付款 / 扫码 / 动态码

### 7.1 扫码

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/me/card-qr` | 当前用户校园卡二维码：`{ content: "gzspay:card:<卡号>", cardNoMasked }`（纯静态身份标识，不能用于授权支付） |
| `POST` | `/api/scan/card` | 扫码后解析校园卡：`{ cardContent: "gzspay:card:<卡号>" }` → `{ user: PublicUser, isMerchant, isSelf, cardNoMasked }`；未绑定 `404`，账号冻结 `423` |

二维码内容前缀：校园卡 `gzspay:card:`，动态码 `gzspay:dynamic:`。

### 7.2 动态码

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/dynamic-code` | 签发一次性动态码：`{ token, expiresAt, refreshAfter, qrContent: "gzspay:dynamic:<token>", prefix: "gzspay:card:" }`（`refreshAfter` 30 秒建议刷新，60 秒过期） |
| `GET` | `/api/dynamic-code/:token/resolve` | 扫码方**只读**解析（不消费令牌）：`{ user: PublicUser, isMerchant, merchantName, channels }` |
| `POST` | `/api/dynamic-code/request` | 商家扫客户动态码后发起收款：`{ token, amountCents?, items?, reservedNote? }` → 消费令牌并创建待确认请求，向客户推送 `payment_request` 事件 |
| `GET` | `/api/dynamic-code/requests` | 客户查看待确认的收款请求：`{ items: PaymentRequest[] }` |
| `GET` | `/api/dynamic-code/requests/:id` | 收款请求详情 |
| `POST` | `/api/dynamic-code/requests/:id/accept` | 客户在自己手机上确认：`{ paymentPassword }` → 创建订单，返回 `{ request, order, orderId }` |
| `POST` | `/api/dynamic-code/requests/:id/reject` | 客户拒绝 → `{ request }` |
| `GET` | `/api/events/stream` | SSE：`payment_request`、`order_update` 事件推送（30 秒一次注释心跳） |

令牌消费时机：`resolve` 不消费；`POST /api/dynamic-code/request`（商家发起收款）或`POST /api/orders` 带 `dynamicCodeToken`（客户主动付款）时消费。

```ts
interface PaymentRequest {
  id: string;
  amountCents: number;
  title: string;
  items: { name: string; priceCents: number; quantity: number }[] | null;
  reservedNote: string | null;
  status: "pending" | "accepted" | "rejected" | "expired";
  merchant: PublicUser;
  merchantName: string;
  customerId: string;
  orderId: string | null;
  createdAt: string;
  expiresAt: string;
}
```

SSE 事件格式：`event: payment_request` / `event: order_update`，`data:` 为单行 JSON。
`payment_request` 的 data 是上面的 `PaymentRequest` 扁平对象；`order_update` 的 data 为 `{ orderId, status }`。

```ts
interface SSEOrderUpdate {
  orderId: string;
  status: "pending_payment" | "paid" | "completed" | "cancelled";
}
```

## 8. 交易统计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/stats/summary?from&to&includePending` | `{ expenseCents, incomeCents, netCents, orderCount }` |
| `GET` | `/api/stats/timeseries?from&to&granularity=day|month&includePending` | `{ buckets: [{ key, expenseCents, incomeCents }] }` |
| `GET` | `/api/stats/export?from&to&includePending` | CSV 文件（`text/csv; charset=utf-8`，带 BOM） |

## 9. 公告

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/announcements/active` | 生效期内公告（置顶优先）：`{ items: [{ id, title, content, startsAt, endsAt, pinned }] }` |

## 10. 管理后台

统一前缀 `/api/admin`。要求管理员角色 + 二次验证完成；写操作要求角色权限（`super` 全权、`ops` 运营、`auditor` 只读）。

管理后台前端的响应类型定义集中在 `web/src/admin/types.ts`，下文用其中的类型名说明。所有列表接口返回统一分页结构 `{ items, total, page, pageSize }`；操作类接口成功返回 `{ ok: true, ... }`。

### 10.1 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/auth/login` | 整页跳转发起校园墙 OAuth（`302`）；回调成功后若需二次验证会跳回 `/admin` |
| `GET` | `/api/admin/auth/callback` | OAuth 回调（管理端专用，`gzs_admin` Cookie）；不在管理员名单或账号冻结时返回 `403` HTML 错误页 |
| `GET` | `/api/admin/auth/session` | 已登录：`{ authenticated: true, pending2fa: false, admin: AdminIdentity, emailMasked }`；未登录 `401 UNAUTHENTICATED`；已过 OAuth 未过二次验证 `401 ADMIN_2FA_REQUIRED`（`details.emailMasked`） |
| `POST` | `/api/admin/auth/verify` | `{ code }` 校验邮箱验证码 → 升级为管理会话，返回 `{ ok: true, admin }` |
| `POST` | `/api/admin/auth/resend` | 重新发送二次验证邮箱验证码 |
| `POST` | `/api/admin/auth/logout` | 退出管理会话 → `{ ok: true }` |

`AdminIdentity`：`{ id, displayName, emailMasked, role: "super"|"ops"|"auditor", createdAt }`。

### 10.2 业务接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/overview` | `Overview`：总交易额、本月交易额、今日订单数、用户数、商家数、近 12 月 `trend`、`recentOrders`、`todos` |
| `GET` | `/api/admin/monthly?year&month` | `MonthlyData`：年视图返回 `{ year, months: MonthlyBucket[] }`（每月含 `days`）；指定 `month` 时返回该月每日桶 |
| `GET` | `/api/admin/users?query&page&pageSize` | 用户列表：`{ items: AdminUser[], total, page, pageSize }`，按姓名/学号/邮箱搜索 |
| `GET` | `/api/admin/users/growth?months=12` | `{ buckets: [{ key, label, count }] }` |
| `GET` | `/api/admin/users/:id` | `{ user: AdminUserDetail, orderCount, totalAmountCents, recentOrders }` |
| `POST` | `/api/admin/users/:id/freeze` / `unfreeze` | 冻结/解冻（super/ops） |
| `POST` | `/api/admin/users/:id/reset-card` | 重置绑卡（super/ops） |
| `POST` | `/api/admin/users/:id/force-logout` | 强制下线（super/ops） |
| `GET` | `/api/admin/admins` | `{ items: AdminMember[] }` |
| `POST` | `/api/admin/admins` | `{ userId, role }` 添加（仅 super） |
| `DELETE` | `/api/admin/admins/:userId` | 移除（仅 super；不能移除自己，至少保留一名 super） |
| `GET` | `/api/admin/orders?from&to&status&merchantId&payerId&minAmount&maxAmount&query&page&pageSize` | `{ items: AdminOrder[], ... }`；金额筛选单位元 |
| `GET` | `/api/admin/orders/:id` | `AdminOrderDetail`：`AdminOrder` + `events` + `appeal?` |
| `GET` | `/api/admin/orders/export?<同筛选>` | CSV（`text/csv; charset=utf-8`，带 UTF-8 BOM，`Content-Disposition: attachment`） |
| `POST` | `/api/admin/orders/:id/close` | `{ note }` 关闭订单（super/ops；已结束订单返回 `409 ORDER_STATUS_INVALID`） |
| `POST` | `/api/admin/orders/:id/flag` | `{ note }` 标记异常（super/ops） |
| `GET` | `/api/admin/appeals?status&page&pageSize` | 申诉列表；`status=pending|resolved|rejected`（DB 内部 `open/closed/flagged` 映射） |
| `POST` | `/api/admin/appeals/:id/handle` | `{ status: "resolved"|"rejected", note }`（super/ops） |
| `GET` | `/api/admin/stats` | `AdminStats`：趋势、商家排行、支付方式占比、转化漏斗、平均确认时长（分钟） |
| `GET` | `/api/admin/system/status` | `SystemStatus`：服务、邮件成功率、校园墙连通性、存储、队列、`alerts` |
| `GET` | `/api/admin/announcements` | `{ items: Announcement[] }` |
| `POST` | `/api/admin/announcements` | `{ title, content, startsAt?, endsAt?, pinned? }`（super/ops） |
| `PATCH` | `/api/admin/announcements/:id` | 同上 |
| `DELETE` | `/api/admin/announcements/:id` | 删除（super/ops） |
| `GET` | `/api/admin/logs?type=audit|login|risk|error&from&to&query&page&pageSize` | `{ items: AdminLog[], ... }` |
| `GET` | `/api/admin/logs/export?type&from&to&query` | 日志 CSV |
| `GET` | `/api/admin/config` | `AdminConfig`：`{ mail: MailConfig, security: SecurityConfig }`；`mail.passwordConfigured` 表示是否已配置密码，不返回明文 |
| `PUT` | `/api/admin/config` | 更新配置（仅 super）；返回更新后的 `AdminConfig`；邮件配置变更立即生效 |

角色权限：`GET` 类接口所有管理员可读；冻结/解冻/重置绑卡/强制下线/关单/标异常/公告增删改/申诉处理 = `super` + `ops`；管理员增删与系统配置写入 = 仅 `super`；`auditor` 只读（写操作 `403`）。


## 11. 其他

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | `{ status: "ok"|"degraded", version, time, uptimeSeconds, database: "up"|"down" }` |
| `GET` | `/api/about` | `{ version, changelog: [{ version, date, items[], groups: [{ title, items[] }] }], privacy, terms, privacyUpdatedAt, termsUpdatedAt, legalEffectiveAt }`（privacy/terms 为 Markdown 原文） |
