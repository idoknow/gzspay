/** gzspay 接口类型定义：与 docs/api.md 保持一致（金额单位一律为「分」）。 */

/** 收款渠道 */
export type PayChannel = "alipay" | "wechat" | "qq";

/** 渠道中文名（UI 展示用） */
export const PAY_CHANNEL_LABELS: Record<PayChannel, string> = {
  alipay: "支付宝",
  wechat: "微信支付",
  qq: "QQ 钱包",
};

/** 用户公开信息（对外展示，已脱敏） */
export interface PublicUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  studentNoMasked: string;
  isMerchant: boolean;
}

/** 新用户引导步骤 */
export type OnboardStep = "name" | "studentNo" | "email" | "card" | "password" | "done";

export interface NotificationSettings {
  newOrder: boolean;
  paid: boolean;
  settled: boolean;
}

/** 当前登录用户 */
export interface Me {
  id: string;
  displayName: string;
  surname: string | null;
  givenName: string | null;
  fullName: string | null;
  studentNo: string | null;
  emailMasked: string | null;
  email: string | null;
  /** 完整卡号：默认脱敏展示，点击后再显示 */
  cardNo: string | null;
  cardNoMasked: string | null;
  avatarUrl: string | null;
  onboarded: boolean;
  onboardStep: OnboardStep;
  isMerchant: boolean;
  isAdmin: boolean;
  paymentPasswordSet: boolean;
  frozen: boolean;
  notificationSettings: NotificationSettings;
  createdAt: string;
}

/** GET /api/auth/session */
export interface SessionResponse {
  authenticated: boolean;
  me?: Me;
  onboardStep?: OnboardStep;
  isAdmin?: boolean;
}

/** POST /api/auth/dev-login */
export interface DevLoginResponse {
  me: Me;
}

/** GET /api/onboarding */
export interface OnboardingResponse {
  step: OnboardStep;
  steps: OnboardStep[];
  me: Me;
}

/** 发送邮箱验证码的返回（开发环境带 devCode） */
export interface EmailStartResponse {
  sent: boolean;
  devCode?: string;
}

export interface OnboardingNamePayload {
  surname: string;
  givenName: string;
}

export interface OnboardingStudentNoPayload {
  studentNo: string;
}

export interface OnboardingEmailVerifyPayload {
  email: string;
  code: string;
}

export interface OnboardingCardPayload {
  cardContent: string;
}

export interface OnboardingPasswordPayload {
  password: string;
  confirm: string;
}

/** 商品 */
export interface Product {
  id: string;
  name: string;
  priceCents: number;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  sortOrder: number;
}

/** 商家收款渠道（GET /api/merchant 中 channels 为固定顺序数组，api.ts 已归一化） */
export interface MerchantChannel {
  channel: PayChannel;
  label: string;
  enabled: boolean;
  hasQr: boolean;
  updatedAt?: string;
}

