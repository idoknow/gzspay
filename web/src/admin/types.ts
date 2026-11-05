/**
 * 管理后台共享类型。
 * 字段命名与 docs/api.md「管理后台」章节保持一致；金额一律为「分」，时间为 ISO 8601。
 */

/** 管理员角色：超级管理员 / 运营 / 只读审计 */
export type AdminRole = "super" | "ops" | "auditor";

/** 徽标色系 */
export type BadgeTone =
  | "primary"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

/** 当前登录管理员身份 */
export interface AdminIdentity {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  emailMasked: string | null;
  role: AdminRole;
  createdAt: string | null;
}

/** 管理后台会话状态（GET /admin/auth/session，复用主站 Cookie） */
export interface AdminSession {
  authenticated: boolean;
  /** 系统是否已完成初始化；接口未返回时为 undefined */
  initialized?: boolean;
  admin: AdminIdentity | null;
  emailMasked: string | null;
}

/** 通用分页响应 */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 趋势桶（按月或按日） */
export interface TrendBucket {
  /** 桶键：2026-01（月）或 2026-01-05（日） */
  key: string;
  /** 图上的短标签 */
  label: string;
  amountCents: number;
  orderCount: number;
}

/** 总览页待处理事项 */
export interface TodoItem {
  id: string;
  title: string;
  detail: string | null;
  level: BadgeTone;
  createdAt: string | null;
}

/** GET /admin/overview */
export interface Overview {
  totalAmountCents: number;
  monthAmountCents: number;
  todayOrderCount: number;
  userCount: number;
  merchantCount: number;
  trend: TrendBucket[];
  recentOrders: AdminOrder[];
  todos: TodoItem[];
}

/** 每日交易额桶 */
export interface DailyBucket {
  key: string;
  label: string;
  amountCents: number;
  orderCount: number;
}

/** 每月交易额桶（含该月每日趋势） */
export interface MonthlyBucket extends DailyBucket {
  days: DailyBucket[];
}

/** GET /admin/monthly?year */
export interface MonthlyData {
  year: number;
  months: MonthlyBucket[];
}

/* ------------------------------------------------------------------ 用户 */

/** 用户管理列表行 */
export interface AdminUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  studentNo: string | null;
  email: string | null;
  studentNoMasked: string | null;
  emailMasked: string | null;
  isMerchant: boolean;
  frozen: boolean;
  createdAt: string | null;
  orderCount: number;
  totalAmountCents: number;
}

/** 用户详情（含脱敏/明文资料） */
export interface AdminUserDetail extends AdminUser {
  studentNo: string | null;
  email: string | null;
  cardNo: string | null;
  cardNoMasked: string | null;
  lastLoginAt: string | null;
  frozenReason: string | null;
}

/** GET /admin/users/:id */
export interface UserDetailPayload {
  user: AdminUserDetail;
  orderCount: number;
  totalAmountCents: number;
  recentOrders: AdminOrder[];
}

/** 在线用户（会话未过期且最近几分钟内有请求） */
export interface OnlineUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  studentNo: string | null;
  studentNoMasked: string | null;
  isMerchant: boolean;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  sessionCount: number;
}

/** GET /admin/users/online */
export interface OnlineUsersPayload {
  items: OnlineUser[];
  total: number;
  onlineWindowMinutes: number;
}

/** 授权登录成功过的用户（最近登录情况） */
export interface AdminUserLogin {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  studentNo: string | null;
  studentNoMasked: string | null;
  isMerchant: boolean;
  lastLoginAt: string;
}

/** GET /admin/users/logins */
export interface AdminUserLoginsPayload {
  total: number;
  recent: AdminUserLogin[];
}

/* ---------------------------------------------------------------- 商家 */

/** 商家的某个收款方式 */
export interface AdminMerchantChannel {
  channel: "alipay" | "wechat" | "qq";
  label: string;
  enabled: boolean;
  hasQr: boolean;
  updatedAt: string | null;
}

/** 商家管理列表行 */
export interface AdminMerchant {
  userId: string;
  merchantName: string;
  displayName: string;
  avatarUrl: string | null;
  studentNo: string | null;
  studentNoMasked: string | null;
  noteRequirement: string;
  channels: AdminMerchantChannel[];
  enabledChannelCount: number;
  productCount: number;
  activeProductCount: number;
  orderCount: number;
  completedAmountCents: number;
  lastOrderAt: string | null;
  suspended: boolean;
  frozen: boolean;
  createdAt: string;
}

