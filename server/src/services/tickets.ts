import { execute, nowIso, queryAll, queryOne, transaction } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { avatarPathOf } from "../lib/avatar.js";
import { maskPersonName, newId } from "../lib/crypto.js";
import { errors } from "../lib/errors.js";
import type {
  OrderRow,
  PublicUser,
  TicketCategory,
  TicketMessageRow,
  TicketRow,
  UserRow,
} from "../lib/types.js";
import { templates } from "../lib/mail.js";
import { likePattern } from "../lib/sql.js";
import { pushToUser } from "./events.js";
import { pushNotification } from "./push.js";
import { findOrderById, requireOrderForUser } from "./orders.js";
import { displayNameOf, findUserById, mailUserWithSetting, publicUserOf } from "./users.js";

/** 工单分类：建单时选择，决定后续提示文案与后台筛选 */
export const TICKET_CATEGORIES: TicketCategory[] = [
  "amount",
  "not_received",
  "not_as_described",
  "refund",
  "other",
];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  amount: "金额不符",
  not_received: "没有收到",
  not_as_described: "商品与描述不符",
  refund: "退款问题",
  other: "其他问题",
};

/** 同一订单累计最多 3 个工单（防止反复骚扰），同时只允许 1 个进行中 */
const MAX_TICKETS_PER_ORDER = 3;
/** 工单超过 7 天没有任何新消息则自动关闭 */
export const TICKET_AUTO_CLOSE_DAYS = 7;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_MESSAGES_RETURNED = 500;

/** 允许发起工单的订单状态：未付款、已支付待确认与已完成都可以联系对方（已取消的订单不行） */
const TICKET_ORDER_STATUSES = new Set(["pending_payment", "paid", "completed"]);

export interface TicketMessageDto {
  id: string;
  ticketId: string;
  senderId: string;
  /** system=平台系统提示（资料披露审核结果等），居中展示 */
  senderRole: "payer" | "merchant" | "admin" | "system";
  senderName: string;
  /** 头像地址；平台介入与系统提示的消息为 null，前端展示站点 logo */
  senderAvatarUrl: string | null;
  body: string;
  createdAt: string;
}