/** GET /api/merchant */
export interface MerchantInfo {
  userId: string;
  name: string;
  noteRequirement: string;
  channels: MerchantChannel[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MerchantResponse {
  registered: boolean;
  merchant: MerchantInfo | null;
}

/** GET /api/merchant/public/:userId —— 扫码后的商家主页数据 */
export interface MerchantPublic {
  user: PublicUser;
  merchantName: string;
  noteRequirement: string;
  products: Product[];
  /** 该商家当前启用的收款方式（固定顺序） */
  channels: PayChannel[];
}

/** 订单商品项（下单时快照） */
export interface OrderItem {
  productId?: string;
  name: string;
  priceCents: number;
  quantity: number;
}

export type OrderStatus = "pending_payment" | "paid" | "completed" | "cancelled";
export type OrderRole = "payer" | "merchant";

export interface OrderEvent {
  id: string;
  type: string;
  actorRole: string;
  detail: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNo: string;
  amountCents: number;
  status: OrderStatus;
  /** 商品摘要或「自定义付款」 */
  title: string;
  items: OrderItem[] | null;
  reservedNote: string | null;
  actualNote: string | null;
  payChannel: PayChannel | null;
  cancelReason: string | null;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  role: OrderRole;
  /** 订单由谁创建：商家扫客户动态码下单时为 merchant */
  createdBy: "payer" | "merchant";
  counterparty: PublicUser;
  merchantName: string;
  payerNameSnapshot: string;
  noteRequirement: string;
  events: OrderEvent[];
  hasAppeal: boolean;
}

/** 订单详情：在列表字段基础上附带商家已启用的收款方式 */
export interface OrderDetail extends Order {
  availableChannels?: PayChannel[];
}

export interface OrderListResponse {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}

/** POST /api/orders 请求体 */
export interface CreateOrderPayload {
  merchantUserId: string;
  items?: { productId: string; quantity: number }[];
  amountCents?: number;
  reservedNote: string;
  paymentPassword: string;
  idempotencyKey: string;
  source?: string;
  /** 客户扫商家动态码下单时携带（双手机场景） */
  dynamicCodeToken?: string;
}

/** POST /api/orders/merchant-create 请求体（paymentPassword 是客户在商家手机上输入的密码） */
export interface MerchantCreateOrderPayload {
  cardContent: string;
  items?: { productId: string; quantity: number }[];
  amountCents?: number;
  reservedNote: string;
  paymentPassword: string;
  idempotencyKey: string;
}

export interface CancelOrderPayload {
  reason: "金额有误" | "已线下结清" | "对方未付款" | "其他";
  note?: string;
}

/** 我的校园卡二维码 */
export interface CardQrResponse {
  content: string;
  cardNoMasked: string;
}

/** POST /api/scan/card：扫描校园卡二维码后解析出的身份 */
export interface ScanCardResponse {
  user: PublicUser;
  isMerchant: boolean;
  /** 扫到的是自己 */
  isSelf: boolean;
  cardNoMasked: string | null;
}

/** 动态码（api.ts 已归一化） */
export interface DynamicCodeResponse {
  token: string;
  expiresAt: string;
  /** 建议刷新间隔（秒） */
  refreshAfterSeconds: number;
  /** 二维码内容（服务端返回优先，形如 gzspay:dynamic:<token>） */
  qrContent: string;
  /** 校园卡二维码前缀（服务端下发，形如 gzspay:card:） */
  prefix: string;
}

/** GET /api/dynamic-code/:token/resolve（只读不消费） */
export interface DynamicCodeResolveResponse {
  user: PublicUser;
  isMerchant: boolean;
}

export type PaymentRequestStatus = "pending" | "accepted" | "rejected" | "expired";

/** 动态码收款请求（SSE payment_request 的 data 也是这个扁平结构） */
export interface PaymentRequest {
  id: string;
  status: PaymentRequestStatus;
  amountCents: number;
  title: string;
  items: OrderItem[] | null;
  reservedNote: string | null;
  /** 发起收款的商家（公开信息） */
  merchant: PublicUser;
  merchantName?: string;
  customerId?: string;
  createdAt: string;
  expiresAt?: string | null;
  orderId: string | null;
}

export interface CreatePaymentRequestPayload {
  token: string;
  amountCents: number;
  items?: { productId: string; quantity: number }[];
  reservedNote: string;
}

/** SSE payment_request 事件的 data：扁平收款请求 */
export type PaymentRequestEvent = PaymentRequest;

export interface OrderUpdateEvent {
  orderId: string;
  status?: OrderStatus;
}

/** 统计 */
export interface StatsSummary {
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  orderCount: number;
}

export interface StatsBucket {
  key: string;
  expenseCents: number;
  incomeCents: number;
}

export interface StatsTimeseries {
  buckets: StatsBucket[];
}

/** 公告 */
export interface Announcement {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
}

export interface AnnouncementsResponse {
  items: Announcement[];
}

/** 关于页 */
/** 关于页：更新日志分组（新增 / 变更 / 修复） */
export interface ChangelogGroup {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  /** 展平后的全部条目 */
  items: string[];
  /** 按「新增 / 变更 / 修复」分组 */
  groups: ChangelogGroup[];
}

export interface AboutResponse {
  version: string;
  changelog: ChangelogEntry[];
  /** Markdown 原文 */
  privacy: string;
  /** Markdown 原文 */
  terms: string;
  /** 隐私协议最近一次改动日期（YYYY-MM-DD） */
  privacyUpdatedAt: string;
  /** 服务条款最近一次改动日期（YYYY-MM-DD） */
  termsUpdatedAt: string;
  /** 两份文档的生效日期（YYYY-MM-DD） */
  legalEffectiveAt: string;
}
