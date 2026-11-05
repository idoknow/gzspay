/**
 * 管理后台 API 客户端。
 * 统一处理：X-Requested-With（CSRF）、鉴权失效回调、分页/字段容错解析、CSV 下载。
 * 路径均相对 /api（由 web/src/lib/http.ts 的 request 拼接）。
 */
import { ApiError, request } from "../lib/http";
import {
  formatMonthLabel,
  orderStatusLabel,
  payChannelLabel,
  trendLabel,
} from "./format";
import {
  arrayOf,
  firstArray,
  firstBoolean,
  firstNumber,
  firstText,
  isRecord,
  isoOrNull,
  nameOf,
  numberOr,
  pickPage,
  ratioToPercent,
  record,
  text,
  textOr,
} from "./normalize";
import type {
  AdminAppeal,
  AdminConfig,
  AdminConfigInput,
  AdminEntryVisitsPayload,
  AdminIdentity,
  AdminLog,
  AdminMember,
  AdminMerchant,
  AdminMerchantChannel,
  AdminMerchantProduct,
  AdminOrder,
  AdminOrderDetail,
  AdminQuery,
  AdminRole,
  AdminSession,
  AdminStats,
  AdminTicket,
  AdminTicketDetail,
  AdminTicketMessage,
  AdminPartiesReveal,
  AdminPartiesRevealStatus,
  AdminTicketParties,
  AdminTicketParty,
  AdminUser,
  AdminUserDetail,
  AdminUserLogin,
  AdminUserLoginsPayload,
  AmountBucket,
  Announcement,
  AnnouncementInput,
  AnnouncementLevel,
  AppealStatus,
  DailyBucket,
  FunnelStep,
  HourBucket,
  LogFilters,
  LogType,
  MailStatus,
  MerchantDetailPayload,
  MerchantStateFilter,
  MerchantSummary,
  MonthlyBucket,
  MonthlyData,
  OrderEvent,
  OrderFilters,
  OrderStatus,
  Overview,
  Page,
  PayChannel,
  PaymentMethodStat,
  SecurityConfig,
  ServiceHealth,
  ServiceStatus,
  SetupAdmin,
  SetupConfigInput,
  SetupCurrentUser,
  SetupFinishResult,
  SetupStatus,
  StatusCount,
  StorageStatus,
  SystemAlert,
  SystemAlerting,
  SystemStatus,
  TicketFilters,
  TodoItem,
  TrafficBreakdownItem,
  TrafficSeriesPoint,
  TrafficStats,
  TrendBucket,
  OnlineUser,
  OnlineUsersPayload,
  UserDetailPayload,
} from "./types";

/* ------------------------------------------------------------------ 工单 */

function mapTicketMessage(raw: unknown): AdminTicketMessage {
  const source = record(raw);
  return {
    id: textOr(source.id, ""),
    ticketId: textOr(source.ticketId, ""),
    senderId: textOr(source.senderId, ""),
    senderRole: (textOr(source.senderRole, "payer") as AdminTicketMessage["senderRole"]),
    senderName: textOr(source.senderName, "未知用户"),
    senderAvatarUrl: textOr(source.senderAvatarUrl, "") || null,
    body: textOr(source.body, ""),
    createdAt: textOr(source.createdAt, ""),
  };
}

function mapParty(raw: unknown): AdminTicketParty {
  const source = record(raw);
  return {
    id: textOr(source.id, ""),
    role: textOr(source.role, "payer") === "merchant" ? "merchant" : "payer",
    displayName: textOr(source.displayName, "未知用户"),
    studentNo: text(source.studentNo),
    qq: text(source.qq),
    email: text(source.email),
    avatarUrl: text(source.avatarUrl),
  };
}

function mapParties(raw: unknown): AdminTicketParties {
  const source = record(raw);
  return {
    payer: mapParty(source.payer),
    merchant: mapParty(source.merchant),
  };
}

function mapRevealStatus(value: unknown): AdminPartiesRevealStatus {
  const raw = text(value);
  return raw === "pending" || raw === "approved" || raw === "rejected" ? raw : "hidden";
}

/** 双方资料披露申请信息（后台详情页展示与审核用） */
function mapPartiesReveal(raw: unknown): AdminPartiesReveal {
  const source = record(raw);
  return {
    status: mapRevealStatus(source.status),
    requestedByMe: firstBoolean(source, ["requestedByMe"]) ?? false,
    requestedAt: isoOrNull(source.requestedAt),
    note: text(source.note),
    revealedAt: isoOrNull(source.revealedAt),
  };
}

function mapTicket(raw: unknown): AdminTicket {
  const source = record(raw);
  return {
    id: textOr(source.id, ""),
    orderId: textOr(source.orderId, ""),
    orderNo: textOr(source.orderNo, ""),
    orderTitle: textOr(source.orderTitle, "未命名交易"),
    amountCents: numberOr(source.amountCents, 0),
    category: textOr(source.category, ""),
    categoryLabel: textOr(source.categoryLabel, "其他问题"),
    status: textOr(source.status, "open") === "closed" ? "closed" : "open",
    openerName: textOr(source.openerName, "未知用户"),
    payerName: textOr(source.payerName, "付款人"),
    merchantName: textOr(source.merchantName, "商家"),
    createdAt: textOr(source.createdAt, ""),
    lastMessageAt: textOr(source.lastMessageAt, ""),
    messageCount: numberOr(source.messageCount, 0),
    partiesRevealStatus: mapRevealStatus(source.partiesRevealStatus),
  };
}

/** GET /admin/tickets?status&keyword&page&pageSize（只读） */
export async function getAdminTickets(
  filters: TicketFilters,
  page: number,
  pageSize: number,
): Promise<Page<AdminTicket>> {
  const payload = await getJson<unknown>("/admin/tickets", {
    status: filters.status !== "all" ? filters.status : undefined,
    keyword: filters.keyword.trim() || undefined,
    page,
    pageSize,
  });
  return mapPage(payload, mapTicket);
}

/** 把后台返回的工单详情（可能是 `{ ticket }` 包装）映射成 AdminTicketDetail */
function mapTicketDetail(payload: unknown): AdminTicketDetail {
  const rawPayload = record(payload);
  const source = isRecord(rawPayload.ticket) ? rawPayload.ticket : rawPayload;
  return {
    ...mapTicket(source),
    parties: mapParties(source.parties),
    partiesReveal: mapPartiesReveal(source.partiesReveal),
    messages: firstArray(source, ["messages"]).map(mapTicketMessage),
    closedAt: isoOrNull(source.closedAt),
    closedReason: (text(source.closedReason) as AdminTicketDetail["closedReason"]) ?? null,
    resolutionNote: text(source.resolutionNote),
  };
}

/** GET /admin/tickets/:id（含完整对话与双方资料） */
export async function getAdminTicket(id: string): Promise<AdminTicketDetail> {
  const payload = await getJson<unknown>(`/admin/tickets/${encodeURIComponent(id)}`);
  return mapTicketDetail(payload);
}

/** POST /admin/tickets/:id/messages：运营（super / ops）以平台客服身份介入沟通 */
export async function sendAdminTicketMessage(id: string, body: string): Promise<AdminTicketDetail> {
  const payload = await writeJson<unknown>("POST", `/admin/tickets/${encodeURIComponent(id)}/messages`, {
    body,
  });
  return mapTicketDetail(payload);
}

/** POST /admin/tickets/:id/close：运营结束工单，可附处理说明 */
export async function closeAdminTicket(id: string, note?: string | null): Promise<AdminTicketDetail> {
  const payload = await writeJson<unknown>("POST", `/admin/tickets/${encodeURIComponent(id)}/close`, {
    note: note?.trim() || null,
  });
  return mapTicketDetail(payload);
}

/** POST /admin/tickets/:id/reveal：审批双方的资料披露申请（批准后才向双方展示完整资料） */
export async function reviewTicketReveal(
  id: string,
  decision: "approve" | "reject",
  note?: string | null,
): Promise<AdminTicketDetail> {
  const payload = await writeJson<unknown>("POST", `/admin/tickets/${encodeURIComponent(id)}/reveal`, {
    decision,
    note: note?.trim() || null,
  });
  return mapTicketDetail(payload);
}

/* ------------------------------------------------------------ 基础请求层 */

const CSRF_HEADERS: Record<string, string> = { "X-Requested-With": "gzspay" };

/** 鉴权失效原因：未登录 / 非管理员 / 系统尚未初始化 */
export type AuthInvalidReason = "anonymous" | "not_admin" | "not_initialized";

let authInvalidHandler: ((reason: AuthInvalidReason) => void) | null = null;

/** 注册鉴权失效回调（UNAUTHENTICATED / NOT_ADMIN / SYSTEM_NOT_INITIALIZED），由 AdminApp 在挂载时注入 */
export function setAuthInvalidHandler(
  handler: ((reason: AuthInvalidReason) => void) | null,
): void {
  authInvalidHandler = handler;
}

/** 把接口错误映射为鉴权失效原因；与鉴权无关时返回 null */
function authReasonOf(error: unknown): AuthInvalidReason | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "SYSTEM_NOT_INITIALIZED") return "not_initialized";
  if (error.code === "NOT_ADMIN") return "not_admin";
  if (error.code === "UNAUTHENTICATED" || error.status === 401) return "anonymous";
  return null;
}

function notifyAuthInvalid(error: unknown): void {
  const reason = authReasonOf(error);
  if (reason) authInvalidHandler?.(reason);
}

async function getJson<T>(
  path: string,
  query?: AdminQuery,
  notify = true,
): Promise<T> {
  try {
    return await request<T>(path, { query, headers: CSRF_HEADERS });
  } catch (error) {
    if (notify) notifyAuthInvalid(error);
    throw error;
  }
}

