# gzspay 接口契约

本文档是前后端共同遵守的接口约定。后端实现见 `server/src/routes/`，前端客户端见 `web/src/lib/api.ts`。

## 通用约定

- 基础路径：`/api`。
- 认证：服务端会话 Cookie（`gzs_session`，HttpOnly）。未登录返回 `401`。
- 管理后台复用同一个 `gzs_session` 会话（没有独立的 `gzs_admin` Cookie，也没有邮箱二次验证）。
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
| `REGION_BLOCKED` | 403 | 站点只对中国大陆开放时，境外 IP 的请求会被拦截（不计入业务错误，不影响浏览器缓存之外的任何状态） |
| `VALIDATION_FAILED` | 400 | 参数校验失败（`message` 为可直接展示的中文提示；开发/测试环境额外返回 `details.issues`，生产环境不返回字段路径） |
| `BAD_REQUEST` | 400 | 请求体不是合法 JSON、请求体过大等，`message` 为中文提示 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 唯一性冲突（学号/卡号/邮箱） |
| `PAYMENT_PASSWORD_WRONG` | 400 | 支付密码错误（含剩余次数 `details.remaining`） |
| `PAYMENT_PASSWORD_LOCKED` | 423 | 支付密码锁定（含 `details.lockedUntil`） |
| `PAYMENT_PASSWORD_NOT_SET` | 400 | 尚未设置支付密码 |
| `LOCKED` | 423 | 账号冻结 |
| `RATE_LIMITED` | 429 | 请求过于频繁（响应头带 `Retry-After`，单位为秒；登录、OAuth 回调、下单、转账、扫卡、邮箱验证码、动态码均有限流） |
| `ORDER_STATUS_INVALID` | 409 | 订单状态不允许该操作 |
| `LIMIT_EXCEEDED` | 400 | 超出金额上限 |
| `NOT_ADMIN` | 401 | 已登录但账号不在管理员名单内 |
| `SYSTEM_NOT_INITIALIZED` | 503 | 系统尚未初始化（请管理员打开 `/admin` 完成初始化向导） |
| `CAMPUX_NOT_CONFIGURED` | 503 | 尚未配置校园墙登录（初始化向导第一步） |
| `ALREADY_INITIALIZED` | 409 | 系统已完成初始化，不能重复提交初始化配置 |

### 用户公开信息 `PublicUser`