/** 工单里展示的订单双方资料（仅双方与管理员可见） */
export interface TicketPartyDto {
  id: string;
  role: "payer" | "merchant";
  displayName: string;
  studentNo: string | null;
  qq: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface TicketPartiesDto {
  payer: TicketPartyDto;
  merchant: TicketPartyDto;
}

/** 双方资料披露状态（需要订单任意一方申请、平台审核通过后才披露） */
export interface PartiesRevealDto {
  status: "hidden" | "pending" | "approved" | "rejected";
  /** 这条申请是不是当前查看者自己发的 */
  requestedByMe: boolean;
  requestedAt: string | null;
  /** 平台审核说明（驳回原因或批准说明） */
  note: string | null;
  revealedAt: string | null;
}

export interface TicketSummaryDto {
  id: string;
  orderId: string;
  orderNo: string;
  orderTitle: string;
  amountCents: number;
  category: TicketCategory;
  categoryLabel: string;
  status: "open" | "closed";
  openedByMe: boolean;
  /** 对方（订单里的另一方），姓名由前端脱敏展示 */
  counterparty: PublicUser;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
  unreadCount: number;
  lastMessage: {
    body: string;
    senderRole: "payer" | "merchant" | "admin" | "system";
    createdAt: string;
  } | null;
}

export interface TicketDto extends TicketSummaryDto {
  role: "payer" | "merchant";
  /** 订单双方资料；需要申请并由平台审核通过后才返回，否则为 null */
  parties: TicketPartiesDto | null;
  partiesReveal: PartiesRevealDto;
  messages: TicketMessageDto[];
  closedAt: string | null;
  closedReason: "user" | "admin" | "timeout" | null;
  resolutionNote: string | null;
}

export interface CreateTicketInput {
  orderId: string;
  category: TicketCategory;
  description: string;
}

export interface AdminTicketSummaryDto {
  id: string;
  orderId: string;
  orderNo: string;
  orderTitle: string;
  amountCents: number;
  category: TicketCategory;
  categoryLabel: string;
  status: "open" | "closed";
  openerName: string;
  payerName: string;
  merchantName: string;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
  /** 双方资料披露状态，后台列表用来看有没有待审核的申请 */
  partiesRevealStatus: "hidden" | "pending" | "approved" | "rejected";
}

export interface AdminTicketDto extends AdminTicketSummaryDto {
  /** 订单双方资料（姓名、学号、QQ、邮箱），供运营核对披露申请与联系双方 */
  parties: TicketPartiesDto;
  partiesReveal: PartiesRevealDto;
  messages: TicketMessageDto[];
  closedAt: string | null;
  closedReason: "user" | "admin" | "timeout" | null;
  resolutionNote: string | null;
}

function roleOf(order: OrderRow, userId: string): "payer" | "merchant" {
  return order.payer_id === userId ? "payer" : "merchant";
}

function counterpartyOf(order: OrderRow, userId: string): UserRow {
  const otherId = order.payer_id === userId ? order.merchant_id : order.payer_id;
  const user = findUserById(otherId);
  if (!user) throw errors.notFound("对方账号不存在");
  return user;
}

function senderRole(
  message: TicketMessageRow,
  order: OrderRow,
): "payer" | "merchant" | "admin" | "system" {
  // 身份取决于「消息是从哪里发的」：后台介入发的一律是平台客服，
  // 订单双方从交易页/工单页自己发的，即使是管理员账号也算本人，不能显示成平台消息；
  // system 是平台系统提示（资料披露审核结果等），居中展示。
  if (message.sender_kind === "system") return "system";
  if (message.sender_kind === "admin") return "admin";
  return message.sender_id === order.payer_id ? "payer" : "merchant";
}

function toMessageDto(
  message: TicketMessageRow,
  order: OrderRow,
  options: { maskNames?: boolean } = {},
): TicketMessageDto {
  const sender = findUserById(message.sender_id);
  const role = senderRole(message, order);
  // 资料未披露时，对话里对方的姓名也要打码（批准后才显示完整姓名）
  const rawName =
    sender
      ? displayNameOf(sender)
      : role === "payer"
        ? order.payer_name_snapshot
        : order.merchant_name_snapshot;
  return {
    id: message.id,
    ticketId: message.ticket_id,
    senderId: message.sender_id,
    senderRole: role,
    senderName:
      role === "admin"
        ? "平台客服"
        : role === "system"
          ? "系统提示"
          : options.maskNames
            ? maskPersonName(rawName)
            : rawName,
    // 平台介入与系统提示的消息不带头像，前端展示站点 logo / 居中文字
    senderAvatarUrl:
      role === "admin" || role === "system" ? null : sender ? avatarPathOf(sender) : null,
    body: message.body,
    createdAt: message.created_at,
  };
}

function partyOf(order: OrderRow, role: "payer" | "merchant"): TicketPartyDto {
  const id = role === "payer" ? order.payer_id : order.merchant_id;
  const user = findUserById(id);
  return {
    id,
    role,
    displayName: user
      ? displayNameOf(user)
      : role === "payer"
        ? order.payer_name_snapshot
        : order.merchant_name_snapshot,
    studentNo: user?.student_no ?? null,
    qq: user?.qq ?? null,
    email: user?.email ?? null,
    avatarUrl: user ? avatarPathOf(user) : null,
  };
}

function partiesOf(order: OrderRow): TicketPartiesDto {
  return { payer: partyOf(order, "payer"), merchant: partyOf(order, "merchant") };
}

const REVEAL_NOTE_MAX = 200;

function revealOf(ticket: TicketRow, viewerId: string): PartiesRevealDto {
  return {
    status: ticket.parties_reveal_status,
    requestedByMe: ticket.parties_reveal_requested_by === viewerId,
    requestedAt: ticket.parties_reveal_requested_at,
    note: ticket.parties_reveal_note,
    revealedAt: ticket.parties_revealed_at,
  };
}

/** 双方资料默认不披露：只有平台批准了披露申请，才把对方完整资料返回给订单双方 */
function partiesForViewer(ticket: TicketRow, order: OrderRow): TicketPartiesDto | null {
  return ticket.parties_reveal_status === "approved" ? partiesOf(order) : null;
}

function findTicketById(ticketId: string): TicketRow | undefined {
  return queryOne<TicketRow>("SELECT * FROM tickets WHERE id = ?", ticketId);
}

export function requireTicketForUser(ticketId: string, user: UserRow): { ticket: TicketRow; order: OrderRow } {
  const ticket = findTicketById(ticketId);
  if (!ticket) throw errors.notFound("工单不存在");
  const order = findOrderById(ticket.order_id);
  if (!order) throw errors.notFound("工单关联的订单不存在");
  if (order.payer_id !== user.id && order.merchant_id !== user.id) {
    throw errors.notFound("工单不存在");
  }
  return { ticket, order };
}

function lastReadAt(ticketId: string, userId: string): string {
  const row = queryOne<{ last_read_at: string }>(
    "SELECT last_read_at FROM ticket_reads WHERE ticket_id = ? AND user_id = ?",
    ticketId,
    userId,
  );
  return row?.last_read_at ?? "";
}

function unreadCountOf(ticket: TicketRow, userId: string): number {
  const since = lastReadAt(ticket.id, userId);
  const row = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ticket_messages
      WHERE ticket_id = ? AND sender_id != ? AND created_at > ?`,
    ticket.id,
    userId,
    since,
  );
  return row?.total ?? 0;
}

function lastMessageOf(ticket: TicketRow, order: OrderRow): TicketSummaryDto["lastMessage"] {
  // 列表预览只展示订单双方自己的消息：平台客服介入的内容不进入预览
  const message = queryOne<TicketMessageRow>(
    "SELECT * FROM ticket_messages WHERE ticket_id = ? AND sender_kind = 'user' ORDER BY created_at DESC, id DESC LIMIT 1",
    ticket.id,
  );
  if (!message) return null;
  return {
    body: message.body,
    senderRole: senderRole(message, order),
    createdAt: message.created_at,
  };
}

function toSummary(ticket: TicketRow, order: OrderRow, user: UserRow): TicketSummaryDto {
  const counterparty = counterpartyOf(order, user.id);
  const counterpartyUser = publicUserOf(counterparty);
  return {
    id: ticket.id,
    orderId: order.id,
    orderNo: order.order_no,
    orderTitle: order.title,
    amountCents: order.amount_cents,
    category: ticket.category,
    categoryLabel: TICKET_CATEGORY_LABELS[ticket.category] ?? "其他问题",
    status: ticket.status,
    openedByMe: ticket.opened_by === user.id,
    // 资料未披露时对方姓名也打码（列表卡片与详情顶部都用这个字段）
    counterparty:
      ticket.parties_reveal_status === "approved"
        ? counterpartyUser
        : { ...counterpartyUser, displayName: maskPersonName(counterpartyUser.displayName) },
    createdAt: ticket.created_at,
    lastMessageAt: ticket.last_message_at,
    messageCount: ticket.message_count,
    unreadCount: unreadCountOf(ticket, user.id),
    lastMessage: lastMessageOf(ticket, order),
  };
}

function markSenderRead(ticketId: string, userId: string, at: string): void {
  execute(
    `INSERT INTO ticket_reads (ticket_id, user_id, last_read_at) VALUES (?, ?, ?)
     ON CONFLICT(ticket_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
    ticketId,
    userId,
    at,
  );
}

function assertOrderTicketable(order: OrderRow): void {
  if (!TICKET_ORDER_STATUSES.has(order.status)) {
    throw errors.validation("已取消的订单不能发起工单；待付款、已支付或已完成的订单都可以发起");
  }
}

/** 建单：如果该订单已有进行中的工单，直接返回那一条（幂等，避免重复点击产生多条） */
export function createTicket(user: UserRow, input: CreateTicketInput, ip: string): { ticket: TicketDto; existing: boolean } {
  const order = requireOrderForUser(input.orderId, user);
  assertOrderTicketable(order);

  const open = queryOne<TicketRow>(
    "SELECT * FROM tickets WHERE order_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1",
    order.id,
  );
  if (open) {
    return { ticket: getTicket(open.id, user), existing: true };
  }

  const total = queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM tickets WHERE order_id = ?", order.id);
  if ((total?.total ?? 0) >= MAX_TICKETS_PER_ORDER) {
    throw errors.validation(`同一订单最多只能发起 ${MAX_TICKETS_PER_ORDER} 个工单，请先和对方协商`);
  }
  const description = input.description.trim();
  if (description.length < 5) throw errors.validation("请简单描述一下争议情况（至少 5 个字）");
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw errors.validation(`争议描述不能超过 ${MAX_DESCRIPTION_LENGTH} 个字`);
  }

