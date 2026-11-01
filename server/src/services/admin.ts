import { statfsSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { config, isCampuxConfigured } from "../config.js";
import { db, execute, nowIso, queryAll, queryOne, setConfigValue } from "../db/index.js";
import { alertStatus } from "../lib/alerts.js";
import { writeAudit, writeMailOutbox, writeSystemError, toCsv } from "../lib/audit.js";
import {
  displayFullName,
  maskCardNo,
  maskEmail,
  maskStudentNo,
  newId,
} from "../lib/crypto.js";
import { AppError, errors } from "../lib/errors.js";
import { templates } from "../lib/mail.js";
import { revokeUserSessions } from "../lib/session.js";
import type {
  AdminRole,
  AdminRow,
  AppealRow,
  Channel,
  MerchantChannelRow,
  MerchantRow,
  OrderEventRow,
  OrderRow,
  OrderStatus,
  ProductRow,
  UserRow,
} from "../lib/types.js";
import { CHANNEL_LABELS, CHANNELS, findUserById } from "../lib/types.js";
import {
  applyRuntimeConfig,
  readAdminConfig,
  saveAdminConfig as saveRuntimeConfig,
  type SaveConfigInput,
} from "../lib/runtime-config.js";

/* ------------------------------------------------------------------ 通用 */

const STATUS_TEXT: Record<OrderStatus, string> = {
  pending_payment: "待付款",
  paid: "已支付",
  completed: "已完成",
  cancelled: "已取消",
};

function dayKey(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function monthKey(iso: string | null): string {
  return iso ? iso.slice(0, 7) : "";
}

function shiftMonth(key: string, delta: number): string {
  const [yearText, monthText] = key.split("-");
  const base = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + delta, 1));
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonthKey(): string {
  return nowIso().slice(0, 7);
}

function lastMonthKeys(count: number): string[] {
  const current = currentMonthKey();
  return Array.from({ length: count }, (_, index) => shiftMonth(current, index - (count - 1)));
}

function monthLabel(key: string): string {
  return `${key.slice(0, 4)}-${key.slice(5, 7)}`;
}

function nameOf(user: Pick<UserRow, "surname" | "given_name" | "campux_username"> | undefined): string {
  if (!user) return "—";
  const full = displayFullName(user.surname, user.given_name);
  if (full) return full;
  return user.campux_username?.trim() || "未命名用户";
}

function isMerchantUser(userId: string): boolean {
  return Boolean(queryOne("SELECT 1 AS ok FROM merchants WHERE user_id = ?", userId));
}

/* --------------------------------------------------------------- 订单 DTO */

export interface AdminOrderDto {
  id: string;
  orderNo: string;
  amountCents: number;
  status: OrderStatus;
  title: string;
  payChannel: string | null;
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

interface AdminOrderRow extends OrderRow {
  open_appeal_count: number;
  appeal_count: number;
}

function toAdminOrder(row: AdminOrderRow): AdminOrderDto {
  return {
    id: row.id,
    orderNo: row.order_no,
    amountCents: row.amount_cents,
    status: row.status,
    title: row.title,
    payChannel: row.pay_channel,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    merchantName: row.merchant_name_snapshot,
    payerName: row.payer_name_snapshot,
    merchantUserId: row.merchant_id,
    payerUserId: row.payer_id,
    hasAppeal: row.appeal_count > 0,
    flagged: row.flagged === 1,
    flagReason: row.flag_reason,
    reservedNote: row.reserved_note,
    actualNote: row.actual_note,
    cancelReason: row.cancel_reason,
  };
}

const ORDER_SELECT = `SELECT o.*,
  (SELECT COUNT(*) FROM appeals a WHERE a.order_id = o.id) AS appeal_count,
  (SELECT COUNT(*) FROM appeals a WHERE a.order_id = o.id AND a.status = 'open') AS open_appeal_count
  FROM orders o`;

/* ------------------------------------------------------------------ 总览 */

export interface TrendBucketDto {
  key: string;
  label: string;
  amountCents: number;
  orderCount: number;
}

export interface TodoDto {
  id: string;
  title: string;
  detail: string | null;
  level: string;
  createdAt: string | null;
}

export function adminOverview() {
  const totalAmount =
    queryOne<{ total: number }>(
      "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM orders WHERE status = 'completed'",
    )?.total ?? 0;
  const monthAmount =
    queryOne<{ total: number }>(
      "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM orders WHERE status = 'completed' AND substr(completed_at, 1, 7) = ?",
      currentMonthKey(),
    )?.total ?? 0;
  const todayOrderCount =
    queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM orders WHERE substr(created_at, 1, 10) = ?",
      nowIso().slice(0, 10),
    )?.total ?? 0;
  const userCount = queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM users")?.total ?? 0;
  const merchantCount =
    queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM merchants")?.total ?? 0;

  const keys = lastMonthKeys(12);
  const monthlyRows = queryAll<{ key: string; amount: number; orders: number }>(
    `SELECT substr(completed_at, 1, 7) AS key,
            COALESCE(SUM(amount_cents), 0) AS amount,
            COUNT(*) AS orders
     FROM orders WHERE status = 'completed' AND completed_at IS NOT NULL
     GROUP BY key`,
  );
  const monthly = new Map(monthlyRows.map((row) => [row.key, row]));
  const trend: TrendBucketDto[] = keys.map((key) => ({
    key,
    label: monthLabel(key),
    amountCents: monthly.get(key)?.amount ?? 0,
    orderCount: monthly.get(key)?.orders ?? 0,
  }));

  const recentRows = queryAll<AdminOrderRow>(`${ORDER_SELECT} ORDER BY o.created_at DESC LIMIT 8`);

  const todos: TodoDto[] = [];
  const openAppeals = queryAll<AppealRow & { order_no: string; amount_cents: number }>(
    `SELECT a.*, o.order_no, o.amount_cents FROM appeals a
     JOIN orders o ON o.id = a.order_id
     WHERE a.status = 'open' ORDER BY a.created_at DESC LIMIT 5`,
  );
  for (const appeal of openAppeals) {
    todos.push({
      id: `appeal-${appeal.id}`,
      title: `待处理申诉：订单 ${appeal.order_no}`,
      detail: appeal.reason,
      level: "danger",
      createdAt: appeal.created_at,
    });
  }
  const failedMail =
    queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM mail_outbox WHERE status = 'failed' AND created_at >= ?",
      new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    )?.total ?? 0;
  if (failedMail > 0) {
    todos.push({
      id: "mail-failed",
      title: `近 24 小时有 ${failedMail} 封邮件发送失败`,
      detail: "请检查系统发件邮箱配置",
      level: "warning",
      createdAt: null,
    });
  }
  const recentErrors =
    queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM system_errors WHERE created_at >= ?",
      new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    )?.total ?? 0;
  if (recentErrors > 0) {
    todos.push({
      id: "system-errors",
      title: `近 24 小时记录 ${recentErrors} 条系统错误`,
      detail: "可在日志查看中筛选系统错误日志",
      level: "warning",
      createdAt: null,
    });
  }

  return {
    totalAmountCents: totalAmount,
    monthAmountCents: monthAmount,
    todayOrderCount,
    userCount,
    merchantCount,
    trend,
    recentOrders: recentRows.map(toAdminOrder),
    todos,
  };
}

