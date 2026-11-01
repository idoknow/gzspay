/** 集中式 API 层：页面只调用这里，不直接 fetch / 不直接拼接口路径。 */

import { api, openEventStream, ApiError } from "./http";
import { PAY_CHANNEL_LABELS } from "./types";
import type {
  AboutResponse,
  AnnouncementReadResponse,
  AnnouncementsResponse,
  CardQrResponse,
  CreateOrderPayload,
  CreatePaymentRequestPayload,
  DynamicCodeResolveResponse,
  DynamicCodeResponse,
  EmailStartResponse,
  MerchantChannel,
  MerchantCreateOrderPayload,
  MerchantInfo,
  MerchantPublic,
  MerchantResponse,
  Me,
  NotificationSettings,
  OnboardingCardPayload,
  OnboardingEmailVerifyPayload,
  OnboardingNamePayload,
  OnboardingPasswordPayload,
  OnboardingResponse,
  OnboardingStudentNoPayload,
  Order,
  OrderDetail,
  OrderListResponse,
  OrderStatus,
  PayChannel,
  PaymentRequest,
  Product,
  ScanCardResponse,
  SessionResponse,
  SetupStatus,
  StatsSummary,
  StatsTimeseries,
} from "./types";

/** 渠道枚举（固定顺序：支付宝、微信、QQ） */
export const PAY_CHANNELS: PayChannel[] = ["alipay", "wechat", "qq"];

/* ------------------------------------------------------------------ */
/* 通用小工具                                                          */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 兼容 `{ order }` / 直接返回订单对象两种包装 */
function unwrapOrder(raw: unknown): Order {
  if (isRecord(raw) && isRecord(raw.order)) return raw.order as unknown as Order;
  return raw as Order;
}

/** 把 ISO 时间/秒数统一成「还有多少秒」 */
function secondsUntil(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string") {
    const time = Date.parse(value);
    if (!Number.isNaN(time)) return Math.max(1, Math.round((time - Date.now()) / 1000));
  }
  return fallback;
}