  const now = nowIso();
  const ticketId = newId();
  transaction(() => {
    execute(
      `INSERT INTO tickets (id, order_id, category, status, opened_by, created_at, updated_at,
                            last_message_at, message_count, parties_reveal_status)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, 1, 'hidden')`,
      ticketId,
      order.id,
      input.category,
      user.id,
      now,
      now,
      now,
    );
    execute(
      "INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_kind, body, created_at) VALUES (?, ?, ?, 'user', ?, ?)",
      newId(),
      ticketId,
      user.id,
      description,
      now,
    );
    markSenderRead(ticketId, user.id, now);
  });

  writeAudit({
    action: "ticket.created",
    actorId: user.id,
    actorRole: "user",
    targetType: "ticket",
    targetId: ticketId,
    detail: `订单 ${order.order_no} 发起工单（${TICKET_CATEGORY_LABELS[input.category]}）`,
    ip,
  });
  const counterparty = counterpartyOf(order, user.id);
  pushToUser(counterparty.id, "ticket_update", {
    ticketId,
    orderId: order.id,
    orderNo: order.order_no,
    preview: description.slice(0, 60),
    createdAt: now,
  });
  pushNotification(counterparty.id, {
    title: "收到新的交易工单",
    body: `${displayNameOf(user)}：${description.slice(0, 60)}`,
    url: `/tickets/${ticketId}`,
  });
  mailTicketNotice(counterparty.id, ticketId, order, displayNameOf(user), description, true);