/* -------------------------------------------------------------- 每月交易额 */

export interface DailyBucketDto {
  key: string;
  label: string;
  amountCents: number;
  orderCount: number;
}

function dailyBucketsForMonth(key: string): DailyBucketDto[] {
  const rows = queryAll<{ key: string; amount: number; orders: number }>(
    `SELECT substr(completed_at, 1, 10) AS key,
            COALESCE(SUM(amount_cents), 0) AS amount,
            COUNT(*) AS orders
     FROM orders WHERE status = 'completed' AND completed_at IS NOT NULL
       AND substr(completed_at, 1, 7) = ?
     GROUP BY key`,
    key,
  );
  const byDay = new Map(rows.map((row) => [row.key, row]));
  const [yearText, monthText] = key.split("-");
  const days = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
  const isCurrentMonth = key === currentMonthKey();
  const today = Number(nowIso().slice(8, 10));
  const limit = isCurrentMonth ? today : days;
  return Array.from({ length: limit }, (_, index) => {
    const day = `${key}-${String(index + 1).padStart(2, "0")}`;
    return {
      key: day,
      label: `${index + 1} 日`,
      amountCents: byDay.get(day)?.amount ?? 0,
      orderCount: byDay.get(day)?.orders ?? 0,
    };
  });
}

export function adminMonthly(year: number, month?: string) {
  const months = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const days = dailyBucketsForMonth(key);
    return {
      key,
      label: `${index + 1} 月`,
      amountCents: days.reduce((sum, day) => sum + day.amountCents, 0),
      orderCount: days.reduce((sum, day) => sum + day.orderCount, 0),
      days,
    };
  });
  if (month) {
    const normalized = month.includes("-") ? month : `${year}-${month.padStart(2, "0")}`;
    const matched = months.find((item) => item.key === normalized);
    return { year, month: normalized, days: matched?.days ?? [] };
  }
  return { year, months };
}

/* ------------------------------------------------------------------ 用户 */

export interface AdminUserDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  studentNoMasked: string | null;
  emailMasked: string | null;
  isMerchant: boolean;
  frozen: boolean;
  createdAt: string | null;
  orderCount: number;
  totalAmountCents: number;
}

interface AdminUserRow extends UserRow {
  order_count: number;
  total_amount_cents: number;
  is_merchant: number;
}

const USER_SELECT = `SELECT u.*,
  (SELECT COUNT(*) FROM orders o WHERE o.payer_id = u.id) AS order_count,
  (SELECT COALESCE(SUM(o.amount_cents), 0) FROM orders o WHERE o.payer_id = u.id AND o.status = 'completed') AS total_amount_cents,
  (SELECT COUNT(*) FROM merchants m WHERE m.user_id = u.id) AS is_merchant
  FROM users u`;

function toAdminUser(row: AdminUserRow): AdminUserDto {
  return {
    id: row.id,
    displayName: nameOf(row),
    avatarUrl: row.avatar_url,
    studentNoMasked: row.student_no ? maskStudentNo(row.student_no) : null,
    emailMasked: row.email ? maskEmail(row.email) : null,
    isMerchant: row.is_merchant > 0,
    frozen: row.status === "frozen",
    createdAt: row.created_at,
    orderCount: row.order_count,
    totalAmountCents: row.total_amount_cents,
  };
}

export function adminUsers(query: string, page: number, pageSize: number) {
  const like = `%${query.trim()}%`;
  const where = query.trim()
    ? `WHERE (u.surname LIKE ? OR u.given_name LIKE ? OR u.student_no LIKE ? OR u.email LIKE ? OR u.campux_sub LIKE ? OR u.campux_username LIKE ?)`
    : "";
  const params = query.trim() ? [like, like, like, like, like, like] : [];
  const total =
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM users u ${where}`,
      ...params,
    )?.total ?? 0;
  const rows = queryAll<AdminUserRow>(
    `${USER_SELECT} ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );
  return { items: rows.map(toAdminUser), total, page, pageSize };
}

export function adminUserDetail(userId: string) {
  const row = queryOne<AdminUserRow>(`${USER_SELECT} WHERE u.id = ?`, userId);
  if (!row) throw errors.notFound("用户不存在");
  const recent = queryAll<AdminOrderRow>(
    `${ORDER_SELECT} WHERE o.payer_id = ? OR o.merchant_id = ? ORDER BY o.created_at DESC LIMIT 10`,
    userId,
    userId,
  );
  return {
    user: {
      ...toAdminUser(row),
      studentNo: row.student_no,
      email: row.email,
      cardNoMasked: row.card_no ? maskCardNo(row.card_no) : null,
      lastLoginAt: row.last_login_at,
      frozenReason: null,
    },
    orderCount: row.order_count,
    totalAmountCents: row.total_amount_cents,
    recentOrders: recent.map(toAdminOrder),
  };
}

export function adminUsersGrowth(months = 12) {
  const keys = lastMonthKeys(Math.min(Math.max(months, 1), 24));
  const rows = queryAll<{ key: string; total: number }>(
    `SELECT substr(created_at, 1, 7) AS key, COUNT(*) AS total
     FROM users GROUP BY key`,
  );
  const counts = new Map(rows.map((row) => [row.key, row.total]));
  return {
    buckets: keys.map((key) => ({ key, label: monthLabel(key), count: counts.get(key) ?? 0 })),
  };
}

/** 判定「在线」的活跃窗口（分钟）：会话未过期且最近这么多分钟内有请求。 */
export const ONLINE_WINDOW_MINUTES = 5;

export interface AdminUserLoginDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  studentNoMasked: string | null;
  isMerchant: boolean;
  lastLoginAt: string;
}

interface AdminLoginRow extends UserRow {
  is_merchant: number;
}

/** 校园墙授权登录成功过的用户数，以及最近成功登录的用户（按最近登录时间倒序）。 */
export function adminUserLogins(limit = 8) {
  const total =
    queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM users WHERE last_login_at IS NOT NULL",
    )?.total ?? 0;
  const size = Math.min(Math.max(limit, 1), 50);
  const rows = queryAll<AdminLoginRow>(
    `SELECT u.*,
      (SELECT COUNT(*) FROM merchants m WHERE m.user_id = u.id) AS is_merchant
     FROM users u
     WHERE u.last_login_at IS NOT NULL
     ORDER BY u.last_login_at DESC
     LIMIT ?`,
    size,
  );
  return {
    total,
    recent: rows.map<AdminUserLoginDto>((row) => ({
      id: row.id,
      displayName: nameOf(row),
      avatarUrl: row.avatar_url,
      studentNoMasked: row.student_no ? maskStudentNo(row.student_no) : null,
      isMerchant: row.is_merchant > 0,
      lastLoginAt: String(row.last_login_at ?? ""),
    })),
  };
}