type WriteMethod = "POST" | "PATCH" | "PUT" | "DELETE";

async function writeJson<T>(
  method: WriteMethod,
  path: string,
  body?: unknown,
  notify = true,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  try {
    return await request<T>(path, {
      method,
      body,
      headers: { ...CSRF_HEADERS, ...(extraHeaders ?? {}) },
    });
  } catch (error) {
    if (notify) notifyAuthInvalid(error);
    throw error;
  }
}

async function postAction(path: string, body?: unknown): Promise<void> {
  await writeJson<unknown>("POST", path, body);
}

/* ------------------------------------------------------------ 基础映射器 */

function mapRole(value: unknown): AdminRole {
  const role = text(value);
  if (role === "super" || role === "ops" || role === "auditor") return role;
  return "auditor";
}

function mapAdminIdentity(raw: unknown): AdminIdentity {
  const source = record(raw);
  return {
    id: textOr(
      firstText(source, ["id", "adminId", "userId"]),
      "unknown",
    ),
    displayName: textOr(
      firstText(source, ["displayName", "name", "fullName"]),
      "管理员",
    ),
    avatarUrl: firstText(source, ["avatarUrl", "avatar"]),
    email: firstText(source, ["email"]),
    emailMasked: firstText(source, ["emailMasked", "email"]),
    role: mapRole(firstText(source, ["role"])),
    createdAt: isoOrNull(firstText(source, ["createdAt", "joinedAt"])),
  };
}

function mapSessionPayload(payload: unknown): AdminSession {
  const source = record(payload);
  const adminSource = isRecord(source.admin) ? source.admin : null;
  const identity = adminSource ? mapAdminIdentity(adminSource) : null;
  const authenticated =
    (firstBoolean(source, ["authenticated", "loggedIn"]) ?? false) &&
    identity !== null;
  return {
    authenticated,
    initialized: firstBoolean(source, ["initialized"]) ?? undefined,
    admin: authenticated ? identity : null,
    emailMasked:
      firstText(source, ["emailMasked", "email"]) ?? identity?.emailMasked ?? null,
  };
}

function mapTone(
  value: string | null,
  fallback: "primary" | "success" | "warning" | "danger" | "neutral" = "primary",
): "primary" | "success" | "warning" | "danger" | "neutral" | "accent" {
  switch ((value ?? "").toLowerCase()) {
    case "success":
    case "ok":
    case "up":
      return "success";
    case "warn":
    case "warning":
    case "degraded":
      return "warning";
    case "danger":
    case "error":
    case "critical":
    case "down":
      return "danger";
    case "info":
    case "primary":
      return "primary";
    case "accent":
    case "todo":
      return "accent";
    case "neutral":
      return "neutral";
    default:
      return fallback;
  }
}

/* ------------------------------------------------------------------ 认证 */

/** 发起校园墙登录的地址（整页跳转，不走 fetch；后端 302 到主站登录） */
export const ADMIN_LOGIN_URL = "/api/admin/auth/login";

/** 会话探测结果：session 为映射后的会话，reason 说明为何进不了后台 */
export interface AdminSessionResult {
  session: AdminSession;
  reason: AuthInvalidReason | null;
}

/**
 * GET /admin/auth/session
 * 复用主站会话 Cookie：200 → 已登录管理员；401 按 error.code 区分未登录 / 非管理员 / 未初始化。
 */
export async function getAdminSession(): Promise<AdminSessionResult> {
  try {
    const payload = await getJson<unknown>("/admin/auth/session", undefined, false);
    return { session: mapSessionPayload(payload), reason: null };
  } catch (error) {
    const reason = authReasonOf(error);
    if (reason) {
      return {
        session: {
          authenticated: false,
          initialized: false,
          admin: null,
          emailMasked: null,
        },
        reason,
      };
    }
    throw error;
  }
}

/** POST /admin/auth/logout */
export async function logoutAdmin(): Promise<void> {
  await postAction("/admin/auth/logout");
}

/* ------------------------------------------------------------------ 初始化 */

function mapSetupCurrentUser(raw: unknown): SetupCurrentUser | null {
  if (!isRecord(raw)) return null;
  const id = firstText(raw, ["id", "userId"]);
  if (!id) return null;
  return {
    id,
    displayName: textOr(firstText(raw, ["displayName", "name"]), "校园墙用户"),
    avatarUrl: firstText(raw, ["avatarUrl", "avatar"]),
  };
}

function mapSetupStatus(payload: unknown): SetupStatus {
  const source = record(payload);
  const system = record(source.system);
  const campux = record(source.campux);
  const mail = record(source.mail);
  return {
    initialized: firstBoolean(source, ["initialized"]) ?? false,
    campuxConfigured: firstBoolean(source, ["campuxConfigured"]) ?? false,
    mailConfigured: firstBoolean(source, ["mailConfigured"]) ?? false,
    adminCount: numberOr(firstNumber(source, ["adminCount"]), 0),
    currentUser: mapSetupCurrentUser(source.currentUser),
    setupTokenRequired: firstBoolean(source, ["setupTokenRequired", "requiresSetupToken"]) ?? false,
    system: {
      siteName: textOr(
        firstText(system, ["siteName", "name"]),
        "gzspay 校园服务",
      ),
      schoolName: textOr(firstText(system, ["schoolName"]), ""),
      publicBaseUrl: textOr(firstText(system, ["publicBaseUrl", "baseUrl"]), ""),
      icp: textOr(firstText(system, ["icp", "icpNumber", "beian"]), ""),
    },
    campux: {
      baseUrl: textOr(firstText(campux, ["baseUrl"]), ""),
      clientId: textOr(firstText(campux, ["clientId"]), ""),
      clientSecretConfigured:
        firstBoolean(campux, ["clientSecretConfigured", "secretConfigured"]) ??
        false,
      scope: textOr(firstText(campux, ["scope"]), "profile"),
    },
    mail: {
      provider: mapMailProvider(mail),
      host: textOr(firstText(mail, ["host"]), ""),
      port: numberOr(firstNumber(mail, ["port"]), 465),
      secure: firstBoolean(mail, ["secure", "ssl"]) ?? true,
      username: textOr(firstText(mail, ["username", "user"]), ""),
      passwordConfigured:
        firstBoolean(mail, ["passwordConfigured", "passwordSet"]) ?? false,
      fromName: textOr(firstText(mail, ["fromName"]), "gzspay"),
      fromAddress: textOr(firstText(mail, ["fromAddress", "from"]), ""),
    },
  };
}

function mapSetupAdmin(raw: unknown): SetupAdmin {
  const source = record(raw);
  return {
    id: textOr(firstText(source, ["id", "userId"]), "unknown"),
    displayName: textOr(firstText(source, ["displayName", "name"]), "管理员"),
    role: mapRole(firstText(source, ["role"])),
  };
}

/** 发件通道：resend（环境变量）/ smtp / none */
function mapMailProvider(source: Record<string, unknown>): "resend" | "smtp" | "none" {
  const provider = firstText(source, ["provider", "mailProvider", "transport"]);
  if (provider === "resend") return "resend";
  if (provider === "smtp") return "smtp";
  return "none";
}

/** GET /setup/status —— 系统初始化状态（无需登录） */
export async function getSetupStatus(): Promise<SetupStatus> {
  const payload = await getJson<unknown>("/setup/status", undefined, false);
  return mapSetupStatus(payload);
}

/**
 * POST /setup/config —— 保存初始化步骤配置。
 * 允许分步提交：只传当前步骤的字段；clientSecret / password 传空串表示保留旧值。
 * 首次初始化必须带上服务端启动日志里的「初始化令牌」。
 */
export async function saveSetupConfig(
  input: SetupConfigInput,
  setupToken = "",
): Promise<SetupStatus> {
  const payload = await writeJson<unknown>(
    "POST",
    "/setup/config",
    input,
    false,
    setupToken ? { "x-setup-token": setupToken } : undefined,
  );
  const source = record(payload);
  return mapSetupStatus(source.status ?? payload);
}

/** POST /setup/token —— 校验一次性初始化令牌（首次部署时防抢注） */
export async function verifySetupToken(token: string): Promise<SetupStatus> {
  const payload = await writeJson<unknown>("POST", "/setup/token", { token }, false);
  const source = record(payload);
  return mapSetupStatus(source.status ?? payload);
}

/** POST /setup/finish —— 完成初始化，当前主站登录账号成为超级管理员 */
export async function finishSetup(): Promise<SetupFinishResult> {
  const payload = await writeJson<unknown>(
    "POST",
    "/setup/finish",
    undefined,
    false,
  );
  const source = record(payload);
  return {
    admin: isRecord(source.admin) ? mapSetupAdmin(source.admin) : null,
  };
}

/* ------------------------------------------------------------------ 总览 */

function mapAmountCents(source: Record<string, unknown>, keys: string[]): number {
  return numberOr(firstNumber(source, keys), 0);
}

function mapTrendBucket(raw: unknown, index: number): TrendBucket {
  const source = record(raw);
  const key =
    firstText(source, ["key", "month", "date", "bucket", "label"]) ??
    `bucket-${index}`;
  const label = firstText(source, ["label"]) ?? trendLabel(key);
  return {
    key,
    label,
    amountCents: mapAmountCents(source, [
      "amountCents",
      "amount",
      "totalCents",
      "totalAmountCents",
      "value",
    ]),
    orderCount: numberOr(
      firstNumber(source, ["orderCount", "count", "orders", "orderNum"]),
      0,
    ),
  };
}