/** GET /admin/merchants/summary */
export interface MerchantSummary {
  total: number;
  ready: number;
  suspended: number;
  newThisMonth: number;
}

/** 商家列表筛选状态 */
export type MerchantStateFilter = "all" | "ready" | "suspended";

/** 商家详情里的商品 */
export interface AdminMerchantProduct {
  id: string;
  name: string;
  priceCents: number;
  description: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

/** GET /admin/merchants/:userId */
export interface MerchantDetailPayload {
  merchant: AdminMerchant;
  products: AdminMerchantProduct[];
  recentOrders: AdminOrder[];
}

/* ---------------------------------------------------------------- 管理员 */

/** 管理员管理列表行 */
export interface AdminMember {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  emailMasked: string | null;
  role: AdminRole;
  createdAt: string | null;
}

/* ------------------------------------------------------------------ 订单 */

/** 订单状态（后端返回未知值时归一为 unknown） */
export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "completed"
  | "cancelled"
  | "unknown";

/** 付款渠道 */
export type PayChannel = "alipay" | "wechat" | "qq" | "unknown";

/** 管理后台订单行 */
export interface AdminOrder {
  id: string;
  orderNo: string;
  amountCents: number;
  status: OrderStatus;
  title: string;
  payChannel: PayChannel | null;
  createdAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  merchantName: string;
  payerName: string;
  merchantUserId: string | null;
  payerUserId: string | null;
  hasAppeal: boolean;
  flagged: boolean;
  flagReason: string | null;
  reservedNote: string | null;
  actualNote: string | null;
  cancelReason: string | null;
}

/** 订单时间线事件 */
export interface OrderEvent {
  id: string;
  type: string;
  actorRole: string;
  detail: string | null;
  createdAt: string | null;
}

/** GET /admin/orders/:id */
export interface AdminOrderDetail extends AdminOrder {
  events: OrderEvent[];
  appeal: AdminAppeal | null;
}

/** 订单筛选条件（金额单位：分） */
export interface OrderFilters {
  from?: string;
  to?: string;
  status?: OrderStatus | "all";
  merchantId?: string;
  payerId?: string;
  minAmount?: number;
  maxAmount?: number;
  query?: string;
}

/* ------------------------------------------------------------------ 申诉 */

export type AppealStatus = "pending" | "resolved" | "rejected" | "unknown";

/** 申诉记录 */
export interface AdminAppeal {
  id: string;
  orderId: string;
  orderNo: string;
  reason: string;
  status: AppealStatus;
  createdAt: string | null;
  payerName: string | null;
  merchantName: string | null;
  amountCents: number | null;
  handledNote: string | null;
}

/* ------------------------------------------------------------------ 统计 */

/** 商家排行行 */
export interface MerchantRank {
  id: string;
  name: string;
  amountCents: number;
  orderCount: number;
}

/** 支付方式占比 */
export interface PaymentMethodStat {
  method: PayChannel;
  label: string;
  count: number;
  amountCents: number;
}

/** 转化漏斗步骤 */
export interface FunnelStep {
  key: string;
  label: string;
  count: number;
}

/**
 * 金额区间分布桶。
 * key 取值：lt10 / 10to50 / 50to100 / 100to500 / gte500。
 */
export interface AmountBucket {
  key: string;
  label: string;
  /** 该区间订单数 */
  count: number;
  /** 该区间交易额（分） */
  amountCents: number;
}

/** 时段分布桶（0–23 时，服务器本地时间） */
export interface HourBucket {
  hour: number;
  count: number;
  amountCents: number;
}

/** 订单状态数量（各状态在全量订单中的占比基数） */
export interface StatusCount {
  /** 订单状态，如 pending_payment / paid / completed / cancelled */
  status: string;
  label: string;
  count: number;
}

/** GET /admin/stats */
export interface AdminStats {
  trend: TrendBucket[];
  merchantRanking: MerchantRank[];
  paymentMethods: PaymentMethodStat[];
  funnel: FunnelStep[];
  avgConfirmMinutes: number;
  /** 金额区间分布（已完成订单） */
  amountDistribution: AmountBucket[];
  /** 24 小时时段分布，hour 固定 0–23 */
  hourly: HourBucket[];
  /** 各订单状态数量 */
  statusCounts: StatusCount[];
}

/* -------------------------------------------------------------- 系统状态 */

export type ServiceHealth = "up" | "degraded" | "down" | "unknown";

export interface ServiceStatus {
  name: string;
  status: ServiceHealth;
  latencyMs: number | null;
  /** 错误率，单位：百分比（0-100） */
  errorRate: number | null;
  /** 可用率，单位：百分比（0-100） */
  uptime: number | null;
}

export interface MailStatus {
  /** 成功率，单位：百分比（0-100） */
  successRate: number;
  sent: number;
  failed: number;
}

export interface CampuxStatus {
  ok: boolean;
  latencyMs: number | null;
  message: string | null;
}

export interface StorageStatus {
  dbSizeBytes: number;
  uploadsSizeBytes: number;
  /** 磁盘占用，单位：百分比（0-100） */
  diskUsedPercent: number | null;
}

export interface QueueStatus {
  pending: number;
  failed: number;
  processed: number | null;
}

export interface SystemAlert {
  id: string;
  level: BadgeTone;
  message: string;
}

/** 严重系统错误的主动告警通道状态 */
export interface SystemAlerting {
  webhookConfigured: boolean;
  emailEnabled: boolean;
  /** 有邮箱的管理员数量 */
  recipients: number;
  /** 最近一次主动告警时间 */
  lastAlertAt: string | null;
  /** 最近一小时发出的告警次数 */
  dispatchedLastHour: number;
}

/** GET /admin/system/status */
export interface SystemStatus {
  services: ServiceStatus[];
  mail: MailStatus;
  campux: CampuxStatus;
  storage: StorageStatus;
  queue: QueueStatus;
  alerting: SystemAlerting;
  alerts: SystemAlert[];
  updatedAt: string | null;
}

/* ------------------------------------------------------------------ 访问统计 */

/** 单个维度的一项计数 */
export interface TrafficBreakdownItem {
  key: string;
  label: string;
  count: number;
  /** 占比（0–100，保留一位小数） */
  share: number;
}

/** 按天的趋势点 */
export interface TrafficSeriesPoint {
  day: string;
  label: string;
  requests: number;
  scans: number;
  security: number;
}

/** GET /admin/traffic */
export interface TrafficStats {
  days: number;
  since: string;
  until: string;
  requests: { total: number; today: number; averagePerDay: number };
  scans: { total: number; items: TrafficBreakdownItem[] };
  security: { total: number; items: TrafficBreakdownItem[] };
  routes: TrafficBreakdownItem[];
  statuses: TrafficBreakdownItem[];
  devices: TrafficBreakdownItem[];
  browsers: TrafficBreakdownItem[];
  systems: TrafficBreakdownItem[];
  regions: TrafficBreakdownItem[];
  series: TrafficSeriesPoint[];
  generatedAt: string;
}

/* ------------------------------------------------------------------ 公告 */

export type AnnouncementLevel = "info" | "important" | "warning";

export interface Announcement {
  id: string;
  title: string;
  content: string;
  level: AnnouncementLevel;
  pinned: boolean;
  /** 发布日期（默认等于创建时间，可由管理员修改） */
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** 已读人数 / 用户总数 */
  readCount: number;
  totalUsers: number;
  /** 创建后是否被修改过（用于展示「修改于」） */
  edited: boolean;
}

/** 新建/编辑公告入参 */
export interface AnnouncementInput {
  title: string;
  content: string;
  level: AnnouncementLevel;
  pinned: boolean;
  publishedAt: string | null;
}

/* ------------------------------------------------------------------ 日志 */

export type LogType = "audit" | "login" | "risk" | "error";

/** 日志行（不同页签按类型展示不同列） */
export interface AdminLog {
  id: string;
  type: LogType;
  createdAt: string | null;
  actorName: string | null;
  action: string | null;
  target: string | null;
  detail: string | null;
  ip: string | null;
  userAgent: string | null;
  result: string | null;
  level: string | null;
  message: string | null;
}

/** 日志筛选条件 */
export interface LogFilters {
  from?: string;
  to?: string;
  query?: string;
}

/* ------------------------------------------------------------------ 配置 */

export interface MailConfig {
  /** 当前生效的发件通道：resend=Resend（环境变量配置），smtp=SMTP，none=未配置（只写 outbox） */
  provider: "resend" | "smtp" | "none";
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromName: string;
  fromAddress: string;
  /** 是否已配置 SMTP 密码（不回显明文） */
  passwordConfigured: boolean;
}

export interface SecurityConfig {
  /** 支付密码连续错误次数上限 */
  paymentPasswordMaxAttempts: number;
  /** 支付密码锁定时长（分钟） */
  paymentPasswordLockMinutes: number;
  /** 单笔金额上限（分） */
  singlePaymentLimitCents: number;
  /** 每日金额上限（分） */
  dailyPaymentLimitCents: number;
  /** 动态码有效期（秒） */
  dynamicCodeTtlSeconds: number;
  /** 邮箱验证码有效期（秒） */
  emailCodeTtlSeconds: number;
  /** 会话有效天数 */
  sessionTtlDays: number;
}

/** 校园墙 OAuth 登录配置（密钥不回显） */
export interface CampuxConfig {
  /** 校园墙站点地址，例如 https://gz.campux.top */
  baseUrl: string;
  clientId: string;
  /** 是否已保存 Client Secret */
  clientSecretConfigured: boolean;
  /** OAuth 授权范围，默认 profile */
  scope: string;
}

/** 站点信息 */
export interface SiteConfig {
  siteName: string;
  /** 校名（学校简称），空字符串表示未配置 */
  schoolName: string;
  publicBaseUrl: string;
  /** ICP 备案号，空字符串表示不展示 */
  icp: string;
  /** 上传的收款账单原文件保留天数（1–365） */
  billRetentionDays: number;
  /** 付款截图保留天数（1–365） */
  paymentProofRetentionDays: number;
}

/** 地区访问限制（仅允许中国大陆 IP） */
export interface GeoConfig {
  blockNonChina: boolean;
  /** 例外路径，精确匹配或以 `/`、`*` 结尾表示前缀 */
  bypassPaths: string[];
  /** 白名单 IP / CIDR，逗号分隔 */
  ipWhitelist: string;
  /** 归属未知时的策略：deny 拦截、allow 放行 */
  unknownPolicy: "deny" | "allow";
  /** CDN 提供的国家码请求头（如 CF-IPCountry） */
  trustHeader: string;
  /** IP 段数据更新时间（只读） */
  dataUpdatedAt: string | null;
  /** IPv4 段数量（只读） */
  ipv4Count: number;
  /** IPv6 段数量（只读） */
  ipv6Count: number;
}

/** 管理后台安全入口 */
export interface AdminEntryConfig {
  /** 安全入口名，空字符串表示未启用 */
  entryPath: string;
  /** 实际入口地址（不含域名），未启用时为 admin */
  entryUrl: string;
}

/** 未通过安全入口直接访问后台的尝试记录 */
export interface AdminEntryVisit {
  id: string;
  ip: string | null;
  method: string;
  path: string;
  query: string | null;
  userAgent: string | null;
  referer: string | null;
  createdAt: string;
}

export interface AdminEntryVisitsPayload {
  total: number;
  items: AdminEntryVisit[];
}

/** GET /admin/config */
export interface AdminConfig {
  campux: CampuxConfig;
  mail: MailConfig;
  security: SecurityConfig;
  system: SiteConfig;
  geo: GeoConfig;
  securityEntry: AdminEntryConfig;
}

/** PUT /admin/config 入参（各块均可只传其一） */
export interface AdminConfigInput {
  campux?: {
    baseUrl: string;
    clientId: string;
    /** 仅当填写新密钥时提交 */
    clientSecret?: string;
    scope?: string;
  };
  mail?: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    fromName: string;
    fromAddress: string;
    /** 仅当填写新密码时提交 */
    password?: string;
  };
  security?: SecurityConfig;
  system?: {
    siteName: string;
    /** 校名（学校简称），空字符串表示不展示校名 */
    schoolName?: string;
    publicBaseUrl: string;
    /** ICP 备案号，空字符串表示不展示 */
    icp?: string;
    /** 上传的收款账单原文件保留天数（1–365） */
    billRetentionDays?: number;
    /** 付款截图保留天数（1–365） */
    paymentProofRetentionDays?: number;
  };
  geo?: {
    blockNonChina: boolean;
    bypassPaths: string[];
    ipWhitelist: string;
    unknownPolicy: "deny" | "allow";
    trustHeader: string;
  };
  securityEntry?: {
    /** 空字符串表示关闭安全入口 */
    entryPath: string;
  };
}