```ts
interface PublicUser {
  id: string;
  displayName: string;      // 商家名称或用户姓名
  avatarUrl: string | null; // QQ 头像地址（有 QQ 号时）；null 表示用姓名首字
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
| `GET` | `/api/auth/session` | 当前登录态：`{ authenticated, me?, onboardStep?, isAdmin, campuxConfigured, site: { name, schoolName, icp } }`；`campuxConfigured` 表示是否已配置校园墙 OAuth；`site.icp` 为站点备案号（空字符串表示未填写，未登录也会返回，登录页与全站页脚据此展示） |
| `GET` | `/api/auth/login` | 302 跳转校园墙授权页（生成 state + PKCE） |
| `GET` | `/api/auth/callback?code&state` | 校园墙回调，成功后 302 到 `APP_BASE_URL/`（新用户到 `/onboarding`，`redirect=/admin` 时到 `/admin`）；系统未初始化时第一个登录的账号自动成为超级管理员。state 带 `purpose=password_verify` 时不切换登录态，只核对授权账号与当前登录账号一致后写入一次性验证记录，再跳回 `/me/password?campux=1` |
| `POST` | `/api/auth/logout` | 退出登录，清 Cookie |

未配置校园墙（`CAMPUX_BASE_URL` / `CAMPUX_CLIENT_ID` / `CAMPUX_CLIENT_SECRET` 缺一）时，`GET /api/auth/login` 返回 503 `CAMPUX_NOT_CONFIGURED`。

## 1.1 系统初始化

首次部署时系统处于「未初始化」状态：除 `/api/health`、`/api/setup/*`、`/api/auth/*`、`/api/admin/auth/*` 外的接口统一返回 503（`CAMPUX_NOT_CONFIGURED` 或 `SYSTEM_NOT_INITIALIZED`）。管理后台打开后进入四步初始化向导（校园墙 → 发件 → 站点信息 → 完成），完成后第一个登录的账号成为超级管理员。

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/setup/status` | — | `{ initialized, campuxConfigured, mailConfigured, adminCount, currentUser, system, campux, mail }`（无需登录；`currentUser` 为当前登录用户或 `null`，`system` 含 `siteName/schoolName/publicBaseUrl/icp`，`mail` 不回显密码只给 `passwordConfigured`） |
| `POST` | `/api/setup/config` | `{ campux?, mail?, system? }` | 保存初始化配置，返回 `{ ok, status }`；仅 `initialized=false` 时可用，否则 409 `ALREADY_INITIALIZED`；`clientSecret` / `password` 留空表示沿用已保存值 |
| `POST` | `/api/setup/finish` | — | 需主站登录；把当前账号设为超级管理员并标记初始化完成，返回 `{ ok, admin }`；未登录 401 `UNAUTHENTICATED` |

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
| `GET` | `/api/me/payment-password/reset/campux/start` | — | 校园墙再验证：302 跳转到校园墙授权页（未配置时返回 `503 CAMPUX_NOT_CONFIGURED`）。回调会核对授权账号与当前登录账号一致，写入一次性验证记录后跳回 `/me/password?campux=1` |
| `POST` | `/api/me/payment-password/reset/campux/claim` | — | 领取校园墙验证通过后的凭证，返回 `{ resetToken, expiresAt }`（5 分钟内一次性） |
| `POST` | `/api/me/payment-password/reset/confirm` | `{ resetToken, password, confirm }` | 设置新密码；成功后发送提醒邮件，动态码全部失效 |
| `POST` | `/api/me/payment-password/verify` | `{ password }` | 仅用于「修改敏感信息前」二次确认，返回 `{ ok: true }` |

> 修改支付密码可任选邮箱验证码或校园墙再验证；两者最终都签发同样的 `resetToken`，再由 `reset/confirm` 设置新密码。

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
| `GET` | `/api/me/devices` | `{ items: LoginDevice[], onlineWindowMinutes }` 登录设备列表；`LoginDevice = { id, current, deviceName, deviceType: "mobile"\|"tablet"\|"desktop"\|"other", os, browser, ip, createdAt, lastSeenAt, expiresAt, online }`，`current` 为当前请求所属会话，`online` 指会话未过期且最近 `onlineWindowMinutes`（5）分钟内有请求 |
| `POST` | `/api/me/devices/:id/logout` | 退出指定设备，`{ ok: true, current }`；退出的是当前设备时会同时清掉会话 Cookie |
| `POST` | `/api/me/devices/logout-others` | 退出除当前设备外的所有设备，`{ ok: true, revoked }` |
| `GET` | `/api/about` | `{ version, changelog: [{version, date, items[], groups: [{title, items[]}]}], site: { name, schoolName, icp }, privacy, terms, privacyUpdatedAt, termsUpdatedAt, legalEffectiveAt }`（privacy/terms 为 Markdown 原文，日期为 YYYY-MM-DD；`site.icp` 为空字符串表示未填写备案号） |

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
| `POST` | `/api/merchant/products` | `{ name, priceCents, description?, active? }`（商品不含图片） |
| `PATCH` | `/api/merchant/products/:id` | 同上字段可选 |
| `DELETE` | `/api/merchant/products/:id` | 删除商品 |
| `PATCH` | `/api/merchant/products/sort` | `{ ids: string[] }` 按顺序重排 |

## 6. 订单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/orders` | 付款人下单：`{ merchantUserId, items?: [{productId, quantity}], amountCents?, reservedNote, paymentPassword, idempotencyKey, source?, dynamicCodeToken? }`；成功 `201 { order: Order }` |
| `POST` | `/api/orders/merchant-create` | 商家扫客户卡代下单：`{ cardContent, items?, amountCents?, reservedNote, paymentPassword, idempotencyKey }`（`paymentPassword` 是客户在商家手机上输入的密码）；成功 `201 { order: Order }` |
| `POST` | `/api/orders/transfer` | 转账给指定学号的用户：`{ studentNo, amountCents, note?, paymentPassword, idempotencyKey }`；创建一笔待付款订单（`title` 为「转账」，收款人记在商家侧），成功后自动出现在转账人的待付款与对方的待收款列表；学号不存在 404、给自己转账 409；金额受「转账」专用限额约束（单笔默认 200 元、当日累计默认 1000 元，`LIMIT_EXCEEDED`），成功 `201 { order: Order }` |
| `GET` | `/api/orders/transfer/lookup?studentNo=20230002` | 转账前按学号查询收款人 → `{ user: PublicUser }`（姓名、头像、脱敏学号，不含邮箱）；学号不存在 404、自己 409、对方冻结 423；每分钟限 20 次 |
| `GET` | `/api/orders` | 列表：`scope=pay|receive`、`status=pending|paid|closed|settled|all`（`settled`＝已支付/已完成/已取消）、`q`（关键词，模糊匹配订单号、标题、备注与对方姓名快照，最长 50 字，`%`/`_` 会被转义）、`page`、`pageSize` → `{ items: OrderSummary[], total, page, pageSize }` |
| `GET` | `/api/orders/:id` | 订单详情（付款人/商家/管理员可见，含时间线、对方公开信息、可用支付方式）→ `Order` |
| `GET` | `/api/orders/:id/qr?channel=alipay` | 商家收款码 PNG（仅订单双方；必须该渠道已启用） |
| `POST` | `/api/orders/:id/payment-proof` | 付款人上传付款截图：`multipart/form-data`，字段 `file`（PNG / JPG，≤5MB），仅待付款订单可传，重复上传会替换旧截图 → 返回 `Order`（`hasPaymentProof=true`） |
| `GET` | `/api/orders/:id/payment-proof` | 读取付款截图原图（仅订单双方；`Cache-Control: private, no-store`，禁止缓存） |
| `POST` | `/api/orders/:id/pay` | 付款人点「我已支付」：`{ channel, actualNote }`，**必须先上传付款截图**（否则 400），待付款 → 已支付 → 返回 `Order` |
| `POST` | `/api/orders/:id/confirm` | 商家确认收款：已支付 → 已完成（已支付订单必须有付款截图，否则 400）；待付款（当面付款）→ 已完成 → 返回 `Order` |
| `POST` | `/api/orders/:id/not-received` | 商家点「未收到」：已支付 → 待付款，通知付款人 → 返回 `Order` |
| `POST` | `/api/orders/:id/cancel` | 商家取消：`{ reason: "金额有误"|"已线下结清"|"对方未付款"|"其他", note? }`，待付款 → 已取消 → 返回 `Order` |
| `POST` | `/api/orders/:id/appeal` | 付款人申诉：`{ reason }`，写申诉记录 → 返回 `Order` |

说明：状态流转类接口（pay/confirm/not-received/cancel/appeal）直接返回扁平 `Order` 对象（不包 `order` 字段）；两个创建接口返回 `{ order: Order }`。

幂等：创建订单/转账接口都要传 `idempotencyKey`。同一用户 + 同一 key + 同一接口重复请求时，后端直接返回首次创建的响应（`200`，与首次返回体相同），不会重复下单。

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
  title: string;                 // 商品摘要、「自定义付款」或「转账」
  items: { name: string; priceCents: number; quantity: number }[] | null;
  reservedNote: string | null;
  actualNote: string | null;
  payChannel: "alipay" | "wechat" | "qq" | null;
  cancelReason: string | null;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  hasPaymentProof: boolean;      // 付款人是否已上传付款截图（商家确认收款前需要核对）
  paymentProofUrl: string | null; // 付款截图地址（仅订单双方可读），没有截图时为 null
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

### 7.3 商家自建收款单

商家先填好金额（或点选商品）生成一次性收款单，展示二维码/链接；付款人扫码确认后输入支付密码，系统按收款单快照创建订单，收款单随即失效（`pending → used`）。库内只保存令牌哈希，收款链接只在创建成功时返回一次。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/merchant/collections` | 商家创建收款单：`{ amountCents?, items?, reservedNote?, title? }`（`amountCents` 与 `items` 二选一；金额受商家订单单笔上限约束）→ `201 { collection: PaymentCollection, url }`，`url` 形如 `https://<站点>/collect/<token>`；每分钟限 30 次 |
| `GET` | `/api/merchant/collections?limit=20` | 商家自己的收款单列表 → `{ items: PaymentCollection[] }` |
| `GET` | `/api/merchant/collections/:id` | 商家查看单个收款单（用于创建页轮询付款状态） |
| `POST` | `/api/merchant/collections/:id/cancel` | 商家作废待付款收款单 → `PaymentCollection`（已使用/已过期时 409） |
| `GET` | `/api/collections/:token` | 付款人扫码预览：`PaymentCollection & { payeable: boolean }`；商家看自己的收款单 409，令牌无效 404 |
| `POST` | `/api/collections/:token/pay` | 付款人确认付款：`{ paymentPassword }` → `201 { collection, order }`（订单状态 `pending_payment`）；已被使用/过期/作废 409，密码错误按支付密码规则返回 4xx；每分钟限 10 次 |

```ts
interface PaymentCollection {
  id: string;
  status: "pending" | "used" | "cancelled" | "expired";
  amountCents: number;
  title: string;                       // 默认「自定义收款」，或首个商品名
  items: { name: string; priceCents: number; quantity: number }[] | null;
  reservedNote: string | null;
  merchant: PublicUser;
  merchantName: string;
  createdAt: string;
  expiresAt: string;                   // 默认 30 分钟（COLLECTION_TTL_SECONDS）
  decidedAt: string | null;
  orderId: string | null;              // 付款后对应的订单
}
```

付款成功后收款单状态为 `used` 并写入 `orderId`；商家创建页每 3 秒轮询 `GET /api/merchant/collections/:id`，看到 `used` 即跳转订单详情。

## 8. 交易统计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/stats/summary?from&to&includePending` | `{ expenseCents, incomeCents, netCents, orderCount, expenseCount, incomeCount, avgOrderCents, maxOrderCents, previous: { expenseCents, incomeCents, orderCount }, channels: [{ channel, label, count, amountCents }], hours: [{ hour, count, amountCents }] }`（`previous` 为等长上一区间用于环比；`hours` 为 0–23 时、服务器本地时间） |
| `GET` | `/api/stats/timeseries?from&to&granularity=day|month&includePending` | `{ buckets: [{ key, expenseCents, incomeCents, expenseCount, incomeCount }] }`，`key` 为服务器本地时区的日期（day: `YYYY-MM-DD`、month: `YYYY-MM`） |
| `GET` | `/api/stats/export?from&to&includePending` | CSV 文件（`text/csv; charset=utf-8`，带 BOM） |

## 9. 公告

公告按「创建即发布」处理：`publishedAt` 默认等于创建时间，管理员可以手动修改；公告正文为
Markdown，用户端按 Markdown 渲染。每个用户对每条公告有独立的已读记录。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/announcements` | 全部公告（置顶优先、按发布日期倒序）：`{ items: Announcement[], unreadCount }` |
| `POST` | `/api/announcements/:id/read` | 标记已读（幂等）：`{ ok: true, unreadCount }`；公告不存在 404 |

`Announcement`（用户端）：

```ts
interface Announcement {
  id: string;
  title: string;
  content: string;          // Markdown
  level: "info" | "important" | "warning";
  pinned: boolean;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  read: boolean;            // 当前用户是否已读
}
```

## 10. 管理后台

统一前缀 `/api/admin`。**管理后台复用主站登录会话**（同一个 `gzs_session` Cookie，没有独立的 OAuth 与邮箱二次验证）；已登录但不在 `admins` 表内的账号返回 401 `NOT_ADMIN`。写操作要求角色权限（`super` 全权、`ops` 运营、`auditor` 只读）。

管理后台前端的响应类型定义集中在 `web/src/admin/types.ts`，下文用其中的类型名说明。所有列表接口返回统一分页结构 `{ items, total, page, pageSize }`；操作类接口成功返回 `{ ok: true, ... }`。

### 10.1 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/auth/login` | `302` 到 `/api/auth/login?redirect=%2Fadmin`（复用主站校园墙登录） |
| `GET` | `/api/admin/auth/session` | 已登录且是管理员：`{ authenticated: true, initialized: true, admin: AdminIdentity }`；系统未初始化 `401 SYSTEM_NOT_INITIALIZED`；未登录 `401 UNAUTHENTICATED`；登录了但不是管理员 `401 NOT_ADMIN`（三者中「未初始化」优先判断） |
| `POST` | `/api/admin/auth/logout` | 退出登录（撤销主站会话）→ `{ ok: true }` |

`AdminIdentity`：`{ id, displayName, emailMasked, role: "super"|"ops"|"auditor", createdAt }`。

### 10.2 业务接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/overview` | `Overview`：总交易额、本月交易额、今日订单数、用户数、商家数、近 12 月 `trend`、`recentOrders`、`todos` |
| `GET` | `/api/admin/monthly?year&month` | `MonthlyData`：年视图返回 `{ year, months: MonthlyBucket[] }`（每月含 `days`）；指定 `month` 时返回该月每日桶 |
| `GET` | `/api/admin/users?query&page&pageSize` | 用户列表：`{ items: AdminUser[], total, page, pageSize }`，按姓名/学号/邮箱搜索 |
| `GET` | `/api/admin/users/growth?months=12` | `{ buckets: [{ key, label, count }] }` |
| `GET` | `/api/admin/users/online` | 当前在线：`{ items: OnlineUser[], total, onlineWindowMinutes }`；在线 = 会话未过期且最近 5 分钟内有请求（`OnlineUser` 含 `id/displayName/avatarUrl/studentNoMasked/isMerchant/ip/userAgent/lastSeenAt/sessionCount`） |
| `GET` | `/api/admin/users/logins?limit=8` | 授权登录情况：`{ total, recent: [{ id, displayName, avatarUrl, studentNoMasked, isMerchant, lastLoginAt }] }`；`total` 为至少成功登录过一次的用户数，`recent` 按最近登录时间倒序 |
| `GET` | `/api/admin/users/:id` | `{ user: AdminUserDetail, orderCount, totalAmountCents, recentOrders }` |
| `POST` | `/api/admin/users/:id/freeze` / `unfreeze` | 冻结/解冻（super/ops） |
| `POST` | `/api/admin/users/:id/reset-card` | 重置绑卡（super/ops） |
| `POST` | `/api/admin/users/:id/force-logout` | 强制下线（super/ops） |
| `GET` | `/api/admin/merchants?query&state&page&pageSize` | 商家列表：`{ items: AdminMerchant[], total, page, pageSize }`；`query` 模糊匹配商家名/负责人姓名/学号，`state=ready|suspended` 按「是否有可用收款方式」筛选（`AdminMerchant` 含 `userId/merchantName/displayName/avatarUrl/studentNoMasked/noteRequirement/channels/enabledChannelCount/productCount/activeProductCount/orderCount/completedAmountCents/lastOrderAt/suspended/frozen/createdAt`，`channels` 固定返回支付宝/微信/QQ 三项，含 `enabled`、`hasQr`、`updatedAt`） |
| `GET` | `/api/admin/merchants/summary` | `{ total, ready, suspended, newThisMonth }` |
| `GET` | `/api/admin/merchants/:userId` | `{ merchant: AdminMerchant, products: AdminMerchantProduct[], recentOrders: AdminOrder[] }`，商家不存在返回 `404 NOT_FOUND` |
| `POST` | `/api/admin/merchants/:userId/channels` | `{ channel: "alipay"|"wechat"|"qq", enabled }` 启用/停用某个收款方式（super/ops）；启用前必须已上传收款码，返回更新后的商家详情 |
| `POST` | `/api/admin/merchants/:userId/receiving` | `{ enabled }` 暂停/恢复商家收款（super/ops）：暂停即停用全部收款方式，付款人下单返回 `409 CONFLICT`「商家当前暂停收款」；恢复只启用已上传收款码的渠道，没有可用收款码时返回 `400 VALIDATION_FAILED`，返回更新后的商家详情 |
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
| `GET` | `/api/admin/stats` | `AdminStats`：趋势、商家排行、支付方式占比、转化漏斗、平均确认时长（分钟）、金额区间分布 `amountDistribution: [{ key, label, count, amountCents }]`、时段分布 `hourly: [{ hour, count, amountCents }]`、状态数量 `statusCounts: [{ status, label, count }]` |
| `GET` | `/api/admin/system/status` | `SystemStatus`：服务、邮件成功率、校园墙连通性、存储、队列、`alerts` |
| `GET` | `/api/admin/announcements` | `{ items: AdminAnnouncement[] }`：`AdminAnnouncement` = `Announcement` 去掉 `read`，另含 `readCount`（已读人数）、`totalUsers`（用户总数）、`edited`（创建后是否修改过） |
| `POST` | `/api/admin/announcements` | `{ title, content, level?, pinned?, publishedAt? }` → `{ ok: true, id }`；`publishedAt` 缺省为创建时间（super/ops） |
| `PATCH` | `/api/admin/announcements/:id` | 同上 → `{ ok: true, republished }`；标题/正文/级别/发布日期任一变化会清空已读记录（`republished: true`，用户端重新出现未读红点） |
| `DELETE` | `/api/admin/announcements/:id` | 删除（super/ops） |
| `GET` | `/api/admin/logs?type=audit|login|risk|error&from&to&query&page&pageSize` | `{ items: AdminLog[], ... }` |
| `GET` | `/api/admin/logs/export?type&from&to&query` | 日志 CSV |
| `GET` | `/api/admin/config` | `AdminConfig`：`{ campux: CampuxConfig, mail: MailConfig, security: SecurityConfig, system: SystemConfig, geo: GeoConfig, securityEntry: SecurityEntryConfig }`；`mail.passwordConfigured` / `campux.clientSecretConfigured` 表示是否已配置，不返回明文；`system` 含 `siteName/schoolName/publicBaseUrl/icp`；`geo` 含 `blockNonChina/bypassPaths/ipWhitelist/unknownPolicy/trustHeader` 与只读的 `dataUpdatedAt/ipv4Count/ipv6Count`；`securityEntry` 含 `entryPath`（空字符串表示未启用）与 `entryUrl` |
| `PUT` | `/api/admin/config` | 更新配置（仅 super）；body 为 `{ campux?, mail?, security?, system?, geo?, securityEntry? }`，各块可只传其一，未传的块保持不变。`campux` 为 `{ baseUrl, clientId, clientSecret?, scope? }`，`baseUrl`/`clientId` 都为空时视为「未配置」跳过写入（保留 `.env` 兜底），`clientSecret` 留空表示保留原密钥；`geo` 为 `{ blockNonChina, bypassPaths[], ipWhitelist, unknownPolicy: "deny"|"allow", trustHeader }`（白名单逗号分隔，逐项校验 IP/CIDR，非法返回 `400 VALIDATION_FAILED`）；`securityEntry` 为 `{ entryPath }`，`""` 表示关闭安全入口，否则需 4–32 位字母/数字/下划线/短横线且不能与站点已有路径冲突。`system` 为 `{ siteName, schoolName?, publicBaseUrl, icp? }`，`schoolName` 为校名（学校简称，最多 20 字符，留空表示界面只显示「校园服务」，不传表示保持原值），`icp` 为 ICP 备案号（最多 60 字符，空字符串表示不展示，不传表示保持原值）。保存后立即生效，返回更新后的 `AdminConfig` |
| `GET` | `/api/admin/security/entry-visits?limit=20` | `{ total, items: AdminEntryVisit[] }`：绕过安全入口直接访问 `/admin` 的访问记录（`id/ip/method/path/query/userAgent/referer/createdAt`），按时间倒序，最多保留约 3000 条 |
| `GET` | `/api/admin/traffic?days=7` | `TrafficStats`：最近 `days`（1–90，默认 7）天的访问统计。`{ days, since, until, requests: { total, today, averagePerDay }, scans: { total, items: TrafficBreakdownItem[] }, security: { total, items }, routes/statuses/devices/browsers/systems/regions: TrafficBreakdownItem[], series: [{ day, label, requests, scans, security }], generatedAt }`；`TrafficBreakdownItem` = `{ key, label, count, share }`。统计只保存按天聚合的计数（`traffic_counters` 表），**不保存 IP 与 User-Agent**，仅管理员可访问 |

角色权限：`GET` 类接口所有管理员可读；冻结/解冻/重置绑卡/强制下线/关单/标异常/公告增删改/申诉处理 = `super` + `ops`；管理员增删与系统配置写入 = 仅 `super`；`auditor` 只读（写操作 `403`）。


## 11. 其他

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | `{ status: "ok"|"degraded", version, time, uptimeSeconds, database: "up"|"down" }` |
| `GET` | `/api/about` | `{ version, changelog: [{ version, date, items[], groups: [{ title, items[] }] }], site: { name, schoolName, icp }, privacy, terms, privacyUpdatedAt, termsUpdatedAt, legalEffectiveAt }`（privacy/terms 为 Markdown 原文） |