function mapTrendList(raw: unknown[]): TrendBucket[] {
  return raw.map(mapTrendBucket);
}

function mapTodo(raw: unknown, index: number): TodoItem {
  const source = record(raw);
  return {
    id: textOr(firstText(source, ["id"]), `todo-${index}`),
    title: textOr(
      firstText(source, ["title", "name", "label", "message"]),
      "待处理事项",
    ),
    detail: firstText(source, ["detail", "description", "desc"]),
    level: mapTone(firstText(source, ["level", "tone", "type", "severity"])),
    createdAt: isoOrNull(firstText(source, ["createdAt", "time"])),
  };
}

/** GET /admin/overview */
export async function getOverview(): Promise<Overview> {
  const payload = await getJson<unknown>("/admin/overview");
  const source = record(payload);
  const nested = record(source.metrics ?? source.summary ?? source.cards);
  const metric = (keys: string[]): number => {
    const direct = firstNumber(source, keys);
    if (direct !== null) return direct;
    const deep = firstNumber(nested, keys);
    return deep ?? 0;
  };
  return {
    totalAmountCents: metric([
      "totalAmountCents",
      "totalTransactionCents",
      "totalCents",
      "totalAmount",
    ]),
    monthAmountCents: metric([
      "monthAmountCents",
      "currentMonthAmountCents",
      "monthCents",
      "monthlyAmountCents",
    ]),
    todayOrderCount: metric([
      "todayOrderCount",
      "todayOrders",
      "todayOrderNum",
      "ordersToday",
    ]),
    userCount: metric(["userCount", "users", "totalUsers", "userTotal"]),
    merchantCount: metric([
      "merchantCount",
      "merchants",
      "totalMerchants",
      "merchantTotal",
    ]),
    trend: mapTrendList(
      firstArray(source, ["trend", "trends", "monthlyTrend", "months", "buckets"]),
    ),
    recentOrders: firstArray(source, [
      "recentOrders",
      "latestOrders",
      "orders",
    ]).map(mapOrder),
    todos: firstArray(source, ["todos", "pendingItems", "todoList", "alerts"]).map(
      mapTodo,
    ),
  };
}

/* -------------------------------------------------------------- 每月交易额 */

function mapDailyBucket(
  raw: unknown,
  index: number,
  fallbackMonth: string,
): DailyBucket {
  const source = record(raw);
  const key =
    firstText(source, ["key", "date", "day", "label"]) ??
    `${fallbackMonth}-${String(index + 1).padStart(2, "0")}`;
  const label = firstText(source, ["label"]) ?? trendLabel(key);
  return {
    key,
    label,
    amountCents: mapAmountCents(source, [
      "amountCents",
      "amount",
      "totalCents",
      "value",
    ]),
    orderCount: numberOr(
      firstNumber(source, ["orderCount", "count", "orders"]),
      0,
    ),
  };
}

function mapMonthlyBucket(
  raw: unknown,
  index: number,
  year: number,
): MonthlyBucket {
  const monthKey = `${year}-${String(index + 1).padStart(2, "0")}`;
  const dailySource = firstArray(record(raw), [
    "days",
    "daily",
    "dailyTrend",
    "buckets",
    "daysTrend",
  ]);
  const base = mapDailyBucket(raw, index, String(year));
  const key = /^\d{4}-\d{2}$/.test(base.key) ? base.key : monthKey;
  return {
    ...base,
    key,
    label: formatMonthLabel(key),
    days: dailySource.map((item, dayIndex) =>
      mapDailyBucket(item, dayIndex, key),
    ),
  };
}

/** GET /admin/monthly?year=2026 */
export async function getMonthly(year: number): Promise<MonthlyData> {
  const payload = await getJson<unknown>("/admin/monthly", { year });
  const source = record(payload);
  const monthsRaw = firstArray(source, ["months", "items", "buckets", "data"]);
  return {
    year: numberOr(firstNumber(source, ["year"]), year),
    months: monthsRaw.map((row, index) => mapMonthlyBucket(row, index, year)),
  };
}

/**
 * 兜底按月份拉取每日趋势：GET /admin/monthly?year=2026&month=01
 * 仅当总体响应中某月的 days 为空时调用。
 */
export async function getMonthlyDays(
  year: number,
  monthKey: string,
): Promise<DailyBucket[]> {
  const month = monthKey.length >= 7 ? monthKey.slice(5, 7) : monthKey;
  const payload = await getJson<unknown>("/admin/monthly", { year, month });
  if (Array.isArray(payload)) {
    return payload.map((row, index) =>
      mapDailyBucket(row, index, monthKey),
    );
  }
  const source = record(payload);
  const yearPrefix = monthKey.slice(0, 4) || String(year);
  const fallbackMonth = `${yearPrefix}-${month}`;
  return firstArray(source, ["days", "buckets", "items", "data", "daily"]).map(
    (row, index) => mapDailyBucket(row, index, fallbackMonth),
  );
}

/* ---------------------------------------------------------------- 用户管理 */

function mapUser(raw: unknown): AdminUser {
  const source = record(raw);
  const frozenRaw =
    firstBoolean(source, ["frozen", "isFrozen", "locked", "isLocked"]) ?? false;
  const statusText = text(firstText(source, ["status", "state"]));
  return {
    id: textOr(firstText(source, ["id", "userId"]), ""),
    displayName: textOr(
      firstText(source, ["displayName", "name", "fullName"]),
      "未知用户",
    ),
    avatarUrl: firstText(source, ["avatarUrl", "avatar"]),
    studentNo: firstText(source, ["studentNo"]),
    email: firstText(source, ["email"]),
    studentNoMasked: firstText(source, ["studentNoMasked", "studentNo"]),
    emailMasked: firstText(source, ["emailMasked", "email"]),
    isMerchant:
      firstBoolean(source, ["isMerchant", "merchant"]) ?? false,
    frozen:
      frozenRaw || statusText === "frozen" || statusText === "locked",
    createdAt: isoOrNull(firstText(source, ["createdAt", "registeredAt"])),
    orderCount: numberOr(
      firstNumber(source, ["orderCount", "orders", "orderTotal"]),
      0,
    ),
    totalAmountCents: mapAmountCents(source, [
      "totalAmountCents",
      "totalCents",
      "totalAmount",
    ]),
  };
}

function mapUserDetail(raw: unknown): AdminUserDetail {
  const user = mapUser(raw);
  const source = record(raw);
  return {
    ...user,
    studentNo: firstText(source, ["studentNo"]),
    email: firstText(source, ["email"]),
    cardNo: firstText(source, ["cardNo"]),
    cardNoMasked: firstText(source, ["cardNoMasked", "cardNo"]),
    lastLoginAt: isoOrNull(
      firstText(source, ["lastLoginAt", "lastLogin", "lastSeenAt"]),
    ),
    frozenReason: firstText(source, ["frozenReason", "lockReason", "freezeReason"]),
  };
}

function mapPage<T>(payload: unknown, mapper: (raw: unknown, index: number) => T): Page<T> {
  const rawPage = pickPage(payload);
  return {
    items: rawPage.rows.map(mapper),
    total: rawPage.total,
    page: rawPage.page,
    pageSize: rawPage.pageSize,
  };
}

/** GET /admin/users?query&page&pageSize */
export async function getUsers(
  query: string,
  page: number,
  pageSize: number,
): Promise<Page<AdminUser>> {
  const payload = await getJson<unknown>("/admin/users", {
    query: query.trim() || undefined,
    page,
    pageSize,
  });
  return mapPage(payload, mapUser);
}

/** GET /admin/users/:id */
export async function getUserDetail(id: string): Promise<UserDetailPayload> {
  const payload = await getJson<unknown>(`/admin/users/${encodeURIComponent(id)}`);
  const source = record(payload);
  const user = mapUserDetail(isRecord(source.user) ? source.user : source);
  const recentOrders = firstArray(source, ["recentOrders", "orders", "recent"]).map(
    mapOrder,
  );
  return {
    user,
    orderCount:
      numberOr(
        firstNumber(source, ["orderCount", "orders", "orderTotal"]),
        recentOrders.length,
      ) || user.orderCount,
    totalAmountCents:
      firstNumber(source, ["totalAmountCents", "totalCents", "totalAmount"]) ??
      user.totalAmountCents,
    recentOrders,
  };
}

/** POST /admin/users/:id/freeze —— 冻结用户 */
export async function freezeUser(id: string): Promise<void> {
  await postAction(`/admin/users/${encodeURIComponent(id)}/freeze`);
}

/** POST /admin/users/:id/unfreeze —— 解冻用户 */
export async function unfreezeUser(id: string): Promise<void> {
  await postAction(`/admin/users/${encodeURIComponent(id)}/unfreeze`);
}

/** POST /admin/users/:id/reset-card —— 重置绑卡（需用户重新绑卡） */
export async function resetUserCard(id: string): Promise<void> {
  await postAction(`/admin/users/${encodeURIComponent(id)}/reset-card`);
}

/** POST /admin/users/:id/force-logout —— 强制下线 */
export async function forceLogoutUser(id: string): Promise<void> {
  await postAction(`/admin/users/${encodeURIComponent(id)}/force-logout`);
}

/** GET /admin/users/growth?months=12 */
export async function getUsersGrowth(months = 12): Promise<TrendBucket[]> {  const payload = await getJson<unknown>("/admin/users/growth", { months });
  const source = record(payload);
  const buckets = firstArray(source, ["buckets", "months", "items", "data", "trend"]);
  return buckets.map((raw, index) => {
    const item = record(raw);
    const key =
      firstText(item, ["key", "month", "date", "label"]) ?? `bucket-${index}`;
    return {
      key,
      label: firstText(item, ["label"]) ?? trendLabel(key),
      amountCents: 0,
      orderCount: numberOr(
        firstNumber(item, ["count", "value", "newUsers", "users", "total"]),
        0,
      ),
    };
  });
}