export interface AdminOnlineUserDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  studentNoMasked: string | null;
  isMerchant: boolean;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  sessionCount: number;
}

interface OnlineSessionRow {
  user_id: string;
  ip: string | null;
  user_agent: string | null;
  last_seen_at: string;
  surname: string | null;
  given_name: string | null;
  campux_username: string | null;
  avatar_url: string | null;
  student_no: string | null;
  is_merchant: number;
}

export function adminOnlineUsers() {
  const since = new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60_000).toISOString();
  const rows = queryAll<OnlineSessionRow>(
    `SELECT s.user_id, s.ip, s.user_agent, s.last_seen_at,
            u.surname, u.given_name, u.campux_username, u.avatar_url, u.student_no,
            (SELECT COUNT(*) FROM merchants m WHERE m.user_id = u.id) AS is_merchant
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.kind = 'user' AND s.expires_at > ? AND s.last_seen_at >= ?
     ORDER BY s.last_seen_at DESC`,
    nowIso(),
    since,
  );
  const byUser = new Map<string, AdminOnlineUserDto>();
  for (const row of rows) {
    const existing = byUser.get(row.user_id);
    if (existing) {
      existing.sessionCount += 1;
      continue;
    }
    byUser.set(row.user_id, {
      id: row.user_id,
      displayName: nameOf(row),
      avatarUrl: row.avatar_url,
      studentNoMasked: row.student_no ? maskStudentNo(row.student_no) : null,
      isMerchant: row.is_merchant > 0,
      ip: row.ip,
      userAgent: row.user_agent,
      lastSeenAt: row.last_seen_at,
      sessionCount: 1,
    });
  }
  const items = [...byUser.values()];
  return { items, total: items.length, onlineWindowMinutes: ONLINE_WINDOW_MINUTES };
}


export function setUserFrozen(actorId: string, userId: string, frozen: boolean, ip: string) {
  const user = findUserById(userId);
  if (!user) throw errors.notFound("用户不存在");
  db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(
    frozen ? "frozen" : "active",
    nowIso(),
    userId,
  );
  writeAudit({
    actorId,
    actorRole: "admin",
    action: frozen ? "admin.user.frozen" : "admin.user.unfrozen",
    targetType: "user",
    targetId: userId,
    detail: frozen ? "冻结账号" : "解冻账号",
    ip,
  });
  if (user.email) {
    writeMailOutbox({
      to: user.email,
      subject: templates.accountFrozen(user.email, frozen).subject,
      text: templates.accountFrozen(user.email, frozen).text,
      kind: "security",
      status: "queued",
    });
  }
  return { ok: true };
}

export function resetUserCard(actorId: string, userId: string, ip: string) {
  const user = findUserById(userId);
  if (!user) throw errors.notFound("用户不存在");
  db.prepare(
    "UPDATE users SET card_no = NULL, onboarded = 0, onboard_step = 'card', updated_at = ? WHERE id = ?",
  ).run(nowIso(), userId);
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.user.reset_card",
    targetType: "user",
    targetId: userId,
    detail: "重置校园卡绑定",
    ip,
  });
  return { ok: true };
}

export function forceUserLogout(actorId: string, userId: string, ip: string) {
  revokeUserSessions(userId);
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.user.force_logout",
    targetType: "user",
    targetId: userId,
    detail: "强制下线",
    ip,
  });
  return { ok: true };
}

/* ---------------------------------------------------------------- 商家 */

export interface AdminMerchantChannelDto {
  channel: Channel;
  label: string;
  enabled: boolean;
  hasQr: boolean;
  updatedAt: string | null;
}

export interface AdminMerchantDto {
  userId: string;
  merchantName: string;
  displayName: string;
  avatarUrl: string | null;
  studentNoMasked: string | null;
  noteRequirement: string;
  channels: AdminMerchantChannelDto[];
  /** 已上传收款码且启用的收款方式数量 */
  enabledChannelCount: number;
  productCount: number;
  activeProductCount: number;
  orderCount: number;
  completedAmountCents: number;
  lastOrderAt: string | null;
  /** 没有任何可用收款方式（被后台暂停收款或未上传收款码） */
  suspended: boolean;
  frozen: boolean;
  createdAt: string;
}

interface AdminMerchantRow extends MerchantRow {
  surname: string | null;
  given_name: string | null;
  campux_username: string | null;
  avatar_url: string | null;
  student_no: string | null;
  status: string;
  product_count: number;
  active_product_count: number;
  order_count: number;
  completed_amount_cents: number;
  last_order_at: string | null;
  enabled_channel_count: number;
}

const MERCHANT_SELECT = `SELECT m.*, u.surname, u.given_name, u.campux_username, u.avatar_url,
  u.student_no, u.status,
  (SELECT COUNT(*) FROM products p WHERE p.merchant_id = m.user_id) AS product_count,
  (SELECT COUNT(*) FROM products p WHERE p.merchant_id = m.user_id AND p.active = 1) AS active_product_count,
  (SELECT COUNT(*) FROM orders o WHERE o.merchant_id = m.user_id) AS order_count,
  (SELECT COALESCE(SUM(o.amount_cents), 0) FROM orders o WHERE o.merchant_id = m.user_id AND o.status = 'completed') AS completed_amount_cents,
  (SELECT MAX(o.created_at) FROM orders o WHERE o.merchant_id = m.user_id) AS last_order_at,
  (SELECT COUNT(*) FROM merchant_channels c WHERE c.merchant_id = m.user_id AND c.enabled = 1 AND c.qr_content <> '') AS enabled_channel_count
  FROM merchants m JOIN users u ON u.id = m.user_id`;

function merchantChannelsOf(merchantUserId: string): AdminMerchantChannelDto[] {
  const rows = queryAll<MerchantChannelRow>(
    "SELECT * FROM merchant_channels WHERE merchant_id = ?",
    merchantUserId,
  );
  const byChannel = new Map(rows.map((row) => [row.channel, row]));
  return CHANNELS.map((channel) => {
    const row = byChannel.get(channel);
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      enabled: row?.enabled === 1,
      hasQr: Boolean(row?.qr_content),
      updatedAt: row?.updated_at ?? null,
    };
  });
}