/* ---------------------------------------------------------------- 初始化 */

/** 初始化向导步骤编号：校园墙 → 发件 → 站点 → 完成 */
export type SetupStep = 1 | 2 | 3 | 4;

/** 初始化向导中当前已登录的主站用户 */
export interface SetupCurrentUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** 站点信息（GET /setup/status 的 system） */
export interface SetupSystemInfo {
  siteName: string;
  /** 校名（学校简称），空字符串表示未配置 */
  schoolName: string;
  publicBaseUrl: string;
  /** ICP 备案号，空字符串表示未填写 */
  icp: string;
}

/** 校园墙登录配置（GET /setup/status 的 campux，密钥不回显） */
export interface SetupCampuxInfo {
  baseUrl: string;
  clientId: string;
  /** 是否已保存 Client Secret */
  clientSecretConfigured: boolean;
  scope: string;
}

/** 发件配置（GET /setup/status 的 mail，密码不回显） */
export interface SetupMailInfo {
  /** 当前生效的发件通道：resend=Resend（环境变量配置），smtp=SMTP，none=未配置 */
  provider: "resend" | "smtp" | "none";
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** 是否已保存 SMTP 密码 */
  passwordConfigured: boolean;
  fromName: string;
  fromAddress: string;
}

/** GET /setup/status —— 系统初始化状态（无需登录） */
export interface SetupStatus {
  initialized: boolean;
  campuxConfigured: boolean;
  mailConfigured: boolean;
  adminCount: number;
  /** 当前主站登录用户；未登录为 null */
  currentUser: SetupCurrentUser | null;
  /** true 表示初始化需要先填写服务端日志里打印的一次性初始化令牌 */
  setupTokenRequired: boolean;
  system: SetupSystemInfo;
  campux: SetupCampuxInfo;
  mail: SetupMailInfo;
}