  return { ticket: getTicket(ticketId, user), existing: false };
}

export interface ListTicketsQuery {
  status?: "open" | "closed";
  limit?: number;
}

export function listTickets(user: UserRow, query: ListTicketsQuery = {}): TicketSummaryDto[] {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const params: unknown[] = [user.id, user.id];
  let where = "(o.payer_id = ? OR o.merchant_id = ?)";
  if (query.status) {
    where += " AND t.status = ?";
    params.push(query.status);
  }
  params.push(limit);
  const rows = queryAll<TicketRow>(
    `SELECT t.* FROM tickets t JOIN orders o ON o.id = t.order_id
      WHERE ${where}
      ORDER BY t.status = 'open' DESC, t.last_message_at DESC
      LIMIT ?`,
    ...params,
  );
  const result: TicketSummaryDto[] = [];
  for (const row of rows) {
    const order = findOrderById(row.order_id);
    if (!order) continue;
    // 非参与方虽然 SQL 已过滤，这里再兜底一次
    if (order.payer_id !== user.id && order.merchant_id !== user.id) continue;
    result.push(toSummary(row, order, user));
  }
  return result;
}

export function getTicket(ticketId: string, user: UserRow): TicketDto {
  const { ticket, order } = requireTicketForUser(ticketId, user);
  const messages = queryAll<TicketMessageRow>(
    "SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC LIMIT ?",
    ticket.id,
    MAX_MESSAGES_RETURNED,
  );
  return {
    ...toSummary(ticket, order, user),
    role: roleOf(order, user.id),
    parties: partiesForViewer(ticket, order),
    partiesReveal: revealOf(ticket, user.id),
    // 资料未披露时对话里的姓名一律打码（批准后才显示完整姓名）
    messages: messages.map((message) =>
      toMessageDto(message, order, { maskNames: ticket.parties_reveal_status !== "approved" }),
    ),
    closedAt: ticket.closed_at,
    closedReason: ticket.closed_reason,
    resolutionNote: ticket.resolution_note,
  };
}