/** GET /admin/users/online —— 当前在线用户（会话未过期且最近有请求） */
export async function getOnlineUsers(): Promise<OnlineUsersPayload> {
  const payload = await getJson<unknown>("/admin/users/online");
  const source = record(payload);
  const items = firstArray(source, ["items", "users", "online", "data"]).map(
    (raw): OnlineUser => {
      const item = record(raw);
      return {
        id: textOr(firstText(item, ["id", "userId"]), ""),
        displayName: textOr(
          firstText(item, ["displayName", "name", "fullName"]),
          "未知用户",
        ),
        avatarUrl: firstText(item, ["avatarUrl", "avatar"]),
        studentNo: firstText(item, ["studentNo"]),
        studentNoMasked: firstText(item, ["studentNoMasked", "studentNo"]),
        isMerchant: firstBoolean(item, ["isMerchant", "merchant"]) ?? false,
        ip: firstText(item, ["ip", "lastIp"]),
        userAgent: firstText(item, ["userAgent", "agent"]),
        lastSeenAt:
          isoOrNull(firstText(item, ["lastSeenAt", "lastActiveAt", "lastSeen"])) ??
          new Date().toISOString(),
        sessionCount: numberOr(firstNumber(item, ["sessionCount", "sessions"]), 1),
      };
    },
  );
  return {
    items,
    total: numberOr(firstNumber(source, ["total", "count"]), items.length),
    onlineWindowMinutes: numberOr(
      firstNumber(source, ["onlineWindowMinutes", "windowMinutes"]),
      5,
    ),
  };
}

/** 授权登录成功的人数与最近登录的用户（按最近登录时间倒序） */
export async function getUserLogins(limit = 8): Promise<AdminUserLoginsPayload> {
  const payload = await getJson<unknown>("/admin/users/logins", { limit });
  const source = record(payload);
  const recent = firstArray(source, ["recent", "items", "users", "logins", "data"]).map(
    (raw): AdminUserLogin => {
      const item = record(raw);
      return {
        id: textOr(firstText(item, ["id", "userId"]), ""),
        displayName: textOr(
          firstText(item, ["displayName", "name", "fullName"]),
          "未知用户",
        ),
        avatarUrl: firstText(item, ["avatarUrl", "avatar"]),
        studentNo: firstText(item, ["studentNo"]),
        studentNoMasked: firstText(item, ["studentNoMasked", "studentNo"]),
        isMerchant: firstBoolean(item, ["isMerchant", "merchant"]) ?? false,
        lastLoginAt: textOr(firstText(item, ["lastLoginAt", "lastSeenAt"]), ""),
      };
    },
  );
  return {
    total: numberOr(firstNumber(source, ["total", "count"]), recent.length),
    recent,
  };
}

/* --------------------------------------------------------------- 商家管理 */

const MERCHANT_CHANNEL_LABELS: Record<string, string> = {
  alipay: "支付宝",
  wechat: "微信支付",
  qq: "QQ 钱包",
};

function mapMerchantChannel(raw: unknown): AdminMerchantChannel {
  const source = record(raw);
  const channelText = firstText(source, ["channel"]);
  const channel =
    channelText === "alipay" || channelText === "wechat" || channelText === "qq"
      ? channelText
      : "alipay";
  return {
    channel,
    label: textOr(
      firstText(source, ["label"]),
      MERCHANT_CHANNEL_LABELS[channel] ?? "收款方式",
    ),
    enabled: firstBoolean(source, ["enabled", "active"]) ?? false,
    hasQr: firstBoolean(source, ["hasQr", "hasQR", "qrReady"]) ?? false,
    alipayPid: textOr(firstText(source, ["alipayPid", "payUid"]), ""),
    updatedAt: isoOrNull(firstText(source, ["updatedAt"])),
  };
}

function mapMerchant(raw: unknown): AdminMerchant {
  const source = record(raw);
  const channels = firstArray(source, ["channels"]).map(mapMerchantChannel);
  return {
    userId: textOr(firstText(source, ["userId", "id"]), ""),
    merchantName: textOr(
      firstText(source, ["merchantName", "name", "shopName"]),
      "未命名商家",
    ),
    displayName: textOr(
      firstText(source, ["displayName", "ownerName", "fullName"]),
      "未知用户",
    ),
    avatarUrl: firstText(source, ["avatarUrl", "avatar"]),
    studentNo: firstText(source, ["studentNo"]),
    studentNoMasked: firstText(source, ["studentNoMasked", "studentNo"]),
    noteRequirement: textOr(firstText(source, ["noteRequirement"]), ""),
    channels,
    enabledChannelCount: numberOr(
      firstNumber(source, ["enabledChannelCount"]),
      channels.filter((item) => item.enabled && item.hasQr).length,
    ),
    productCount: numberOr(firstNumber(source, ["productCount", "products"]), 0),
    activeProductCount: numberOr(firstNumber(source, ["activeProductCount"]), 0),
    orderCount: numberOr(firstNumber(source, ["orderCount", "orders"]), 0),
    completedAmountCents: numberOr(
      firstNumber(source, ["completedAmountCents", "totalAmountCents"]),
      0,
    ),
    lastOrderAt: isoOrNull(firstText(source, ["lastOrderAt", "lastOrder"])),
    suspended: firstBoolean(source, ["suspended"]) ?? channels.every((item) => !item.enabled),
    frozen: firstBoolean(source, ["frozen"]) ?? false,
    createdAt: textOr(firstText(source, ["createdAt"]), ""),
  };
}

function mapMerchantProduct(raw: unknown): AdminMerchantProduct {
  const source = record(raw);
  return {
    id: textOr(firstText(source, ["id", "productId"]), ""),
    name: textOr(firstText(source, ["name", "title"]), "未命名商品"),
    priceCents: numberOr(firstNumber(source, ["priceCents", "price"]), 0),
    description: textOr(firstText(source, ["description"]), ""),
    active: firstBoolean(source, ["active", "enabled"]) ?? false,
    sortOrder: numberOr(firstNumber(source, ["sortOrder", "sort"]), 0),
    createdAt: textOr(firstText(source, ["createdAt"]), ""),
  };
}

function mapMerchantDetail(payload: unknown): MerchantDetailPayload {
  const source = record(payload);
  const merchantSource = isRecord(source.merchant) ? source.merchant : payload;
  return {
    merchant: mapMerchant(merchantSource),
    products: firstArray(source, ["products", "items"]).map(mapMerchantProduct),
    recentOrders: firstArray(source, ["recentOrders", "orders"]).map(mapOrder),
  };
}

/** GET /admin/merchants?query&state&page&pageSize */
export async function getMerchants(
  query: string,
  state: MerchantStateFilter,
  page: number,
  pageSize: number,
): Promise<Page<AdminMerchant>> {
  const payload = await getJson<unknown>("/admin/merchants", {
    query: query.trim() || undefined,
    state: state === "all" ? undefined : state,
    page,
    pageSize,
  });
  return mapPage(payload, mapMerchant);
}

/** GET /admin/merchants/summary */
export async function getMerchantSummary(): Promise<MerchantSummary> {
  const payload = await getJson<unknown>("/admin/merchants/summary");
  const source = record(payload);
  return {
    total: numberOr(firstNumber(source, ["total"]), 0),
    ready: numberOr(firstNumber(source, ["ready"]), 0),
    suspended: numberOr(firstNumber(source, ["suspended"]), 0),
    newThisMonth: numberOr(firstNumber(source, ["newThisMonth"]), 0),
  };
}

/** GET /admin/merchants/:userId */
export async function getMerchantDetail(userId: string): Promise<MerchantDetailPayload> {
  const payload = await getJson<unknown>(
    `/admin/merchants/${encodeURIComponent(userId)}`,
  );
  return mapMerchantDetail(payload);
}

/** POST /admin/merchants/:userId/channels —— 启用/停用某个收款方式 */
export async function setMerchantChannel(
  userId: string,
  channel: string,
  enabled: boolean,
): Promise<MerchantDetailPayload> {
  const payload = await writeJson<unknown>(
    "POST",
    `/admin/merchants/${encodeURIComponent(userId)}/channels`,
    { channel, enabled },
  );
  return mapMerchantDetail(payload);
}

/** POST /admin/merchants/:userId/channels/:channel/pay-uid —— 设置/清空支付宝收款 PID */
export async function setMerchantPayUid(
  userId: string,
  channel: "alipay",
  payUid: string,
): Promise<MerchantDetailPayload> {
  const payload = await writeJson<unknown>(
    "POST",
    `/admin/merchants/${encodeURIComponent(userId)}/channels/${channel}/pay-uid`,
    { payUid },
  );
  return mapMerchantDetail(payload);
}

/** POST /admin/merchants/:userId/receiving —— 暂停/恢复商家收款 */
export async function setMerchantReceiving(
  userId: string,
  enabled: boolean,
): Promise<MerchantDetailPayload> {
  const payload = await writeJson<unknown>(
    "POST",
    `/admin/merchants/${encodeURIComponent(userId)}/receiving`,
    { enabled },
  );
  return mapMerchantDetail(payload);
}