/** POST /setup/config 入参：允许分步提交，未提供的字段保持原值 */
export interface SetupConfigInput {
  campux?: {
    baseUrl: string;
    clientId: string;
    /** 留空表示保留已保存的密钥（首次必填） */
    clientSecret: string;
    scope: string;
  };
  mail?: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    /** 留空表示保留已保存的密码（首次必填） */
    password: string;
    fromName: string;
    fromAddress: string;
  };
  system?: {
    siteName: string;
    /** 站点对外地址，留空表示使用当前访问地址 */
    publicBaseUrl?: string;
  };
}

/** 初始化完成后生效的超级管理员 */
export interface SetupAdmin {
  id: string;
  displayName: string;
  role: AdminRole;
}

/** POST /setup/finish 结果 */
export interface SetupFinishResult {
  admin: SetupAdmin | null;
}

/* ------------------------------------------------------------- 通用查询 */

export type AdminQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

/* ------------------------------------------------------------------ 工单 */

export type AdminTicketStatus = "open" | "closed";
export type AdminTicketClosedReason = "user" | "admin" | "timeout";

export interface AdminTicketMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: "payer" | "merchant" | "admin";
  senderName: string;
  /** 头像地址；平台客服消息为 null，展示站点 logo */
  senderAvatarUrl: string | null;
  body: string;
  createdAt: string;
}

/** 工单双方资料（后台可核对姓名、学号、QQ、邮箱） */
export interface AdminTicketParty {
  id: string;
  role: "payer" | "merchant";
  displayName: string;
  studentNo: string | null;
  qq: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface AdminTicketParties {
  payer: AdminTicketParty;
  merchant: AdminTicketParty;
}

/** GET /admin/tickets 列表项 */
export interface AdminTicket {
  id: string;
  orderId: string;
  orderNo: string;
  orderTitle: string;
  amountCents: number;
  category: string;
  categoryLabel: string;
  status: AdminTicketStatus;
  openerName: string;
  payerName: string;
  merchantName: string;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
}

/** GET /admin/tickets/:id（含完整对话与双方资料） */
export interface AdminTicketDetail extends AdminTicket {
  parties: AdminTicketParties;
  messages: AdminTicketMessage[];
  closedAt: string | null;
  closedReason: AdminTicketClosedReason | null;
  resolutionNote: string | null;
}

export interface TicketFilters {
  status: AdminTicketStatus | "all";
  keyword: string;
}