function toAdminMerchant(
  row: AdminMerchantRow,
  channels: AdminMerchantChannelDto[],
): AdminMerchantDto {
  return {
    userId: row.user_id,
    merchantName: row.name,
    displayName: nameOf(row),
    avatarUrl: row.avatar_url,
    studentNoMasked: row.student_no ? maskStudentNo(row.student_no) : null,
    noteRequirement: row.note_requirement ?? "",
    channels,
    enabledChannelCount: channels.filter((item) => item.enabled && item.hasQr).length,
    productCount: row.product_count,
    activeProductCount: row.active_product_count,
    orderCount: row.order_count,
    completedAmountCents: row.completed_amount_cents,
    lastOrderAt: row.last_order_at,
    suspended: row.enabled_channel_count === 0,
    frozen: row.status === "frozen",
    createdAt: row.created_at,
  };
}

export type MerchantStateFilter = "all" | "ready" | "suspended";

/** 后台商家列表：按商家名 / 负责人姓名 / 学号搜索，可按「可收款 / 已暂停」筛选。 */
export function adminMerchants(
  filters: { query: string; state: MerchantStateFilter },
  page: number,
  pageSize: number,
) {
  const keyword = filters.query.trim();
  const like = `%${keyword}%`;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (keyword) {
    conditions.push(
      "(m.name LIKE ? OR u.surname LIKE ? OR u.given_name LIKE ? OR u.student_no LIKE ? OR u.campux_username LIKE ?)",
    );
    params.push(like, like, like, like, like);
  }
  const readyCondition = `(SELECT COUNT(*) FROM merchant_channels c
    WHERE c.merchant_id = m.user_id AND c.enabled = 1 AND c.qr_content <> '')`;
  if (filters.state === "ready") conditions.push(`${readyCondition} > 0`);
  else if (filters.state === "suspended") conditions.push(`${readyCondition} = 0`);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total =
    queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM merchants m JOIN users u ON u.id = m.user_id ${where}`,
      ...params,
    )?.total ?? 0;
  const rows = queryAll<AdminMerchantRow>(
    `${MERCHANT_SELECT} ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );
  return {
    items: rows.map((row) => toAdminMerchant(row, merchantChannelsOf(row.user_id))),
    total,
    page,
    pageSize,
  };
}

/** 商家概况：总数、可收款、已暂停、本月新增。 */
export function adminMerchantSummary() {
  const total =
    queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM merchants")?.total ?? 0;
  const ready =
    queryOne<{ total: number }>(
      "SELECT COUNT(DISTINCT merchant_id) AS total FROM merchant_channels WHERE enabled = 1 AND qr_content <> ''",
    )?.total ?? 0;
  const newThisMonth =
    queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM merchants WHERE substr(created_at, 1, 7) = ?",
      currentMonthKey(),
    )?.total ?? 0;
  return { total, ready, suspended: Math.max(total - ready, 0), newThisMonth };
}

/** 商家详情：资料、收款方式、商品与最近收款订单。 */
export function adminMerchantDetail(userId: string) {
  const row = queryOne<AdminMerchantRow>(`${MERCHANT_SELECT} WHERE m.user_id = ?`, userId);
  if (!row) throw errors.notFound("商家不存在");
  const products = queryAll<ProductRow>(
    "SELECT * FROM products WHERE merchant_id = ? ORDER BY sort_order ASC, created_at ASC",
    userId,
  ).map((product) => ({
    id: product.id,
    name: product.name,
    priceCents: product.price_cents,
    description: product.description,
    active: product.active === 1,
    sortOrder: product.sort_order,
    createdAt: product.created_at,
  }));
  const recentOrders = queryAll<AdminOrderRow>(
    `${ORDER_SELECT} WHERE o.merchant_id = ? ORDER BY o.created_at DESC LIMIT 10`,
    userId,
  ).map(toAdminOrder);
  return {
    merchant: toAdminMerchant(row, merchantChannelsOf(userId)),
    products,
    recentOrders,
  };
}

function requireMerchantRow(userId: string): MerchantRow {
  const row = queryOne<MerchantRow>("SELECT * FROM merchants WHERE user_id = ?", userId);
  if (!row) throw errors.notFound("商家不存在");
  return row;
}

/** 后台启用/停用某个收款方式（启用前要求已经上传收款码）。 */
export function setMerchantChannelEnabled(
  actorId: string,
  merchantUserId: string,
  channel: string,
  enabled: boolean,
  ip: string,
) {
  requireMerchantRow(merchantUserId);
  if (!CHANNELS.includes(channel as Channel)) {
    throw errors.validation("收款方式不正确，应为 alipay、wechat 或 qq");
  }
  const value = channel as Channel;
  const row = queryOne<MerchantChannelRow>(
    "SELECT * FROM merchant_channels WHERE merchant_id = ? AND channel = ?",
    merchantUserId,
    value,
  );
  if (!row) throw errors.notFound("该商家尚未配置这个收款方式");
  if (enabled && !row.qr_content) {
    throw errors.validation("该收款方式还没有收款码，无法启用");
  }
  execute(
    "UPDATE merchant_channels SET enabled = ?, updated_at = ? WHERE merchant_id = ? AND channel = ?",
    enabled ? 1 : 0,
    nowIso(),
    merchantUserId,
    value,
  );
  writeAudit({
    actorId,
    actorRole: "admin",
    action: enabled ? "admin.merchant.channel_enabled" : "admin.merchant.channel_disabled",
    targetType: "merchant",
    targetId: merchantUserId,
    detail: CHANNEL_LABELS[value],
    ip,
  });
  return adminMerchantDetail(merchantUserId);
}

/**
 * 后台暂停 / 恢复商家收款。
 * 暂停 = 停用全部收款方式（付款人无法再向该商家付款）；恢复 = 重新启用所有已上传收款码的方式。
 */
export function setMerchantReceiving(
  actorId: string,
  merchantUserId: string,
  enabled: boolean,
  ip: string,
) {
  const merchant = requireMerchantRow(merchantUserId);
  const now = nowIso();
  if (enabled) {
    const result = execute(
      "UPDATE merchant_channels SET enabled = 1, updated_at = ? WHERE merchant_id = ? AND qr_content <> ''",
      now,
      merchantUserId,
    );
    if (result.changes === 0) {
      throw errors.validation("该商家还没有上传任何收款码，无法恢复收款");
    }
  } else {
    execute(
      "UPDATE merchant_channels SET enabled = 0, updated_at = ? WHERE merchant_id = ?",
      now,
      merchantUserId,
    );
  }
  writeAudit({
    actorId,
    actorRole: "admin",
    action: enabled ? "admin.merchant.receiving_resumed" : "admin.merchant.receiving_suspended",
    targetType: "merchant",
    targetId: merchantUserId,
    detail: `${enabled ? "恢复收款" : "暂停收款"}：${merchant.name}`,
    ip,
  });
  return adminMerchantDetail(merchantUserId);
}

/* ---------------------------------------------------------------- 管理员 */

export interface AdminMemberDto {
  id: string;
  userId: string;
  displayName: string;
  emailMasked: string | null;
  role: AdminRole;
  createdAt: string | null;
}