/* --------------------------------------------------------------- 管理员管理 */
function mapAdminMember(raw: unknown): AdminMember {
  const source = record(raw);
  const userId = firstText(source, ["userId", "id", "adminUserId"]);
  return {
    id: textOr(firstText(source, ["id", "adminId"]), userId ?? ""),
    userId: textOr(userId, ""),
    displayName: textOr(
      firstText(source, ["displayName", "name", "fullName"]),
      "管理员",
    ),
    avatarUrl: firstText(source, ["avatarUrl", "avatar"]),
    email: firstText(source, ["email"]),
    emailMasked: firstText(source, ["emailMasked", "email"]),
    role: mapRole(firstText(source, ["role"])),
    createdAt: isoOrNull(firstText(source, ["createdAt", "joinedAt"])),
  };
}

/** GET /admin/admins */
export async function getAdmins(): Promise<AdminMember[]> {
  const payload = await getJson<unknown>("/admin/admins");
  const source = record(payload);
  const rows = Array.isArray(payload)
    ? payload
    : firstArray(source, ["items", "admins", "data", "list"]);
  return rows.map(mapAdminMember);
}

/** POST /admin/admins */
export async function addAdmin(userId: string, role: AdminRole): Promise<void> {
  await postAction("/admin/admins", { userId, role });
}

/** DELETE /admin/admins/:userId */
export async function removeAdmin(userId: string): Promise<void> {
  await writeJson<unknown>("DELETE", `/admin/admins/${encodeURIComponent(userId)}`);
}

/* ---------------------------------------------------------------- 交易明细 */

function mapOrderStatus(value: string | null): OrderStatus {
  switch ((value ?? "").toLowerCase()) {
    case "pending_payment":
    case "pending":
    case "unpaid":
    case "待付款":
      return "pending_payment";
    case "paid":
    case "已支付":
      return "paid";
    case "completed":
    case "complete":
    case "settled":
    case "已支付完成":
    case "已完成":
      return "completed";
    case "cancelled":
    case "canceled":
    case "closed":
    case "已取消":
      return "cancelled";
    default:
      return "unknown";
  }
}

function mapPayChannel(value: unknown): PayChannel | null {
  const channel = text(value);
  if (!channel) return null;
  switch (channel) {
    case "alipay":
    case "wechat":
    case "qq":
      return channel;
    default:
      return "unknown";
  }
}

function mapOrder(raw: unknown): AdminOrder {
  const source = record(raw);
  const merchantSource = source.merchant ?? source.merchantUser;
  const payerSource = source.payer ?? source.payerUser;
  const appealRaw = source.appeal;
  const hasAppealFlag = firstBoolean(source, ["hasAppeal", "appeal"]);
  return {
    id: textOr(firstText(source, ["id", "orderId"]), ""),
    orderNo: textOr(
      firstText(source, ["orderNo", "orderNumber", "no"]),
      "—",
    ),
    amountCents: mapAmountCents(source, [
      "amountCents",
      "amount",
      "totalCents",
      "totalAmountCents",
    ]),
    status: mapOrderStatus(firstText(source, ["status"])),
    title: textOr(
      firstText(source, ["title", "summary", "subject", "itemTitle"]),
      "自定义付款",
    ),
    payChannel: mapPayChannel(
      firstText(source, ["payChannel", "channel", "paymentMethod"]),
    ),
    createdAt: isoOrNull(firstText(source, ["createdAt", "createdTime"])),
    paidAt: isoOrNull(firstText(source, ["paidAt", "payTime"])),
    completedAt: isoOrNull(firstText(source, ["completedAt", "completeTime"])),
    cancelledAt: isoOrNull(firstText(source, ["cancelledAt", "cancelTime"])),
    merchantName: textOr(
      firstText(source, ["merchantName", "merchantDisplayName"]) ??
        nameOf(merchantSource),
      "—",
    ),
    payerName: textOr(
      firstText(source, ["payerName", "payerNameSnapshot", "payerDisplayName"]) ??
        nameOf(payerSource),
      "—",
    ),
    merchantUserId:
      firstText(source, ["merchantUserId", "merchantId"]) ??
      (isRecord(merchantSource)
        ? firstText(merchantSource, ["id", "userId"])
        : null),
    payerUserId:
      firstText(source, ["payerUserId", "payerId"]) ??
      (isRecord(payerSource) ? firstText(payerSource, ["id", "userId"]) : null),
    hasAppeal: hasAppealFlag ?? (appealRaw !== null && appealRaw !== undefined),
    flagged: firstBoolean(source, ["flagged", "abnormal", "isFlagged"]) ?? false,
    flagReason: firstText(source, [
      "flagReason",
      "abnormalReason",
      "flaggedReason",
    ]),
    reservedNote: firstText(source, ["reservedNote", "note", "remark"]),
    actualNote: firstText(source, ["actualNote", "actualPayNote"]),
    cancelReason: firstText(source, ["cancelReason", "reason"]),
  };
}

function mapOrderEvent(raw: unknown, index: number): OrderEvent {
  const source = record(raw);
  return {
    id: textOr(firstText(source, ["id"]), `event-${index}`),
    type: textOr(firstText(source, ["type", "eventType"]), "event"),
    actorRole: textOr(firstText(source, ["actorRole", "role"]), ""),
    detail: firstText(source, ["detail", "description", "note"]),
    createdAt: isoOrNull(firstText(source, ["createdAt", "time"])),
  };
}

function mapAppealStatus(value: string | null): AppealStatus {
  switch ((value ?? "").toLowerCase()) {
    case "open":
    case "pending":
      return "pending";
    case "closed":
    case "resolved":
      return "resolved";
    case "flagged":
    case "rejected":
      return "rejected";
    default:
      return "unknown";
  }
}

function mapAppeal(raw: unknown, order?: AdminOrder): AdminAppeal {
  const source = record(raw);
  const nestedOrder = record(source.order);
  return {
    id: textOr(firstText(source, ["id", "appealId"]), ""),
    orderId:
      firstText(source, ["orderId"]) ??
      firstText(nestedOrder, ["id"]) ??
      order?.id ??
      "",
    orderNo:
      firstText(source, ["orderNo"]) ??
      firstText(nestedOrder, ["orderNo"]) ??
      order?.orderNo ??
      "—",
    reason: textOr(
      firstText(source, ["reason", "appealReason", "description", "content"]),
      "—",
    ),
    status: mapAppealStatus(firstText(source, ["status"])),
    createdAt: isoOrNull(firstText(source, ["createdAt", "time"])),
    payerName:
      firstText(source, ["payerName"]) ?? order?.payerName ?? null,
    merchantName:
      firstText(source, ["merchantName"]) ?? order?.merchantName ?? null,
    amountCents:
      firstNumber(source, ["amountCents", "amount"]) ??
      firstNumber(nestedOrder, ["amountCents", "amount"]) ??
      order?.amountCents ??
      null,
    handledNote: firstText(source, ["handledNote", "note", "resolution"]),
  };
}

function mapOrderDetail(payload: unknown): AdminOrderDetail {
  const source = record(payload);
  const orderRaw = isRecord(source.order) ? source.order : source;
  const order = mapOrder(orderRaw);
  const orderSource = record(orderRaw);
  let eventsRaw = firstArray(source, ["events", "timeline", "orderEvents"]);
  if (eventsRaw.length === 0) {
    eventsRaw = firstArray(orderSource, ["events", "timeline", "orderEvents"]);
  }
  const appealRaw = source.appeal ?? orderSource.appeal;
  return {
    ...order,
    events: eventsRaw.map(mapOrderEvent),
    appeal: isRecord(appealRaw) ? mapAppeal(appealRaw, order) : null,
  };
}

function buildOrderQuery(filters: OrderFilters): AdminQuery {
  return {
    from: filters.from,
    to: filters.to,
    status: filters.status && filters.status !== "all" ? filters.status : undefined,
    merchantId: filters.merchantId?.trim() || undefined,
    payerId: filters.payerId?.trim() || undefined,
    minAmount: typeof filters.minAmount === "number" ? filters.minAmount : undefined,
    maxAmount: typeof filters.maxAmount === "number" ? filters.maxAmount : undefined,
    query: filters.query?.trim() || undefined,
  };
}

/** GET /admin/orders?... */
export async function getOrders(
  filters: OrderFilters,
  page: number,
  pageSize: number,
): Promise<Page<AdminOrder>> {
  const payload = await getJson<unknown>("/admin/orders", {
    ...buildOrderQuery(filters),
    page,
    pageSize,
  });
  return mapPage(payload, mapOrder);
}

/** GET /admin/orders/:id */
export async function getOrderDetail(id: string): Promise<AdminOrderDetail> {
  const payload = await getJson<unknown>(
    `/admin/orders/${encodeURIComponent(id)}`,
  );
  return mapOrderDetail(payload);
}

/** POST /admin/orders/:id/close */
export async function closeOrder(id: string, note: string): Promise<void> {
  await postAction(`/admin/orders/${encodeURIComponent(id)}/close`, { note });
}

/** POST /admin/orders/:id/flag */
export async function flagOrder(id: string, note: string): Promise<void> {
  await postAction(`/admin/orders/${encodeURIComponent(id)}/flag`, { note });
}

/* ------------------------------------------------------------------ 申诉 */

/** GET /admin/appeals?status&page&pageSize */
export async function getAppeals(
  status: AppealStatus | "all",
  page: number,
  pageSize: number,
): Promise<Page<AdminAppeal>> {
  const payload = await getJson<unknown>("/admin/appeals", {
    status: status !== "all" && status !== "unknown" ? status : undefined,
    page,
    pageSize,
  });
  return mapPage(payload, (raw) => mapAppeal(raw));
}

/** POST /admin/appeals/:id/handle */
export async function handleAppeal(
  id: string,
  status: "resolved" | "rejected",
  note: string,
): Promise<void> {
  await postAction(`/admin/appeals/${encodeURIComponent(id)}/handle`, {
    status,
    note,
  });
}