/** 商家渠道归一化为固定顺序数组（兼容数组/对象两种返回，缺失渠道补默认值） */
function normalizeMerchantChannels(value: unknown): MerchantChannel[] {
  const states = new Map<PayChannel, { enabled: boolean; hasQr: boolean; updatedAt?: string }>();

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isRecord(entry)) continue;
      const channel = entry.channel;
      if (channel === "alipay" || channel === "wechat" || channel === "qq") {
        states.set(channel, {
          enabled: entry.enabled === true,
          hasQr: entry.hasQr === true || typeof entry.qrContent === "string",
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : undefined,
        });
      }
    }
  } else if (isRecord(value)) {
    for (const channel of PAY_CHANNELS) {
      const state = value[channel];
      if (!isRecord(state)) continue;
      states.set(channel, {
        enabled: state.enabled === true,
        hasQr: state.hasQr === true || typeof state.qrContent === "string",
      });
    }
  }

  return PAY_CHANNELS.map((channel) => {
    const state = states.get(channel);
    return {
      channel,
      label: PAY_CHANNEL_LABELS[channel],
      enabled: state?.enabled === true,
      hasQr: state?.hasQr === true,
      updatedAt: state?.updatedAt,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 0. 系统初始化                                                       */
/* ------------------------------------------------------------------ */

/** 系统初始化状态（无需登录）：主站启动时用来判断是否显示「系统尚未初始化」拦截页 */
export function getSetupStatus(): Promise<SetupStatus> {
  return api.get<SetupStatus>("/setup/status");
}

/* ------------------------------------------------------------------ */
/* 1. 认证                                                             */
/* ------------------------------------------------------------------ */

/** 校园墙授权登录入口（整页跳转，由后端 302 到校园墙） */
export const LOGIN_URL = "/api/auth/login";

export function getSession(): Promise<SessionResponse> {
  return api.get<SessionResponse>("/auth/session");
}

export function logout(): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>("/auth/logout");
}

/* ------------------------------------------------------------------ */
/* 2. 新用户引导                                                       */
/* ------------------------------------------------------------------ */

export function getOnboarding(): Promise<OnboardingResponse> {
  return api.get<OnboardingResponse>("/onboarding");
}

export function submitOnboardingName(payload: OnboardingNamePayload): Promise<OnboardingResponse> {
  return api.post<OnboardingResponse>("/onboarding/name", payload);
}

export function submitOnboardingStudentNo(payload: OnboardingStudentNoPayload): Promise<OnboardingResponse> {
  return api.post<OnboardingResponse>("/onboarding/student-no", payload);
}

export function startOnboardingEmail(email: string): Promise<EmailStartResponse> {
  return api.post<EmailStartResponse>("/onboarding/email/start", { email });
}

export function verifyOnboardingEmail(payload: OnboardingEmailVerifyPayload): Promise<OnboardingResponse> {
  return api.post<OnboardingResponse>("/onboarding/email/verify", payload);
}

export function submitOnboardingCard(payload: OnboardingCardPayload): Promise<OnboardingResponse> {
  return api.post<OnboardingResponse>("/onboarding/card", payload);
}

export function submitOnboardingPassword(payload: OnboardingPasswordPayload): Promise<OnboardingResponse> {
  return api.post<OnboardingResponse>("/onboarding/payment-password", payload);
}

/* ------------------------------------------------------------------ */
/* 3. 支付密码                                                         */
/* ------------------------------------------------------------------ */

export function startPaymentPasswordReset(): Promise<EmailStartResponse> {
  return api.post<EmailStartResponse>("/me/payment-password/reset/start");
}

export function verifyPaymentPasswordReset(code: string): Promise<{ resetToken: string }> {
  return api.post<{ resetToken: string }>("/me/payment-password/reset/verify", { code });
}

export function confirmPaymentPasswordReset(payload: {
  resetToken: string;
  password: string;
  confirm: string;
}): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>("/me/payment-password/reset/confirm", payload);
}

/** 修改敏感信息前的二次确认 */
export function verifyPaymentPassword(password: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>("/me/payment-password/verify", { password });
}

/* ------------------------------------------------------------------ */
/* 4. 我的                                                             */
/* ------------------------------------------------------------------ */

export function getMe(): Promise<Me> {
  return api.get<Me>("/me");
}

export function updateProfile(payload: {
  surname?: string;
  givenName?: string;
  studentNo?: string;
  paymentPassword: string;
}): Promise<Me> {
  return api.patch<Me>("/me/profile", payload);
}

export function startEmailChange(payload: {
  email: string;
  paymentPassword: string;
}): Promise<EmailStartResponse> {
  return api.post<EmailStartResponse>("/me/email/start", payload);
}

export function verifyEmailChange(payload: {
  email: string;
  code: string;
  paymentPassword: string;
}): Promise<Me> {
  return api.post<Me>("/me/email/verify", payload);
}

export function bindCard(payload: { cardContent: string; paymentPassword: string }): Promise<Me> {
  return api.post<Me>("/me/card", payload);
}

export function updateNotificationSettings(settings: Partial<NotificationSettings>): Promise<Me> {
  return api.patch<Me>("/me/settings", settings);
}

export function getCardQr(): Promise<CardQrResponse> {
  return api.get<CardQrResponse>("/me/card-qr");
}

export function getAbout(): Promise<AboutResponse> {
  return api.get<AboutResponse>("/about");
}

/* ------------------------------------------------------------------ */
/* 5. 商家                                                             */
/* ------------------------------------------------------------------ */

export async function getMerchant(): Promise<MerchantResponse> {
  const raw = await api.get<Record<string, unknown>>("/merchant");
  if (!raw || raw.registered !== true) return { registered: false, merchant: null };
  const source = isRecord(raw.merchant) ? raw.merchant : raw;
  const merchant: MerchantInfo = {
    userId: typeof source.userId === "string" ? source.userId : "",
    name: typeof source.name === "string" ? source.name : "",
    noteRequirement: typeof source.noteRequirement === "string" ? source.noteRequirement : "",
    channels: normalizeMerchantChannels(source.channels ?? raw.channels),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : undefined,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : undefined,
  };
  return { registered: true, merchant };
}

export async function getMerchantPublic(userId: string): Promise<MerchantPublic> {
  const raw = await api.get<Record<string, unknown>>(`/merchant/public/${encodeURIComponent(userId)}`);
  const merchant = isRecord(raw.merchant) ? raw.merchant : raw;
  const userValue = isRecord(raw.user) ? raw.user : isRecord(merchant.user) ? merchant.user : null;
  if (!userValue) {
    throw new ApiError(500, "MERCHANT_INVALID", "商家信息不完整，请稍后再试");
  }
  const productsValue = raw.products;
  const products = Array.isArray(productsValue) ? (productsValue as Product[]) : [];
  const channelsValue = Array.isArray(raw.channels) ? raw.channels : [];
  const channels = channelsValue.filter(
    (channel): channel is PayChannel => channel === "alipay" || channel === "wechat" || channel === "qq",
  );
  const name =
    (typeof raw.merchantName === "string" && raw.merchantName) ||
    (typeof merchant.name === "string" && merchant.name) ||
    (typeof userValue.displayName === "string" ? userValue.displayName : "商家");
  return {
    user: userValue as unknown as MerchantPublic["user"],
    merchantName: name,
    noteRequirement:
      typeof raw.noteRequirement === "string"
        ? raw.noteRequirement
        : typeof merchant.noteRequirement === "string"
          ? merchant.noteRequirement
          : "",
    products,
    channels,
  };
}

/** 商家注册（multipart：name、noteRequirement、channels JSON + 文件 qr_alipay/qr_wechat/qr_qq） */
export function registerMerchant(form: FormData): Promise<{ ok: boolean; merchant?: MerchantInfo }> {
  return api.upload<{ ok: boolean; merchant?: MerchantInfo }>("/merchant/register", form);
}

export function updateMerchant(payload: {
  name?: string;
  noteRequirement?: string;
}): Promise<{ ok: boolean }> {
  return api.patch<{ ok: boolean }>("/merchant", payload);
}

/** 重新上传某渠道收款码（multipart：qr 文件 + paymentPassword） */
export function uploadMerchantChannelQr(
  channel: PayChannel,
  form: FormData,
): Promise<{ ok: boolean }> {
  return api.upload<{ ok: boolean }>(`/merchant/channels/${channel}`, form);
}

export function setMerchantChannelEnabled(
  channel: PayChannel,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  return api.patch<{ ok: boolean }>(`/merchant/channels/${channel}`, { enabled });
}

export function getMerchantChannelQrBlob(channel: PayChannel): Promise<Blob> {
  return api.blob(`/merchant/channels/${channel}/qr`);
}

/** 扫描校园卡二维码后解析身份（付款人扫商家 / 商家扫客户） */
export function scanCard(cardContent: string): Promise<ScanCardResponse> {
  return api.post<ScanCardResponse>("/scan/card", { cardContent });
}

/* ------------------------------------------------------------------ */
/* 6. 商品                                                             */
/* ------------------------------------------------------------------ */

export async function listProducts(): Promise<Product[]> {
  const raw = await api.get<Product[] | { items?: Product[] }>("/merchant/products");
  if (Array.isArray(raw)) return raw;
  return Array.isArray(raw.items) ? raw.items : [];
}

export function createProduct(payload: {
  name: string;
  priceCents: number;
  description?: string;
  active?: boolean;
}): Promise<Product> {
  return api.post<Product>("/merchant/products", payload);
}

export function updateProduct(
  id: string,
  payload: Partial<{
    name: string;
    priceCents: number;
    description: string | null;
    active: boolean;
  }>,
): Promise<Product> {
  return api.patch<Product>(`/merchant/products/${id}`, payload);
}

export function deleteProduct(id: string): Promise<{ ok: boolean }> {
  return api.del<{ ok: boolean }>(`/merchant/products/${id}`);
}

export function sortProducts(ids: string[]): Promise<{ ok: boolean }> {
  return api.patch<{ ok: boolean }>("/merchant/products/sort", { ids });
}

/* ------------------------------------------------------------------ */
/* 7. 订单                                                             */
/* ------------------------------------------------------------------ */

export async function createOrder(payload: CreateOrderPayload): Promise<Order> {
  const raw = await api.post<unknown>("/orders", payload);
  return unwrapOrder(raw);
}

export async function merchantCreateOrder(payload: MerchantCreateOrderPayload): Promise<Order> {
  const raw = await api.post<unknown>("/orders/merchant-create", payload);
  return unwrapOrder(raw);
}

export function listOrders(query: {
  scope: "pay" | "receive";
  status: "pending" | "paid" | "closed" | "settled" | "all";
  page?: number;
  pageSize?: number;
}): Promise<OrderListResponse> {
  return api.get<OrderListResponse>("/orders", query);
}

export async function getOrder(id: string): Promise<OrderDetail> {
  const raw = await api.get<unknown>(`/orders/${encodeURIComponent(id)}`);
  return unwrapOrder(raw) as OrderDetail;
}

export function payOrder(id: string, payload: { channel: PayChannel; actualNote: string }): Promise<Order> {
  return api.post<Order>(`/orders/${encodeURIComponent(id)}/pay`, payload);
}

export function confirmOrder(id: string): Promise<Order> {
  return api.post<Order>(`/orders/${encodeURIComponent(id)}/confirm`);
}

export function markOrderNotReceived(id: string): Promise<Order> {
  return api.post<Order>(`/orders/${encodeURIComponent(id)}/not-received`);
}

export function cancelOrder(
  id: string,
  payload: { reason: "金额有误" | "已线下结清" | "对方未付款" | "其他"; note?: string },
): Promise<Order> {
  return api.post<Order>(`/orders/${encodeURIComponent(id)}/cancel`, payload);
}

export function appealOrder(id: string, reason: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>(`/orders/${encodeURIComponent(id)}/appeal`, { reason });
}

export function getOrderQrBlob(id: string, channel: PayChannel): Promise<Blob> {
  return api.blob(`/orders/${encodeURIComponent(id)}/qr`, { channel });
}

/* ------------------------------------------------------------------ */
/* 8. 动态码 / 收付款                                                   */
/* ------------------------------------------------------------------ */

export async function createDynamicCode(): Promise<DynamicCodeResponse> {
  const raw = await api.post<{
    token: string;
    expiresAt: string;
    expiresIn?: unknown;
    refreshAfter?: unknown;
    refreshIn?: unknown;
    qrContent?: unknown;
    prefix?: unknown;
  }>("/dynamic-code");
  const fallbackRefresh = secondsUntil(raw.expiresAt, 60) > 30 ? 30 : 15;
  return {
    token: raw.token,
    expiresAt: raw.expiresAt,
    refreshAfterSeconds: secondsUntil(raw.refreshAfter ?? raw.refreshIn ?? raw.expiresIn, fallbackRefresh),
    qrContent:
      typeof raw.qrContent === "string" && raw.qrContent.length > 0
        ? raw.qrContent
        : `gzspay:dynamic:${raw.token}`,
    prefix: typeof raw.prefix === "string" && raw.prefix.length > 0 ? raw.prefix : "gzspay:card:",
  };
}

export function resolveDynamicCode(token: string): Promise<DynamicCodeResolveResponse> {
  return api.get<DynamicCodeResolveResponse>(`/dynamic-code/${encodeURIComponent(token)}/resolve`);
}

/** 商家扫客户动态码发起收款请求（返回完整收款请求） */
export async function createPaymentRequest(payload: CreatePaymentRequestPayload): Promise<PaymentRequest> {
  const raw = await api.post<unknown>("/dynamic-code/request", payload);
  if (isRecord(raw) && isRecord(raw.request)) return raw.request as unknown as PaymentRequest;
  return raw as PaymentRequest;
}

export function getPaymentRequest(id: string): Promise<PaymentRequest> {
  return api.get<PaymentRequest>(`/dynamic-code/requests/${encodeURIComponent(id)}`);
}

/** 当前用户的待处理收款请求（进入页面时补拉一次，避免错过 SSE） */
export async function listPaymentRequests(): Promise<PaymentRequest[]> {
  const raw = await api.get<{ items?: PaymentRequest[] }>("/dynamic-code/requests");
  return Array.isArray(raw.items) ? raw.items : [];
}

/** 客户在手机上确认支付 → 生成订单并返回订单 id */
export async function acceptPaymentRequest(id: string, paymentPassword: string): Promise<{ orderId: string }> {
  const raw = await api.post<Record<string, unknown>>(
    `/dynamic-code/requests/${encodeURIComponent(id)}/accept`,
    { paymentPassword },
  );
  const orderId =
    typeof raw.orderId === "string"
      ? raw.orderId
      : isRecord(raw.order) && typeof raw.order.id === "string"
        ? raw.order.id
        : "";
  if (!orderId) throw new ApiError(500, "REQUEST_INVALID", "已确认收款，但未获取到订单号，请刷新订单列表查看");
  return { orderId };
}

export async function rejectPaymentRequest(id: string): Promise<void> {
  await api.post<unknown>(`/dynamic-code/requests/${encodeURIComponent(id)}/reject`);
}

/* ------------------------------------------------------------------ */
/* 9. SSE 实时推送                                                     */
/* ------------------------------------------------------------------ */

export interface EventStreamHandlers {
  onPaymentRequest?: (request: PaymentRequest) => void;
  onOrderUpdate?: (payload: { orderId: string; status?: OrderStatus }) => void;
  onOpen?: () => void;
  onError?: () => void;
}

function parseEventData(event: Event): unknown {
  if (!(event instanceof MessageEvent)) return null;
  if (typeof event.data !== "string" || !event.data) return null;
  try {
    return JSON.parse(event.data) as unknown;
  } catch {
    return null;
  }
}

/** 订阅服务端事件（payment_request / order_update），返回取消订阅函数 */
export function subscribeEvents(handlers: EventStreamHandlers): () => void {
  let closed = false;
  const source = openEventStream("/events/stream");

  source.addEventListener("open", () => {
    if (!closed) handlers.onOpen?.();
  });
  source.addEventListener("payment_request", (event) => {
    const data = parseEventData(event);
    if (!isRecord(data)) return;
    const candidate = isRecord(data.request) ? data.request : data;
    handlers.onPaymentRequest?.(candidate as unknown as PaymentRequest);
  });
  source.addEventListener("order_update", (event) => {
    const data = parseEventData(event);
    if (!isRecord(data)) return;
    const orderSource = isRecord(data.order) ? data.order : data;
    const orderId =
      typeof orderSource.orderId === "string"
        ? orderSource.orderId
        : typeof orderSource.id === "string"
          ? orderSource.id
          : null;
    if (!orderId) return;
    const statusValue = typeof orderSource.status === "string" ? orderSource.status : null;
    const status =
      statusValue === "pending_payment" ||
      statusValue === "paid" ||
      statusValue === "completed" ||
      statusValue === "cancelled"
        ? statusValue
        : undefined;
    handlers.onOrderUpdate?.({ orderId, status });
  });
  source.addEventListener("error", () => {
    if (!closed) handlers.onError?.();
  });

  return () => {
    closed = true;
    source.close();
  };
}

/* ------------------------------------------------------------------ */
/* 10. 统计                                                            */
/* ------------------------------------------------------------------ */

export interface StatsQuery {
  from: string;
  to: string;
  includePending?: boolean;
}

/** 统计查询转成请求层要求的 query 记录（避免接口索引签名报错） */
function statsParams(query: StatsQuery, granularity?: "day" | "month"): Record<string, string | boolean | undefined> {
  return {
    from: query.from,
    to: query.to,
    includePending: query.includePending,
    granularity,
  };
}

export function getStatsSummary(query: StatsQuery): Promise<StatsSummary> {
  return api.get<StatsSummary>("/stats/summary", statsParams(query));
}

export function getStatsTimeseries(
  query: StatsQuery & { granularity: "day" | "month" },
): Promise<StatsTimeseries> {
  return api.get<StatsTimeseries>("/stats/timeseries", statsParams(query, query.granularity));
}

export function exportStatsCsv(query: StatsQuery): Promise<Blob> {
  return api.blob("/stats/export", statsParams(query));
}

/* ------------------------------------------------------------------ */
/* 11. 公告                                                            */
/* ------------------------------------------------------------------ */

/** 公告列表（列表页 / 详情页 / 顶部红点共用，含当前用户未读数） */
export function getAnnouncements(): Promise<AnnouncementsResponse> {
  return api.get<AnnouncementsResponse>("/announcements");
}

/** 标记单条公告已读（幂等，重复调用不报错） */
export function markAnnouncementRead(id: string): Promise<AnnouncementReadResponse> {
  return api.post<AnnouncementReadResponse>(`/announcements/${encodeURIComponent(id)}/read`);
}