export function adminMembers() {
  const rows = queryAll<AdminRow & { surname: string | null; given_name: string | null; campux_username: string | null; email: string | null }>(
    `SELECT a.*, u.surname, u.given_name, u.campux_username, u.email
     FROM admins a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at ASC`,
  );
  const items: AdminMemberDto[] = rows.map((row) => ({
    id: row.user_id,
    userId: row.user_id,
    displayName: nameOf(row),
    emailMasked: row.email ? maskEmail(row.email) : null,
    role: row.role,
    createdAt: row.created_at,
  }));
  return { items };
}

export function addAdmin(actorId: string, userId: string, role: AdminRole, ip: string) {
  const user = findUserById(userId);
  if (!user) throw errors.notFound("用户不存在");
  const existing = queryOne<AdminRow>("SELECT * FROM admins WHERE user_id = ?", userId);
  if (existing) throw errors.conflict("该用户已经是管理员");
  db.prepare("INSERT INTO admins (user_id, role, created_by, created_at) VALUES (?, ?, ?, ?)").run(
    userId,
    role,
    actorId,
    nowIso(),
  );
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.member.added",
    targetType: "user",
    targetId: userId,
    detail: `添加管理员，角色 ${role}`,
    ip,
  });
  return { ok: true };
}

export function removeAdmin(actorId: string, userId: string, ip: string) {
  const target = queryOne<AdminRow>("SELECT * FROM admins WHERE user_id = ?", userId);
  if (!target) throw errors.notFound("该用户不是管理员");
  if (target.user_id === actorId) throw errors.conflict("不能移除自己的管理员身份");
  if (target.role === "super") {
    const supers =
      queryOne<{ total: number }>(
        "SELECT COUNT(*) AS total FROM admins WHERE role = 'super'",
      )?.total ?? 0;
    if (supers <= 1) throw errors.conflict("至少需要保留一名超级管理员");
  }
  db.prepare("DELETE FROM admins WHERE user_id = ?").run(userId);
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.member.removed",
    targetType: "user",
    targetId: userId,
    detail: "移除管理员",
    ip,
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ 订单 */

export interface AdminOrderFilters {
  from?: string;
  to?: string;
  status?: string;
  merchantId?: string;
  payerId?: string;
  minAmount?: number;
  maxAmount?: number;
  query?: string;
}

const ALLOWED_STATUS: OrderStatus[] = ["pending_payment", "paid", "completed", "cancelled"];

function orderFilterSql(filters: AdminOrderFilters): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.from) {
    conditions.push("o.created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("o.created_at <= ?");
    params.push(filters.to);
  }
  if (filters.status && ALLOWED_STATUS.includes(filters.status as OrderStatus)) {
    conditions.push("o.status = ?");
    params.push(filters.status);
  }
  if (filters.merchantId) {
    conditions.push("o.merchant_id = ?");
    params.push(filters.merchantId);
  }
  if (filters.payerId) {
    conditions.push("o.payer_id = ?");
    params.push(filters.payerId);
  }
  if (typeof filters.minAmount === "number") {
    conditions.push("o.amount_cents >= ?");
    params.push(filters.minAmount);
  }
  if (typeof filters.maxAmount === "number") {
    conditions.push("o.amount_cents <= ?");
    params.push(filters.maxAmount);
  }
  if (filters.query) {
    const like = `%${filters.query}%`;
    conditions.push(
      "(o.order_no LIKE ? OR o.title LIKE ? OR o.merchant_name_snapshot LIKE ? OR o.payer_name_snapshot LIKE ?)",
    );
    params.push(like, like, like, like);
  }
  return { sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

export function adminOrders(filters: AdminOrderFilters, page: number, pageSize: number) {
  const { sql, params } = orderFilterSql(filters);
  const total =
    queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM orders o ${sql}`, ...params)?.total ??
    0;
  const rows = queryAll<AdminOrderRow>(
    `${ORDER_SELECT} ${sql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );
  return { items: rows.map(toAdminOrder), total, page, pageSize };
}

export function adminOrderDetail(orderId: string) {
  const row = queryOne<AdminOrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, orderId);
  if (!row) throw errors.notFound("订单不存在");
  const events = queryAll<OrderEventRow>(
    "SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC",
    orderId,
  );
  const appealRow = queryOne<AppealRow>(
    "SELECT * FROM appeals WHERE order_id = ? ORDER BY created_at DESC LIMIT 1",
    orderId,
  );
  return {
    ...toAdminOrder(row),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      actorRole: event.actor_role,
      detail: event.detail,
      createdAt: event.created_at,
    })),
    appeal: appealRow ? appealDto(appealRow, row) : null,
  };
}

export function adminCloseOrder(actorId: string, orderId: string, note: string | null, ip: string) {
  const row = queryOne<OrderRow>("SELECT * FROM orders WHERE id = ?", orderId);
  if (!row) throw errors.notFound("订单不存在");
  if (row.status === "completed" || row.status === "cancelled") {
    throw new AppError(409, "ORDER_STATUS_INVALID", "订单已结束，无需关闭");
  }
  const timestamp = nowIso();
  db.prepare(
    `UPDATE orders SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?, updated_at = ?, closed_by_admin_id = ? WHERE id = ?`,
  ).run(note || "管理员关闭订单", timestamp, timestamp, actorId, orderId);
  db.prepare(
    "INSERT INTO order_events (id, order_id, type, actor_id, actor_role, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(newId(), orderId, "admin_closed", actorId, "admin", note || "管理员关闭订单", timestamp);
  db.prepare(
    "UPDATE appeals SET status = 'closed', handled_by = ?, handled_at = ?, handling_note = ? WHERE order_id = ? AND status = 'open'",
  ).run(actorId, timestamp, note || "管理员关闭订单", orderId);
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.order.closed",
    targetType: "order",
    targetId: orderId,
    detail: note || "管理员关闭订单",
    ip,
  });
  return { ok: true };
}