/* ---------------------------------------------------------------- 数据统计 */

function mapMerchantRank(raw: unknown, index: number): {
  id: string;
  name: string;
  amountCents: number;
  orderCount: number;
} {
  const source = record(raw);
  return {
    id: textOr(firstText(source, ["id", "userId", "merchantId"]), `rank-${index}`),
    name: textOr(
      firstText(source, ["name", "displayName", "merchantName"]),
      "未知商家",
    ),
    amountCents: mapAmountCents(source, [
      "amountCents",
      "totalCents",
      "amount",
      "totalAmountCents",
    ]),
    orderCount: numberOr(
      firstNumber(source, ["orderCount", "count", "orders"]),
      0,
    ),
  };
}

function mapPaymentMethod(raw: unknown, index: number): PaymentMethodStat {
  const source = record(raw);
  const methodRaw = text(firstText(source, ["method", "channel", "payChannel"]));
  const method: PayChannel =
    methodRaw === "alipay" || methodRaw === "wechat" || methodRaw === "qq"
      ? methodRaw
      : "unknown";
  return {
    method,
    label:
      textOr(firstText(source, ["label", "name"]), payChannelLabel(method)) ||
      `其他 ${index + 1}`,
    count: numberOr(firstNumber(source, ["count", "orderCount", "value"]), 0),
    amountCents: mapAmountCents(source, [
      "amountCents",
      "amount",
      "totalCents",
      "value",
    ]),
  };
}

function mapFunnel(value: unknown): FunnelStep[] {
  const labels = ["创建订单", "已支付", "已完成"];
  const keys = ["created", "paid", "completed"] as const;
  if (Array.isArray(value)) {
    return value.map((raw, index) => {
      const source = record(raw);
      return {
        key: textOr(firstText(source, ["key"]), keys[index] ?? `step-${index}`),
        label: textOr(
          firstText(source, ["label", "name"]),
          labels[index] ?? `步骤 ${index + 1}`,
        ),
        count: numberOr(firstNumber(source, ["count", "value"]), 0),
      };
    });
  }
  const source = record(value);
  return keys.map((key, index) => ({
    key,
    label: labels[index] ?? key,
    count: numberOr(
      firstNumber(source, [key, `${key}Count`, `${key}Orders`]),
      0,
    ),
  }));
}

/** 金额区间的兜底文案（后端未返回 label 时使用） */
const AMOUNT_BUCKET_FALLBACKS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "lt10", label: "¥10 以下" },
  { key: "10to50", label: "¥10–50" },
  { key: "50to100", label: "¥50–100" },
  { key: "100to500", label: "¥100–500" },
  { key: "gte500", label: "¥500 以上" },
];

const HOUR_SLOT_COUNT = 24;

/** 金额区间分布；字段缺失时回落空数组 */
function mapAmountDistribution(value: unknown): AmountBucket[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const source = record(raw);
    const fallback = AMOUNT_BUCKET_FALLBACKS[index];
    return {
      key: textOr(
        firstText(source, ["key", "bucket"]),
        fallback?.key ?? `bucket-${index}`,
      ),
      label: textOr(
        firstText(source, ["label", "name"]),
        fallback?.label ?? `区间 ${index + 1}`,
      ),
      count: numberOr(
        firstNumber(source, ["count", "orderCount", "orders"]),
        0,
      ),
      amountCents: mapAmountCents(source, ["amountCents", "amount", "totalCents"]),
    };
  });
}

/** 24 小时时段分布：按 hour 归并到固定 0–23 槽位；字段缺失时回落空数组 */
function mapHourly(value: unknown): HourBucket[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const slots: HourBucket[] = Array.from(
    { length: HOUR_SLOT_COUNT },
    (_, hour) => ({ hour, count: 0, amountCents: 0 }),
  );
  for (const raw of value) {
    const source = record(raw);
    const hourRaw = firstNumber(source, ["hour", "h", "hourOfDay"]);
    if (hourRaw === null) continue;
    const hour = Math.trunc(hourRaw);
    const slot = slots[hour];
    if (!slot) continue;
    slot.count += numberOr(
      firstNumber(source, ["count", "orderCount", "orders"]),
      0,
    );
    slot.amountCents += mapAmountCents(source, [
      "amountCents",
      "amount",
      "totalCents",
    ]);
  }
  return slots;
}

/** 各订单状态数量；字段缺失时回落空数组 */
function mapStatusCounts(value: unknown): StatusCount[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const source = record(raw);
    const status = textOr(
      firstText(source, ["status", "key", "state"]),
      `status-${index}`,
    );
    return {
      status,
      label: textOr(firstText(source, ["label", "name"]), orderStatusLabel(status)),
      count: numberOr(
        firstNumber(source, ["count", "orderCount", "orders"]),
        0,
      ),
    };
  });
}

/** GET /admin/stats */
export async function getStats(): Promise<AdminStats> {
  const payload = await getJson<unknown>("/admin/stats");
  const source = record(payload);
  const avgFromSeconds = firstNumber(source, [
    "avgConfirmSeconds",
    "averageConfirmSeconds",
  ]);
  const avgFromMinutes = firstNumber(source, [
    "avgConfirmMinutes",
    "averageConfirmMinutes",
    "avgConfirmDurationMinutes",
  ]);
  return {
    trend: mapTrendList(
      firstArray(source, ["trend", "trends", "timeseries", "buckets", "months"]),
    ),
    merchantRanking: firstArray(source, [
      "merchantRanking",
      "merchantRank",
      "topMerchants",
      "merchants",
    ]).map(mapMerchantRank),
    paymentMethods: firstArray(source, [
      "paymentMethods",
      "payMethods",
      "channels",
      "paymentChannels",
    ]).map(mapPaymentMethod),
    funnel: mapFunnel(source.funnel ?? source.conversion),
    avgConfirmMinutes:
      avgFromMinutes ?? (avgFromSeconds !== null ? avgFromSeconds / 60 : 0),
    amountDistribution: mapAmountDistribution(
      firstArray(source, [
        "amountDistribution",
        "amountBuckets",
        "amountRanges",
        "distribution",
      ]),
    ),
    hourly: mapHourly(
      firstArray(source, [
        "hourly",
        "hours",
        "hourlyDistribution",
        "hourDistribution",
      ]),
    ),
    statusCounts: mapStatusCounts(
      firstArray(source, [
        "statusCounts",
        "orderStatusCounts",
        "statusDistribution",
        "statuses",
      ]),
    ),
  };
}

/* ---------------------------------------------------------------- 系统状态 */

function mapServiceHealth(value: string | null): ServiceHealth {
  switch ((value ?? "").toLowerCase()) {
    case "up":
    case "ok":
    case "healthy":
    case "pass":
    case "正常":
      return "up";
    case "degraded":
    case "warn":
    case "warning":
    case "降级":
      return "degraded";
    case "down":
    case "error":
    case "fail":
    case "critical":
    case "异常":
      return "down";
    default:
      return "unknown";
  }
}

function mapServiceStatus(raw: unknown, fallbackName: string): ServiceStatus {
  const source = record(raw);
  return {
    name: textOr(firstText(source, ["name", "service", "label"]), fallbackName),
    status: mapServiceHealth(
      firstText(source, ["status", "health", "state"]),
    ),
    latencyMs: firstNumber(source, [
      "latencyMs",
      "latency",
      "avgLatencyMs",
      "responseMs",
    ]),
    errorRate: ratioToPercent(
      firstNumber(source, ["errorRate", "errorPercent", "failureRate"]),
    ),
    uptime: ratioToPercent(
      firstNumber(source, ["uptime", "uptimeRate", "availability"]),
    ),
  };
}

function mapServices(value: unknown): ServiceStatus[] {
  if (Array.isArray(value)) {
    return value.map((raw, index) =>
      mapServiceStatus(raw, `服务 ${index + 1}`),
    );
  }
  const source = record(value);
  return Object.entries(source).map(([name, raw]) => {
    if (typeof raw === "string") {
      return {
        name,
        status: mapServiceHealth(raw),
        latencyMs: null,
        errorRate: null,
        uptime: null,
      };
    }
    return mapServiceStatus(raw, name);
  });
}