export function sendTicketMessage(ticketId: string, user: UserRow, body: string, ip: string): TicketDto {
  const { ticket, order } = requireTicketForUser(ticketId, user);
  if (ticket.status !== "open") throw errors.validation("工单已关闭，不能再发消息");
  const text = body.trim();
  if (!text) throw errors.validation("消息内容不能为空");
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw errors.validation(`单条消息不能超过 ${MAX_MESSAGE_LENGTH} 个字`);
  }
  const now = nowIso();
  transaction(() => {
    execute(
      "INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_kind, body, created_at) VALUES (?, ?, ?, 'user', ?, ?)",
      newId(),
      ticket.id,
      user.id,
      text,
      now,
    );
    execute(
      "UPDATE tickets SET message_count = message_count + 1, last_message_at = ?, updated_at = ? WHERE id = ?",
      now,
      now,
      ticket.id,
    );
    markSenderRead(ticket.id, user.id, now);
  });
  writeAudit({
    action: "ticket.message",
    actorId: user.id,
    actorRole: "user",
    targetType: "ticket",
    targetId: ticket.id,
    detail: `订单 ${order.order_no} 工单消息`,
    ip,
  });
  const counterparty = counterpartyOf(order, user.id);
  pushToUser(counterparty.id, "ticket_update", {
    ticketId: ticket.id,
    orderId: order.id,
    orderNo: order.order_no,
    preview: text.slice(0, 60),
    createdAt: now,
  });
  pushNotification(counterparty.id, {
    title: "工单有新消息",
    body: `${displayNameOf(user)}：${text.slice(0, 60)}`,
    url: `/tickets/${ticket.id}`,
  });
  mailTicketNotice(counterparty.id, ticket.id, order, displayNameOf(user), text, false);
  return getTicket(ticket.id, user);
}

export function markTicketRead(ticketId: string, user: UserRow): { unreadCount: number; totalUnreadCount: number } {
  const { ticket } = requireTicketForUser(ticketId, user);
  markSenderRead(ticket.id, user.id, nowIso());
  return { unreadCount: 0, totalUnreadCount: unreadCountTotal(user) };
}

export function closeTicket(ticketId: string, user: UserRow, ip: string): TicketDto {
  const { ticket, order } = requireTicketForUser(ticketId, user);
  if (ticket.status === "open") {
    const now = nowIso();
    execute(
      `UPDATE tickets SET status = 'closed', closed_by = ?, closed_at = ?, closed_reason = 'user', updated_at = ?
        WHERE id = ? AND status = 'open'`,
      user.id,
      now,
      now,
      ticket.id,
    );
    writeAudit({
      action: "ticket.closed",
      actorId: user.id,
      actorRole: "user",
      targetType: "ticket",
      targetId: ticket.id,
      detail: `订单 ${order.order_no} 工单由用户关闭`,
      ip,
    });
    const counterparty = counterpartyOf(order, user.id);
    pushToUser(counterparty.id, "ticket_update", {
      ticketId: ticket.id,
      orderId: order.id,
      orderNo: order.order_no,
      status: "closed",
      createdAt: now,
    });
    pushNotification(counterparty.id, {
      title: "工单已结束",
      body: `订单 ${order.order_no} 的工单已结束`,
      url: `/tickets/${ticket.id}`,
    });
  }
  return getTicket(ticket.id, user);
}