export function adminFlagOrder(actorId: string, orderId: string, note: string | null, ip: string) {
  const row = queryOne<OrderRow>("SELECT * FROM orders WHERE id = ?", orderId);
  if (!row) throw errors.notFound("订单不存在");
  const timestamp = nowIso();
  db.prepare("UPDATE orders SET flagged = 1, flag_reason = ?, updated_at = ? WHERE id = ?").run(
    note || "标记异常",
    timestamp,
    orderId,
  );
  db.prepare(
    "INSERT INTO order_events (id, order_id, type, actor_id, actor_role, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(newId(), orderId, "admin_flagged", actorId, "admin", note || "标记异常", timestamp);
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.order.flagged",
    targetType: "order",
    targetId: orderId,
    detail: note || "标记异常",
    ip,
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ 申诉 */

const APPEAL_STATUS_API: Record<AppealRow["status"], string> = {
  open: "pending",
  closed: "resolved",
  flagged: "rejected",
};

function appealDto(
  appeal: AppealRow,
  order?: Pick<OrderRow, "order_no" | "payer_name_snapshot" | "merchant_name_snapshot" | "amount_cents">,
) {
  return {
    id: appeal.id,
    orderId: appeal.order_id,
    orderNo: order?.order_no ?? "",
    reason: appeal.reason,
    status: APPEAL_STATUS_API[appeal.status],
    createdAt: appeal.created_at,
    payerName: order?.payer_name_snapshot ?? null,
    merchantName: order?.merchant_name_snapshot ?? null,
    amountCents: order?.amount_cents ?? null,
    handledNote: appeal.handling_note,
  };
}

export function adminAppeals(status: string | undefined, page: number, pageSize: number) {
  const mapped: AppealRow["status"] | null =
    status === "pending" || status === "open"
      ? "open"
      : status === "resolved" || status === "closed"
        ? "closed"
        : status === "rejected" || status === "flagged"
          ? "flagged"
          : null;
  const where = mapped ? "WHERE a.status = ?" : "";
  const params = mapped ? [mapped] : [];
  const total =
    queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM appeals a ${where}`, ...params)
      ?.total ?? 0;
  const rows = queryAll<AppealRow & OrderRow>(
    `SELECT a.*, o.order_no, o.amount_cents, o.payer_name_snapshot, o.merchant_name_snapshot
     FROM appeals a JOIN orders o ON o.id = a.order_id
     ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );
  return { items: rows.map((row) => appealDto(row, row)), total, page, pageSize };
}

export function handleAppeal(
  actorId: string,
  appealId: string,
  status: "resolved" | "rejected",
  note: string | null,
  ip: string,
) {
  const appeal = queryOne<AppealRow>("SELECT * FROM appeals WHERE id = ?", appealId);
  if (!appeal) throw errors.notFound("申诉记录不存在");
  const nextStatus: AppealRow["status"] = status === "resolved" ? "closed" : "flagged";
  db.prepare(
    "UPDATE appeals SET status = ?, handled_by = ?, handled_at = ?, handling_note = ? WHERE id = ?",
  ).run(nextStatus, actorId, nowIso(), note, appealId);
  if (status === "rejected") {
    db.prepare("UPDATE orders SET flagged = 1, flag_reason = ?, updated_at = ? WHERE id = ?").run(
      note || "申诉已驳回并标记异常",
      nowIso(),
      appeal.order_id,
    );
  }
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.appeal.handled",
    targetType: "appeal",
    targetId: appealId,
    detail: `处理申诉（${status === "resolved" ? "已解决" : "已驳回"}）${note ? `：${note}` : ""}`,
    ip,
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ 统计 */

export function adminStats() {
  const keys = lastMonthKeys(12);
  const monthlyRows = queryAll<{ key: string; amount: number; orders: number }>(
    `SELECT substr(completed_at, 1, 7) AS key,
            COALESCE(SUM(amount_cents), 0) AS amount,
            COUNT(*) AS orders
     FROM orders WHERE status = 'completed' AND completed_at IS NOT NULL GROUP BY key`,
  );
  const monthly = new Map(monthlyRows.map((row) => [row.key, row]));
  const trend: TrendBucketDto[] = keys.map((key) => ({
    key,
    label: monthLabel(key),
    amountCents: monthly.get(key)?.amount ?? 0,
    orderCount: monthly.get(key)?.orders ?? 0,
  }));

  const merchantRanking = queryAll<{ id: string; name: string; amount: number; orders: number }>(
    `SELECT merchant_id AS id, merchant_name_snapshot AS name,
            COALESCE(SUM(amount_cents), 0) AS amount, COUNT(*) AS orders
     FROM orders WHERE status = 'completed'
     GROUP BY merchant_id, merchant_name_snapshot
     ORDER BY amount DESC LIMIT 10`,
  ).map((row) => ({
    id: row.id,
    name: row.name,
    amountCents: row.amount,
    orderCount: row.orders,
  }));

  const methodRows = queryAll<{ method: string; count: number; amount: number }>(
    `SELECT pay_channel AS method, COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS amount
     FROM orders WHERE status = 'completed' AND pay_channel IS NOT NULL GROUP BY pay_channel`,
  );
  const methodMap = new Map(methodRows.map((row) => [row.method, row]));
  const paymentMethods = CHANNELS.map((channel) => ({
    method: channel,
    label: CHANNEL_LABELS[channel],
    count: methodMap.get(channel)?.count ?? 0,
    amountCents: methodMap.get(channel)?.amount ?? 0,
  }));

  const funnelRows = queryAll<{ status: OrderStatus; total: number }>(
    "SELECT status, COUNT(*) AS total FROM orders GROUP BY status",
  );
  const funnelMap = new Map(funnelRows.map((row) => [row.status, row.total]));
  const created = [...funnelMap.values()].reduce((sum, value) => sum + value, 0);
  const paids = (funnelMap.get("paid") ?? 0) + (funnelMap.get("completed") ?? 0);
  const completed = funnelMap.get("completed") ?? 0;
  const funnel = [
    { key: "created", label: "创建订单", count: created },
    { key: "paid", label: "已支付", count: paids },
    { key: "completed", label: "已完成", count: completed },
  ];

  const avgRow = queryOne<{ avg: number | null }>(
    `SELECT AVG((julianday(completed_at) - julianday(paid_at)) * 24 * 60) AS avg
     FROM orders WHERE completed_at IS NOT NULL AND paid_at IS NOT NULL`,
  );

  // 金额区间分布（已完成订单）
  const AMOUNT_BUCKETS = [
    { key: "lt10", label: "¥10 以下" },
    { key: "10to50", label: "¥10–50" },
    { key: "50to100", label: "¥50–100" },
    { key: "100to500", label: "¥100–500" },
    { key: "gte500", label: "¥500 以上" },
  ] as const;
  const distributionRows = queryAll<{ bucket: string; count: number; amount: number | null }>(
    `SELECT CASE
              WHEN amount_cents < 1000 THEN 'lt10'
              WHEN amount_cents < 5000 THEN '10to50'
              WHEN amount_cents < 10000 THEN '50to100'
              WHEN amount_cents < 50000 THEN '100to500'
              ELSE 'gte500'
            END AS bucket,
            COUNT(*) AS count,
            COALESCE(SUM(amount_cents), 0) AS amount
     FROM orders WHERE status = 'completed'
     GROUP BY bucket`,
  );
  const distributionMap = new Map(distributionRows.map((row) => [row.bucket, row]));
  const amountDistribution = AMOUNT_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: distributionMap.get(bucket.key)?.count ?? 0,
    amountCents: distributionMap.get(bucket.key)?.amount ?? 0,
  }));

  // 时段分布（服务器本地时间，0–23 时）
  const hourRows = queryAll<{ created_at: string; amount_cents: number }>(
    "SELECT created_at, amount_cents FROM orders WHERE status = 'completed'",
  );
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: 0,
    amountCents: 0,
  }));
  for (const row of hourRows) {
    const item = hourly[new Date(row.created_at).getHours()];
    if (!item) continue;
    item.count += 1;
    item.amountCents += row.amount_cents;
  }

  // 各状态订单数量
  const STATUS_LABELS: Record<string, string> = {
    pending_payment: "待付款",
    paid: "已支付",
    completed: "已完成",
    cancelled: "已取消",
  };
  const statusCounts = Object.entries(STATUS_LABELS).map(([status, label]) => ({
    status,
    label,
    count: funnelMap.get(status as OrderStatus) ?? 0,
  }));

  return {
    trend,
    merchantRanking,
    paymentMethods,
    funnel,
    avgConfirmMinutes: Math.round(avgRow?.avg ?? 0),
    amountDistribution,
    hourly,
    statusCounts,
  };
}