/** GET /admin/system/status */
export async function getSystemStatus(): Promise<SystemStatus> {
  const payload = await getJson<unknown>("/admin/system/status");
  const source = record(payload);
  const mailSource = record(source.mail ?? source.email ?? source.mailStatus);
  const successRateRaw = firstNumber(mailSource, [
    "successRate",
    "successPercent",
    "deliveryRate",
  ]);
  const mail: MailStatus = {
    successRate: ratioToPercent(successRateRaw) ?? 0,
    sent: numberOr(firstNumber(mailSource, ["sent", "total", "sentCount"]), 0),
    failed: numberOr(
      firstNumber(mailSource, ["failed", "failCount", "failure"]),
      0,
    ),
  };
  const campuxSource = record(
    source.campux ?? source.oauth ?? source.campuxStatus,
  );
  const campuxStatusText = firstText(campuxSource, ["status", "state"]);
  const campuxOkBoolean = firstBoolean(campuxSource, ["ok", "healthy", "connected"]);
  const campux: {
    ok: boolean;
    latencyMs: number | null;
    message: string | null;
  } = {
    ok:
      campuxOkBoolean ??
      (campuxStatusText !== null
        ? mapServiceHealth(campuxStatusText) === "up"
        : false),
    latencyMs: firstNumber(campuxSource, ["latencyMs", "latency", "responseMs"]),
    message: firstText(campuxSource, ["message", "detail", "error"]),
  };
  const storageSource = record(source.storage ?? source.disk ?? source.resources);
  const storage: StorageStatus = {
    dbSizeBytes: mapAmountCents(storageSource, [
      "dbSizeBytes",
      "databaseBytes",
      "dbBytes",
      "dbSize",
    ]),
    uploadsSizeBytes: mapAmountCents(storageSource, [
      "uploadsSizeBytes",
      "uploadBytes",
      "filesBytes",
      "uploadsSize",
    ]),
    diskUsedPercent: ratioToPercent(
      firstNumber(storageSource, [
        "diskUsedPercent",
        "usedPercent",
        "diskUsage",
      ]),
    ),
  };
  const queueSource = record(source.queue ?? source.jobs);
  const alertsRaw = firstArray(source, ["alerts", "warnings", "issues"]);
  const alerts: SystemAlert[] = alertsRaw.map((raw, index) => {
    if (typeof raw === "string") {
      return { id: `alert-${index}`, level: "danger", message: raw };
    }
    const item = record(raw);
    return {
      id: textOr(firstText(item, ["id"]), `alert-${index}`),
      level: mapTone(firstText(item, ["level", "severity", "tone"]), "danger"),
      message: textOr(
        firstText(item, ["message", "title", "detail"]),
        "检测到异常",
      ),
    };
  });
  const alertingSource = record(source.alerting ?? source.alert ?? source.notifications);
  const alerting: SystemAlerting = {
    webhookConfigured:
      firstBoolean(alertingSource, ["webhookConfigured", "webhook", "hasWebhook"]) ?? false,
    emailEnabled:
      firstBoolean(alertingSource, ["emailEnabled", "email", "mailEnabled"]) ?? false,
    recipients: numberOr(firstNumber(alertingSource, ["recipients", "recipientCount"]), 0),
    lastAlertAt: isoOrNull(firstText(alertingSource, ["lastAlertAt", "lastAlert"])),
    dispatchedLastHour: numberOr(
      firstNumber(alertingSource, ["dispatchedLastHour", "sentLastHour"]),
      0,
    ),
  };
  return {
    services: mapServices(source.services ?? source.checks),
    mail,
    campux,
    storage,
    queue: {
      pending: numberOr(firstNumber(queueSource, ["pending", "waiting"]), 0),
      failed: numberOr(firstNumber(queueSource, ["failed", "errors"]), 0),
      processed: firstNumber(queueSource, ["processed", "done", "completed"]),
    },
    alerting,
    alerts,
    updatedAt: isoOrNull(
      firstText(source, ["updatedAt", "time", "checkedAt", "generatedAt"]),
    ),
  };
}

/* ------------------------------------------------------------------ 公告 */

function mapAnnouncement(raw: unknown): Announcement {
  const source = record(raw);
  const levelText = text(firstText(source, ["level"]));
  const level: AnnouncementLevel =
    levelText === "important" || levelText === "warning" ? levelText : "info";
  return {
    id: textOr(firstText(source, ["id"]), ""),
    title: textOr(firstText(source, ["title"]), "未命名公告"),
    content: textOr(firstText(source, ["content", "body"]), ""),
    level,
    pinned: firstBoolean(source, ["pinned", "isPinned", "top"]) ?? false,
    publishedAt: isoOrNull(firstText(source, ["publishedAt", "publishAt"])),
    createdAt: isoOrNull(firstText(source, ["createdAt"])),
    updatedAt: isoOrNull(firstText(source, ["updatedAt", "modifiedAt"])),
    readCount: firstNumber(source, ["readCount", "read", "readUsers"]) ?? 0,
    totalUsers: firstNumber(source, ["totalUsers", "users", "audience"]) ?? 0,
    edited:
      firstBoolean(source, ["edited", "modified"]) ??
      (firstText(source, ["updatedAt"]) !== null &&
        firstText(source, ["updatedAt"]) !== firstText(source, ["createdAt"])),
  };
}

/** GET /admin/announcements */
export async function getAnnouncements(): Promise<Announcement[]> {
  const payload = await getJson<unknown>("/admin/announcements");
  const source = record(payload);
  const rows = Array.isArray(payload)
    ? payload
    : firstArray(source, ["items", "announcements", "data", "list"]);
  return rows.map(mapAnnouncement);
}

/** POST /admin/announcements */
export async function createAnnouncement(
  input: AnnouncementInput,
): Promise<void> {
  await postAction("/admin/announcements", input);
}

/** PATCH /admin/announcements/:id，返回是否触发重新推送 */
export async function updateAnnouncement(
  id: string,
  input: AnnouncementInput,
): Promise<{ republished: boolean }> {
  const payload = await writeJson<unknown>(
    "PATCH",
    `/admin/announcements/${encodeURIComponent(id)}`,
    input,
  );
  const source = record(payload);
  return { republished: firstBoolean(source, ["republished"]) ?? false };
}

/** DELETE /admin/announcements/:id */
export async function deleteAnnouncement(id: string): Promise<void> {
  await writeJson<unknown>(
    "DELETE",
    `/admin/announcements/${encodeURIComponent(id)}`,
  );
}

/* ------------------------------------------------------------------ 日志 */

function mapLog(raw: unknown, fallbackType: LogType): AdminLog {
  const source = record(raw);
  const typeText = text(firstText(source, ["type"]));
  const type: LogType =
    typeText === "audit" ||
    typeText === "login" ||
    typeText === "risk" ||
    typeText === "error"
      ? typeText
      : fallbackType;
  return {
    id: textOr(firstText(source, ["id"]), ""),
    type,
    createdAt: isoOrNull(firstText(source, ["createdAt", "time"])),
    actorName: firstText(source, [
      "actorName",
      "operatorName",
      "userName",
      "displayName",
    ]),
    action: firstText(source, ["action", "event", "operation"]),
    target: firstText(source, ["target", "targetName", "object"]),
    detail: firstText(source, ["detail", "description", "content", "message"]),
    ip: firstText(source, ["ip", "ipMasked", "ipAddress"]),
    userAgent: firstText(source, ["userAgent", "ua"]),
    result: firstText(source, ["result", "outcome", "status"]),
    level: firstText(source, ["level", "severity"]),
    message: firstText(source, ["message", "error", "errorMessage"]),
  };
}

/** GET /admin/logs?type&from&to&query&page&pageSize */
export async function getLogs(
  type: LogType,
  filters: LogFilters,
  page: number,
  pageSize: number,
): Promise<Page<AdminLog>> {
  const payload = await getJson<unknown>("/admin/logs", {
    type,
    from: filters.from,
    to: filters.to,
    query: filters.query?.trim() || undefined,
    page,
    pageSize,
  });
  return mapPage(payload, (raw) => mapLog(raw, type));
}

/* ------------------------------------------------------------------ 配置 */

function mapSecurityConfig(source: Record<string, unknown>): SecurityConfig {
  const security = record(source.security ?? source.protection ?? source.securitySettings);
  const merged = Object.keys(security).length > 0 ? security : source;
  return {
    paymentPasswordMaxAttempts: numberOr(
      firstNumber(merged, [
        "paymentPasswordMaxAttempts",
        "passwordMaxAttempts",
        "maxAttempts",
      ]),
      5,
    ),
    paymentPasswordLockMinutes: numberOr(
      firstNumber(merged, [
        "paymentPasswordLockMinutes",
        "passwordLockMinutes",
        "lockMinutes",
      ]),
      30,
    ),
    singlePaymentLimitCents: numberOr(
      firstNumber(merged, [
        "singlePaymentLimitCents",
        "singleLimitCents",
        "singlePaymentLimit",
      ]),
      0,
    ),
    dailyPaymentLimitCents: numberOr(
      firstNumber(merged, [
        "dailyPaymentLimitCents",
        "dailyLimitCents",
        "dailyPaymentLimit",
      ]),
      0,
    ),
    dynamicCodeTtlSeconds: numberOr(
      firstNumber(merged, [
        "dynamicCodeTtlSeconds",
        "dynamicCodeTtl",
        "dynamicCodeExpireSeconds",
      ]),
      60,
    ),
    emailCodeTtlSeconds: numberOr(
      firstNumber(merged, [
        "emailCodeTtlSeconds",
        "emailCodeTtl",
        "emailCodeExpireSeconds",
      ]),
      600,
    ),
    sessionTtlDays: numberOr(
      firstNumber(merged, ["sessionTtlDays", "sessionTtl", "sessionDays"]),
      7,
    ),
  };
}