export function unreadCountTotal(user: UserRow): number {
  const row = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total
       FROM ticket_messages m
       JOIN tickets t ON t.id = m.ticket_id
       JOIN orders o ON o.id = t.order_id
      WHERE t.status = 'open'
        AND m.sender_id != ?
        AND (o.payer_id = ? OR o.merchant_id = ?)
        AND m.created_at > COALESCE(
          (SELECT r.last_read_at FROM ticket_reads r WHERE r.ticket_id = t.id AND r.user_id = ?),
          ''
        )`,
    user.id,
    user.id,
    user.id,
    user.id,
  );
  return row?.total ?? 0;
}

// ---------------- 管理端（只读） ----------------

export interface AdminListTicketsQuery {
  status?: "open" | "closed";
  keyword?: string;
  page?: number;
  pageSize?: number;
}

interface AdminTicketRow extends TicketRow {
  order_no: string;
  order_title: string;
  amount_cents: number;
  payer_id: string;
  merchant_id: string;
  payer_name_snapshot: string;
  merchant_name_snapshot: string;
}

function toAdminSummary(row: AdminTicketRow): AdminTicketSummaryDto {
  const opener = findUserById(row.opened_by);
  return {
    id: row.id,
    orderId: row.order_id,
    orderNo: row.order_no,
    orderTitle: row.order_title,
    amountCents: row.amount_cents,
    category: row.category,
    categoryLabel: TICKET_CATEGORY_LABELS[row.category] ?? "其他问题",
    status: row.status,
    openerName: opener ? displayNameOf(opener) : "未知用户",
    payerName: row.payer_name_snapshot,
    merchantName: row.merchant_name_snapshot,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    messageCount: row.message_count,
    partiesRevealStatus: row.parties_reveal_status,
  };
}

export function listTicketsForAdmin(query: AdminListTicketsQuery): {
  items: AdminTicketSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
} {
  const page = Math.max(query.page ?? 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (query.status) {
    where.push("t.status = ?");
    params.push(query.status);
  }
  const keyword = query.keyword?.trim();
  if (keyword) {
    where.push("(o.order_no LIKE ? ESCAPE '\\' OR o.title LIKE ? ESCAPE '\\' OR t.id LIKE ? ESCAPE '\\')");
    const like = likePattern(keyword);
    params.push(like, like, like);
  }
  const whereSql = where.join(" AND ");
  const total = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM tickets t JOIN orders o ON o.id = t.order_id WHERE ${whereSql}`,
    ...params,
  );
  const rows = queryAll<AdminTicketRow>(
    `SELECT t.*, o.order_no, o.title AS order_title, o.amount_cents, o.payer_id, o.merchant_id,
            o.payer_name_snapshot, o.merchant_name_snapshot
       FROM tickets t JOIN orders o ON o.id = t.order_id
      WHERE ${whereSql}
      ORDER BY t.status = 'open' DESC, t.last_message_at DESC
      LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );
  return { items: rows.map(toAdminSummary), total: total?.total ?? 0, page, pageSize };
}

export function getTicketForAdmin(ticketId: string): AdminTicketDto {
  const row = queryOne<AdminTicketRow>(
    `SELECT t.*, o.order_no, o.title AS order_title, o.amount_cents, o.payer_id, o.merchant_id,
            o.payer_name_snapshot, o.merchant_name_snapshot
       FROM tickets t JOIN orders o ON o.id = t.order_id
      WHERE t.id = ?`,
    ticketId,
  );
  if (!row) throw errors.notFound("工单不存在");
  const order = findOrderById(row.order_id);
  if (!order) throw errors.notFound("工单关联的订单不存在");
  const messages = queryAll<TicketMessageRow>(
    "SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC, id ASC LIMIT ?",
    row.id,
    MAX_MESSAGES_RETURNED,
  );
  return {
    ...toAdminSummary(row),
    parties: partiesOf(order),
    partiesReveal: revealOf(row, ""),
    messages: messages.map((message) => toMessageDto(message, order)),
    closedAt: row.closed_at,
    closedReason: row.closed_reason,
    resolutionNote: row.resolution_note,
  };
}

function notifyParties(order: OrderRow, ticketId: string, payload: Record<string, unknown>): void {
  for (const userId of [order.payer_id, order.merchant_id]) {
    pushToUser(userId, "ticket_update", { ticketId, orderId: order.id, orderNo: order.order_no, ...payload });
  }
}

/** 工单邮件提醒：按收件人的「工单通知」开关发信（发送在后台进行，失败不影响主流程） */
function mailTicketNotice(
  recipientId: string,
  ticketId: string,
  order: OrderRow,
  fromName: string,
  preview: string,
  opened: boolean,
): void {
  mailUserWithSetting(
    recipientId,
    templates.ticketUpdated({
      to: "",
      ticketId,
      orderNo: order.order_no,
      orderTitle: order.title,
      fromName,
      preview,
      opened,
    }),
    "ticket",
  );
}

function loadTicketForAdmin(ticketId: string): { ticket: TicketRow; order: OrderRow } {
  const ticket = findTicketById(ticketId);
  if (!ticket) throw errors.notFound("工单不存在");
  const order = findOrderById(ticket.order_id);
  if (!order) throw errors.notFound("工单关联的订单不存在");
  return { ticket, order };
}

/** 平台介入：运营可以在工单里以「平台客服」身份发言（会通知订单双方） */
export function sendAdminTicketMessage(
  ticketId: string,
  adminUser: UserRow,
  body: string,
  ip: string,
): AdminTicketDto {
  const { ticket, order } = loadTicketForAdmin(ticketId);
  if (ticket.status !== "open") throw errors.validation("工单已关闭，不能再发消息");
  const text = body.trim();
  if (!text) throw errors.validation("消息内容不能为空");
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw errors.validation(`单条消息不能超过 ${MAX_MESSAGE_LENGTH} 个字`);
  }
  const now = nowIso();
  transaction(() => {
    execute(
      "INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_kind, body, created_at) VALUES (?, ?, ?, 'admin', ?, ?)",
      newId(),
      ticket.id,
      adminUser.id,
      text,
      now,
    );
    execute(
      "UPDATE tickets SET message_count = message_count + 1, last_message_at = ?, updated_at = ? WHERE id = ?",
      now,
      now,
      ticket.id,
    );
  });
  writeAudit({
    action: "ticket.message",
    actorId: adminUser.id,
    actorRole: "admin",
    targetType: "ticket",
    targetId: ticket.id,
    detail: `订单 ${order.order_no} 平台客服介入回复`,
    ip,
  });
  notifyParties(order, ticket.id, { preview: text.slice(0, 60), createdAt: now, role: "admin" });
  // 平台介入的消息同时给订单双方发邮件提醒
  for (const userId of new Set([order.payer_id, order.merchant_id])) {
    mailTicketNotice(userId, ticket.id, order, "平台客服", text, false);
  }
  return getTicketForAdmin(ticket.id);
}

/** 平台介入：运营可以直接结束工单（可附处理说明） */
export function closeTicketByAdmin(
  ticketId: string,
  adminUser: UserRow,
  note: string | null,
  ip: string,
): AdminTicketDto {
  const { ticket, order } = loadTicketForAdmin(ticketId);
  if (ticket.status === "open") {
    const now = nowIso();
    execute(
      `UPDATE tickets SET status = 'closed', closed_by = ?, closed_at = ?, closed_reason = 'admin',
              resolution_note = ?, updated_at = ?
        WHERE id = ? AND status = 'open'`,
      adminUser.id,
      now,
      note?.trim() ? note.trim() : null,
      now,
      ticket.id,
    );
    writeAudit({
      action: "ticket.closed",
      actorId: adminUser.id,
      actorRole: "admin",
      targetType: "ticket",
      targetId: ticket.id,
      detail: `订单 ${order.order_no} 工单由平台客服结束${note?.trim() ? `：${note.trim()}` : ""}`,
      ip,
    });
    notifyParties(order, ticket.id, { status: "closed", createdAt: now, role: "admin" });
  }
  return getTicketForAdmin(ticket.id);
}

/** 订单任意一方可以申请披露双方资料，由平台审核（审核前双方都看不到对方完整资料） */
export function requestPartiesReveal(ticketId: string, user: UserRow, ip: string): TicketDto {
  const { ticket, order } = requireTicketForUser(ticketId, user);
  if (ticket.status !== "open") throw errors.validation("工单已关闭，不能再申请披露资料");
  if (ticket.parties_reveal_status === "approved") {
    throw errors.validation("双方资料已经披露过，不需要再申请");
  }
  if (ticket.parties_reveal_status === "pending") {
    throw errors.validation("资料披露申请已经提交，请等待平台审核");
  }
  const now = nowIso();
  execute(
    `UPDATE tickets SET parties_reveal_status = 'pending', parties_reveal_requested_by = ?,
            parties_reveal_requested_at = ?, parties_reveal_note = NULL, updated_at = ?
      WHERE id = ?`,
    user.id,
    now,
    now,
    ticket.id,
  );
  writeAudit({
    action: "ticket.reveal_requested",
    actorId: user.id,
    actorRole: "user",
    targetType: "ticket",
    targetId: ticket.id,
    detail: `订单 ${order.order_no} 申请披露双方资料`,
    ip,
  });
  return getTicket(ticket.id, user);
}

/** 平台审核资料披露申请：批准后双方资料才可见，并在对话里留一条系统提示、通知双方 */
export function reviewPartiesReveal(
  ticketId: string,
  adminUser: UserRow,
  decision: "approve" | "reject",
  note: string | null,
  ip: string,
): AdminTicketDto {
  const { ticket, order } = loadTicketForAdmin(ticketId);
  if (ticket.parties_reveal_status !== "pending") {
    throw errors.validation("当前没有待审核的资料披露申请");
  }
  const trimmed = note?.trim() ? note.trim() : null;
  if (trimmed && trimmed.length > REVEAL_NOTE_MAX) {
    throw errors.validation(`审核说明不能超过 ${REVEAL_NOTE_MAX} 个字`);
  }
  const approved = decision === "approve";
  const now = nowIso();
  const systemBody = approved
    ? `平台已批准资料披露${trimmed ? `：${trimmed}` : ""}，双方资料现已可见。`
    : `平台未批准资料披露${trimmed ? `：${trimmed}` : ""}。`;
  transaction(() => {
    execute(
      `UPDATE tickets SET parties_reveal_status = ?, parties_reveal_note = ?,
              parties_revealed_at = ?, parties_revealed_by = ?, updated_at = ?
        WHERE id = ?`,
      approved ? "approved" : "rejected",
      trimmed,
      approved ? now : null,
      adminUser.id,
      now,
      ticket.id,
    );
    execute(
      "INSERT INTO ticket_messages (id, ticket_id, sender_id, sender_kind, body, created_at) VALUES (?, ?, ?, 'system', ?, ?)",
      newId(),
      ticket.id,
      adminUser.id,
      systemBody,
      now,
    );
    execute(
      "UPDATE tickets SET message_count = message_count + 1, last_message_at = ? WHERE id = ?",
      now,
      ticket.id,
    );
  });
  writeAudit({
    action: approved ? "ticket.reveal_approved" : "ticket.reveal_rejected",
    actorId: adminUser.id,
    actorRole: "admin",
    targetType: "ticket",
    targetId: ticket.id,
    detail: `订单 ${order.order_no} ${approved ? "批准" : "驳回"}资料披露申请${trimmed ? `：${trimmed}` : ""}`,
    ip,
  });
  notifyParties(order, ticket.id, { preview: systemBody.slice(0, 60), createdAt: now, role: "system" });
  for (const userId of new Set([order.payer_id, order.merchant_id])) {
    mailTicketNotice(userId, ticket.id, order, "平台客服", systemBody, false);
  }
  return getTicketForAdmin(ticket.id);
}

/** 后台任务：把 7 天没有新消息的工单自动关闭，返回关闭条数 */export function closeStaleTickets(now = new Date()): number {
  const cutoff = new Date(now.getTime() - TICKET_AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = execute(
    `UPDATE tickets SET status = 'closed', closed_at = ?, closed_reason = 'timeout', updated_at = ?
      WHERE status = 'open' AND last_message_at < ?`,
    now.toISOString(),
    now.toISOString(),
    cutoff,
  );
  return Number(result.changes ?? 0);
}