/* -------------------------------------------------------------- 系统状态 */

function countOf(sql: string, ...params: unknown[]): number {
  return queryOne<{ total: number }>(sql, ...params)?.total ?? 0;
}

function directorySize(dir: string): number {
  try {
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += directorySize(full);
      else if (entry.isFile()) total += statSync(full).size;
    }
    return total;
  } catch {
    return 0;
  }
}

export function adminSystemStatus() {
  const lastHour = new Date(Date.now() - 3600 * 1000).toISOString();
  const metrics = queryOne<{ total: number; errors: number; avg: number | null }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END), 0) AS errors,
            AVG(duration_ms) AS avg
     FROM request_metrics WHERE created_at >= ?`,
    lastHour,
  );
  const requestTotal = metrics?.total ?? 0;
  const errorRate = requestTotal > 0 ? ((metrics?.errors ?? 0) / requestTotal) * 100 : 0;

  const dbUp = Boolean(queryOne("SELECT 1 AS ok"));
  const services = [
    {
      name: "gzspay API",
      status: "up" as const,
      latencyMs: Math.round(metrics?.avg ?? 0),
      errorRate: Number(errorRate.toFixed(2)),
      uptime: 100,
    },
    {
      name: "数据库",
      status: dbUp ? ("up" as const) : ("down" as const),
      latencyMs: 1,
      errorRate: 0,
      uptime: dbUp ? 100 : 0,
    },
    {
      name: "邮件服务",
      status: isCampuxConfigured() ? ("up" as const) : ("degraded" as const),
      latencyMs: null,
      errorRate: null,
      uptime: null,
    },
    {
      name: "校园墙 OAuth",
      status: isCampuxConfigured() ? ("up" as const) : ("degraded" as const),
      latencyMs: null,
      errorRate: null,
      uptime: null,
    },
  ];

  const mailRows = queryAll<{ status: string; total: number }>(
    "SELECT status, COUNT(*) AS total FROM mail_outbox GROUP BY status",
  );
  const mailMap = new Map(mailRows.map((row) => [row.status, row.total]));
  const sent = (mailMap.get("sent") ?? 0) + (mailMap.get("queued") ?? 0);
  const failed = mailMap.get("failed") ?? 0;
  const mail = {
    successRate: sent + failed > 0 ? Number(((sent / (sent + failed)) * 100).toFixed(2)) : 100,
    sent,
    failed,
  };

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(config.databasePath).size;
  } catch {
    dbSizeBytes = 0;
  }
  let diskUsedPercent: number | null = null;
  try {
    const info = statfsSync(config.databasePath);
    const used = info.blocks - info.bfree;
    diskUsedPercent = info.blocks > 0 ? Number(((used / info.blocks) * 100).toFixed(1)) : null;
  } catch {
    diskUsedPercent = null;
  }

  const alerts = [] as { id: string; level: string; message: string }[];
  const errors24h = countOf("SELECT COUNT(*) AS total FROM system_errors WHERE created_at >= ?", new Date(Date.now() - 86400 * 1000).toISOString());
  if (errors24h > 0) {
    alerts.push({ id: "errors", level: "warning", message: `近 24 小时记录 ${errors24h} 条系统错误` });
  }
  if (failed > 0) {
    alerts.push({ id: "mail", level: "warning", message: `共有 ${failed} 封邮件发送失败` });
  }
  if (!dbUp) {
    alerts.push({ id: "database", level: "danger", message: "数据库连接异常" });
  }

  const alerting = alertStatus();
  if (!alerting.webhookConfigured && !alerting.emailEnabled) {
    alerts.push({
      id: "alerting",
      level: "warning",
      message: "严重系统错误主动告警尚未配置：请设置 ALERT_WEBHOOK_URL，或配置 SMTP 并为管理员填写邮箱",
    });
  } else if (!alerting.webhookConfigured && alerting.recipients === 0) {
    alerts.push({
      id: "alerting-recipients",
      level: "warning",
      message: "系统错误告警没有收件人：请给管理员账号绑定邮箱，或配置 ALERT_WEBHOOK_URL",
    });
  }

  return {
    services,
    mail,
    alerting,
    campux: {
      ok: isCampuxConfigured(),
      latencyMs: null,
      message: isCampuxConfigured() ? "校园墙 OAuth 已配置" : "尚未配置校园墙 OAuth（CAMPUX_CLIENT_ID / SECRET）",
    },
    storage: {
      dbSizeBytes,
      uploadsSizeBytes: directorySize(config.uploadDir),
      diskUsedPercent,
    },
    queue: {
      pending: countOf("SELECT COUNT(*) AS total FROM payment_requests WHERE status = 'pending'"),
      failed,
      processed: sent,
    },
    alerts,
    updatedAt: nowIso(),
  };
}

/* ------------------------------------------------------------------ 日志 */

export type AdminLogType = "audit" | "login" | "risk" | "error";

export interface AdminLogDto {
  id: string;
  type: AdminLogType;
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

function logWindow(clauses: string[], params: unknown[], from?: string, to?: string, query?: string, columns: string[] = []) {
  if (from) {
    clauses.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("created_at <= ?");
    params.push(to);
  }
  if (query && columns.length > 0) {
    const like = `%${query}%`;
    clauses.push(`(${columns.map((column) => `${column} LIKE ?`).join(" OR ")})`);
    for (const _column of columns) params.push(like);
  }
}

export function adminLogs(
  type: AdminLogType,
  options: { from?: string; to?: string; query?: string; page: number; pageSize: number },
) {
  const { from, to, query, page, pageSize } = options;
  const offset = (page - 1) * pageSize;
  const clauses: string[] = [];
  const params: unknown[] = [];
  let items: AdminLogDto[] = [];
  let total = 0;

  if (type === "audit") {
    const columns = ["action", "detail", "target_id"];
    logWindow(clauses, params, from, to, query, columns);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    total = countOf(`SELECT COUNT(*) AS total FROM audit_logs ${where}`, ...params);
    const rows = queryAll<{
      id: string;
      actor_id: string | null;
      actor_role: string | null;
      action: string;
      target_type: string | null;
      target_id: string | null;
      detail: string | null;
      ip: string | null;
      created_at: string;
      actor_name: string | null;
      actor_username: string | null;
      actor_surname: string | null;
      actor_given: string | null;
    }>(
      `SELECT l.*, u.surname AS actor_surname, u.given_name AS actor_given, u.campux_username AS actor_username
       FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id ${where.replace(/created_at/g, "l.created_at")}
       ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    );
    items = rows.map((row) => ({
      id: row.id,
      type,
      createdAt: row.created_at,
      actorName: row.actor_surname || row.actor_given
        ? displayFullName(row.actor_surname, row.actor_given) || row.actor_username
        : row.actor_username,
      action: row.action,
      target: [row.target_type, row.target_id].filter(Boolean).join(" ") || null,
      detail: row.detail,
      ip: row.ip,
      userAgent: null,
      result: row.actor_role,
      level: null,
      message: null,
    }));
  } else if (type === "login") {
    const columns = ["method", "reason", "ip"];
    logWindow(clauses, params, from, to, query, columns);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    total = countOf(`SELECT COUNT(*) AS total FROM login_logs ${where}`, ...params);
    const rows = queryAll<{
      id: string;
      user_id: string | null;
      campux_sub: string | null;
      method: string | null;
      result: string;
      reason: string | null;
      ip: string | null;
      user_agent: string | null;
      created_at: string;
      actor_username: string | null;
      actor_surname: string | null;
      actor_given: string | null;
    }>(
      `SELECT l.*, u.surname AS actor_surname, u.given_name AS actor_given, u.campux_username AS actor_username
       FROM login_logs l LEFT JOIN users u ON u.id = l.user_id ${where.replace(/created_at/g, "l.created_at")}
       ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    );
    items = rows.map((row) => ({
      id: row.id,
      type,
      createdAt: row.created_at,
      actorName: row.actor_surname || row.actor_given
        ? displayFullName(row.actor_surname, row.actor_given) || row.actor_username
        : row.actor_username,
      action: row.method,
      target: row.campux_sub,
      detail: row.reason,
      ip: row.ip,
      userAgent: row.user_agent,
      result: row.result,
      level: null,
      message: null,
    }));
  } else if (type === "risk") {
    const columns = ["type", "detail"];
    logWindow(clauses, params, from, to, query, columns);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    total = countOf(`SELECT COUNT(*) AS total FROM risk_logs ${where}`, ...params);
    const rows = queryAll<{
      id: string;
      user_id: string | null;
      type: string;
      detail: string | null;
      ip: string | null;
      created_at: string;
      actor_username: string | null;
      actor_surname: string | null;
      actor_given: string | null;
    }>(
      `SELECT l.*, u.surname AS actor_surname, u.given_name AS actor_given, u.campux_username AS actor_username
       FROM risk_logs l LEFT JOIN users u ON u.id = l.user_id ${where.replace(/created_at/g, "l.created_at")}
       ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    );
    items = rows.map((row) => ({
      id: row.id,
      type,
      createdAt: row.created_at,
      actorName: row.actor_surname || row.actor_given
        ? displayFullName(row.actor_surname, row.actor_given) || row.actor_username
        : row.actor_username,
      action: row.type,
      target: null,
      detail: row.detail,
      ip: row.ip,
      userAgent: null,
      result: null,
      level: "warning",
      message: null,
    }));
  } else {
    const columns = ["source", "message"];
    logWindow(clauses, params, from, to, query, columns);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    total = countOf(`SELECT COUNT(*) AS total FROM system_errors ${where}`, ...params);
    const rows = queryAll<{ id: string; source: string; message: string; stack: string | null; created_at: string }>(
      `SELECT * FROM system_errors ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    );
    items = rows.map((row) => ({
      id: row.id,
      type,
      createdAt: row.created_at,
      actorName: null,
      action: row.source,
      target: null,
      detail: row.stack ?? null,
      ip: null,
      userAgent: null,
      result: null,
      level: "error",
      message: row.message,
    }));
  }

  return { items, total, page, pageSize };
}

export function adminLogsCsv(type: AdminLogType, options: { from?: string; to?: string; query?: string }): string {
  const all = adminLogs(type, { ...options, page: 1, pageSize: 1000 });
  return toCsv(
    ["时间", "类型", "操作人", "动作", "对象", "详情", "IP", "结果", "消息"],
    all.items.map((item) => [
      item.createdAt,
      item.type,
      item.actorName,
      item.action,
      item.target,
      item.detail,
      item.ip,
      item.result ?? item.level,
      item.message,
    ]),
  );
}

export function adminOrdersCsv(filters: AdminOrderFilters): string {
  const all = adminOrders(filters, 1, 5000);
  return toCsv(
    ["订单号", "金额（元）", "状态", "标题", "商家", "付款人", "支付方式", "创建时间", "支付时间", "完成时间", "取消原因"],
    all.items.map((order) => [
      order.orderNo,
      (order.amountCents / 100).toFixed(2),
      STATUS_TEXT[order.status],
      order.title,
      order.merchantName,
      order.payerName,
      order.payChannel ? CHANNEL_LABELS[order.payChannel as keyof typeof CHANNEL_LABELS] ?? order.payChannel : "",
      order.createdAt,
      order.paidAt,
      order.completedAt,
      order.cancelReason,
    ]),
  );
}

/* ------------------------------------------------------------------ 配置 */

export function adminConfigView() {
  return readAdminConfig();
}

export function saveAdminConfig(
  actorId: string,
  input: SaveConfigInput,
  ip: string,
) {
  saveRuntimeConfig(actorId, input, ip);
  applyRuntimeConfig();
  return { ok: true, config: readAdminConfig() };
}

export function recordAdminLoginLog(params: {
  userId: string | null;
  campuxSub: string | null;
  success: boolean;
  reason?: string | null;
  ip: string;
  userAgent?: string | null;
}) {
  db.prepare(
    "INSERT INTO login_logs (id, user_id, campux_sub, method, result, reason, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    newId(),
    params.userId,
    params.campuxSub,
    "campux_admin",
    params.success ? "success" : "fail",
    params.reason ?? null,
    params.ip,
    params.userAgent ?? null,
    nowIso(),
  );
}

export function adminIdentity(user: UserRow, admin: AdminRow) {
  return {
    id: user.id,
    displayName: nameOf(user),
    emailMasked: user.email ? maskEmail(user.email) : null,
    role: admin.role,
    createdAt: admin.created_at,
  };
}

export { setConfigValue, writeSystemError, writeAudit };