/** GET /admin/config */
export async function getConfig(): Promise<AdminConfig> {
  const payload = await getJson<unknown>("/admin/config");
  const source = record(payload);
  const campuxSource = record(source.campux ?? source.campusWall ?? source.campuxOAuth);
  const systemSource = record(source.system ?? source.site ?? source.siteInfo);
  const mailSource = record(source.mail ?? source.smtp ?? source.mailConfig);
  return {
    campux: {
      baseUrl: textOr(
        firstText(campuxSource, ["baseUrl", "baseURL", "url", "base"]),
        "",
      ),
      clientId: textOr(
        firstText(campuxSource, ["clientId", "clientID", "appId", "client"]),
        "",
      ),
      clientSecretConfigured:
        firstBoolean(campuxSource, [
          "clientSecretConfigured",
          "secretConfigured",
          "clientSecretSet",
        ]) ?? false,
      scope: textOr(firstText(campuxSource, ["scope", "scopes"]), "profile"),
    },
    mail: {
      provider: mapMailProvider(mailSource),
      host: textOr(
        firstText(mailSource, ["host", "smtpHost", "server"]),
        "",
      ),
      port: numberOr(firstNumber(mailSource, ["port", "smtpPort"]), 465),
      secure:
        firstBoolean(mailSource, ["secure", "ssl", "useTls"]) ??
        numberOr(firstNumber(mailSource, ["port"]), 465) === 465,
      username: textOr(
        firstText(mailSource, ["username", "user", "smtpUser"]),
        "",
      ),
      fromName: textOr(
        firstText(mailSource, ["fromName", "senderName"]),
        "",
      ),
      fromAddress: textOr(
        firstText(mailSource, ["fromAddress", "from", "senderAddress"]),
        "",
      ),
      passwordConfigured:
        firstBoolean(mailSource, [
          "passwordConfigured",
          "passwordSet",
          "smtpPasswordConfigured",
        ]) ?? false,
    },
    security: mapSecurityConfig(source),
    system: {
      siteName: textOr(
        firstText(systemSource, ["siteName", "name", "title"]),
        "gzspay",
      ),
      schoolName: textOr(firstText(systemSource, ["schoolName"]), ""),
      publicBaseUrl: textOr(
        firstText(systemSource, ["publicBaseUrl", "publicUrl", "baseUrl"]),
        "",
      ),
      icp: textOr(firstText(systemSource, ["icp", "icpNumber", "beian"]), ""),
      billRetentionDays: numberOr(
        firstNumber(systemSource, ["billRetentionDays", "billRetention"]),
        1,
      ),
      paymentProofRetentionDays: numberOr(
        firstNumber(systemSource, ["paymentProofRetentionDays", "paymentProofRetention"]),
        15,
      ),
    },
    geo: mapGeoConfig(source),
    securityEntry: mapAdminEntryConfig(source),
  };
}

/** 地区访问限制配置映射（后台配置优先，缺省回落默认值） */
function mapGeoConfig(payload: unknown): AdminConfig["geo"] {
  const source = record(record(payload).geo ?? record(payload).geoBlock ?? record(payload).region);
  const whitelistRaw = source.ipWhitelist ?? source.whitelist;
  const ipWhitelist = Array.isArray(whitelistRaw)
    ? whitelistRaw.map((item) => text(item) ?? "").filter(Boolean).join(",")
    : textOr(firstText(source, ["ipWhitelist", "whitelist"]), "");
  const bypassPaths = firstArray(source, ["bypassPaths", "bypass", "paths"])
    .map((item) => text(item) ?? "")
    .filter(Boolean);
  return {
    blockNonChina:
      firstBoolean(source, ["blockNonChina", "blockNonCN", "enabled"]) ?? false,
    bypassPaths:
      bypassPaths.length > 0
        ? bypassPaths
        : ["/api/health", "/theme-boot.js", "/sw.js", "/manifest.webmanifest", "/favicon.ico"],
    ipWhitelist,
    unknownPolicy:
      text(firstText(source, ["unknownPolicy", "policy"])) === "allow" ? "allow" : "deny",
    trustHeader: textOr(firstText(source, ["trustHeader", "countryHeader"]), ""),
    dataUpdatedAt: isoOrNull(firstText(source, ["dataUpdatedAt", "updatedAt"])),
    ipv4Count: numberOr(firstNumber(source, ["ipv4Count", "ipv4"]), 0),
    ipv6Count: numberOr(firstNumber(source, ["ipv6Count", "ipv6"]), 0),
  };
}

/** 管理后台安全入口配置映射 */
function mapAdminEntryConfig(payload: unknown): AdminConfig["securityEntry"] {
  const root = record(payload);
  const source = record(root.securityEntry ?? root.adminEntry ?? root.entry);
  const entryPath = textOr(firstText(source, ["entryPath", "entry", "path"]), "");
  const entryUrl = textOr(
    firstText(source, ["entryUrl", "url"]),
    entryPath ? `/${entryPath}/admin` : "admin",
  );
  return { entryPath, entryUrl };
}

/** GET /admin/security/entry-visits */
export async function getAdminEntryVisits(limit = 20): Promise<AdminEntryVisitsPayload> {
  const payload = await getJson<unknown>(`/admin/security/entry-visits?limit=${limit}`);
  const source = record(payload);
  const items = firstArray(source, ["items", "visits", "list"]).map((raw, index) => {
    const item = record(raw);
    return {
      id: textOr(firstText(item, ["id"]), `visit-${index}`),
      ip: firstText(item, ["ip", "clientIp"]) ?? null,
      method: textOr(firstText(item, ["method"]), "GET"),
      path: textOr(firstText(item, ["path", "url"]), "/admin"),
      query: firstText(item, ["query", "search"]) ?? null,
      userAgent: firstText(item, ["userAgent", "agent", "ua"]) ?? null,
      referer: firstText(item, ["referer", "referrer"]) ?? null,
      createdAt:
        isoOrNull(firstText(item, ["createdAt", "time", "visitedAt"])) ?? new Date().toISOString(),
    };
  });
  return {
    total: numberOr(firstNumber(source, ["total", "count"]), items.length),
    items,
  };
}

/* ---------------------------------------------------------------- 访问统计 */

function mapTrafficItem(raw: unknown, index: number): TrafficBreakdownItem {
  const item = record(raw);
  const key = textOr(firstText(item, ["key", "name"]), `item-${index}`);
  return {
    key,
    label: textOr(firstText(item, ["label", "name"]), key),
    count: numberOr(firstNumber(item, ["count", "value", "total"]), 0),
    share: numberOr(firstNumber(item, ["share", "percent", "ratio"]), 0),
  };
}

function mapTrafficItems(value: unknown): TrafficBreakdownItem[] {
  return arrayOf(value).map(mapTrafficItem);
}

function mapTrafficSeries(value: unknown): TrafficSeriesPoint[] {
  return arrayOf(value).map((raw, index) => {
    const item = record(raw);
    const day = textOr(firstText(item, ["day", "date"]), "");
    return {
      day: day || `day-${index}`,
      label: textOr(firstText(item, ["label", "day"]), day || "—"),
      requests: numberOr(firstNumber(item, ["requests", "request", "total"]), 0),
      scans: numberOr(firstNumber(item, ["scans", "scan"]), 0),
      security: numberOr(firstNumber(item, ["security", "blocked"]), 0),
    };
  });
}

/** GET /admin/traffic：路由请求、状态码、设备、地区、扫码与安全防护统计 */
export async function getTraffic(days = 7): Promise<TrafficStats> {
  const payload = await getJson<unknown>(`/admin/traffic?days=${days}`);
  const source = record(payload);
  const requests = record(source.requests);
  const scans = record(source.scans);
  const security = record(source.security);
  return {
    days: numberOr(firstNumber(source, ["days"]), days),
    since: textOr(firstText(source, ["since"]), ""),
    until: textOr(firstText(source, ["until"]), ""),
    requests: {
      total: numberOr(firstNumber(requests, ["total", "count"]), 0),
      today: numberOr(firstNumber(requests, ["today"]), 0),
      averagePerDay: numberOr(
        firstNumber(requests, ["averagePerDay", "average", "averageDaily"]),
        0,
      ),
    },
    scans: {
      total: numberOr(firstNumber(scans, ["total", "count"]), 0),
      items: mapTrafficItems(scans.items),
    },
    security: {
      total: numberOr(firstNumber(security, ["total", "count"]), 0),
      items: mapTrafficItems(security.items),
    },
    routes: mapTrafficItems(source.routes),
    statuses: mapTrafficItems(source.statuses),
    devices: mapTrafficItems(source.devices),
    browsers: mapTrafficItems(source.browsers),
    systems: mapTrafficItems(source.systems),
    regions: mapTrafficItems(source.regions),
    series: mapTrafficSeries(source.series),
    generatedAt: isoOrNull(firstText(source, ["generatedAt"])) ?? new Date().toISOString(),
  };
}

/** PUT /admin/config */
export async function updateConfig(input: AdminConfigInput): Promise<void> {
  await writeJson<unknown>("PUT", "/admin/config", input);
}

/* ---------------------------------------------------------------- 导出下载 */

function buildQueryString(query?: AdminQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function parseFileName(disposition: string, fallback: string): string {
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
  const plainName = plainMatch?.[1]?.trim();
  return plainName ? plainName : fallback;
}

async function downloadCsv(
  path: string,
  query: AdminQuery | undefined,
  fallbackName: string,
): Promise<void> {
  const response = await fetch(`/api${path}${buildQueryString(query)}`, {
    credentials: "same-origin",
    headers: CSRF_HEADERS,
  });
  if (!response.ok) {
    let message = `导出失败（${response.status}）`;
    try {
      const payload: unknown = await response.json();
      const source = record(payload);
      const errorSource = record(source.error);
      message = text(source.message) ?? text(errorSource.message) ?? message;
    } catch {
      // 响应不是 JSON 时使用默认提示
    }
    const error = new ApiError(response.status, "EXPORT_FAILED", message);
    notifyAuthInvalid(error);
    throw error;
  }
  const blob = await response.blob();
  const fileName = parseFileName(
    response.headers.get("content-disposition") ?? "",
    fallbackName,
  );
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/** 导出全校订单 CSV */
export async function exportOrders(filters: OrderFilters): Promise<void> {
  await downloadCsv(
    "/admin/orders/export",
    buildOrderQuery(filters),
    "orders.csv",
  );
}

/** 导出日志 CSV */
export async function exportLogs(
  type: LogType,
  filters: LogFilters,
): Promise<void> {
  await downloadCsv(
    "/admin/logs/export",
    {
      type,
      from: filters.from,
      to: filters.to,
      query: filters.query?.trim() || undefined,
    },
    `logs-${type}.csv`,
  );
}
