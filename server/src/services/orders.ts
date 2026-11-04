import { config } from "../config.js";
import { execute, nowIso, queryAll, queryOne, transaction } from "../db/index.js";
import { writeAudit, writeRiskLog } from "../lib/audit.js";
import { newId } from "../lib/crypto.js";
import { errors } from "../lib/errors.js";
import { sendMailInBackground, templates } from "../lib/mail.js";
import { readPaymentProofFile, removePaymentProofFile, savePaymentProofFile } from "../lib/payment-proof.js";
import {
  CHANNEL_LABELS,
  CHANNELS,
  type Channel,
  type MerchantRow,
  type OrderEventRow,
  type OrderRow,
  type OrderStatus,
  type ProductRow,
  type PublicUser,
  type UserRow,
} from "../lib/types.js";
import { pushToUser } from "./events.js";
import {
  channelQrContent,
  enabledChannels,
  merchantNameOf,
  payerNameSnapshotOf,
} from "./merchant.js";
import {
  displayNameOf,
  ensureNotificationSettings,
  findUserById,
  publicUserOf,
} from "./users.js";

export interface OrderItemDto {
  name: string;
  priceCents: number;
  quantity: number;
}

export interface OrderEventDto {
  id: string;
  type: string;
  actorRole: string;
  detail: string | null;
  createdAt: string;
}

export interface OrderDto {
  id: string;
  orderNo: string;
  amountCents: number;
  status: OrderStatus;
  title: string;
  items: OrderItemDto[] | null;
  reservedNote: string | null;
  actualNote: string | null;
  payChannel: Channel | null;
  cancelReason: string | null;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  role: "payer" | "merchant";
  counterparty: PublicUser;
  merchantName: string;
  payerNameSnapshot: string;
  noteRequirement: string;
  events: OrderEventDto[];
  hasAppeal: boolean;
  /** 商家当前启用的收款方式（付款人视角用于展示二维码 Tab） */
  availableChannels: Channel[];
  createdBy: "payer" | "merchant";
  /** 付款人是否已上传付款截图（商家确认收款前需要核对） */
  hasPaymentProof: boolean;
  /** 付款截图读取地址（仅订单双方可用），没有截图时为 null */
  paymentProofUrl: string | null;
}

export interface OrderSummaryDto {
  id: string;
  orderNo: string;
  amountCents: number;
  status: OrderStatus;
  title: string;
  createdAt: string;
  paidAt: string | null;
  role: "payer" | "merchant";
  counterparty: PublicUser;
  noteRequirement: string;
  hasAppeal: boolean;
}

function parseItems(json: string | null): OrderItemDto[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as OrderItemDto[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function eventsOf(orderId: string): OrderEventDto[] {
  return queryAll<OrderEventRow>(
    "SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at ASC",
    orderId,
  ).map((row) => ({
    id: row.id,
    type: row.type,
    actorRole: row.actor_role,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

function hasOpenAppeal(orderId: string): boolean {
  return (
    queryOne<{ id: string }>(
      "SELECT id FROM appeals WHERE order_id = ? AND status = 'open' LIMIT 1",
      orderId,
    ) !== undefined
  );
}

export function roleOf(order: OrderRow, userId: string): "payer" | "merchant" {
  return order.payer_id === userId ? "payer" : "merchant";
}

export function toOrderDto(order: OrderRow, viewerId: string): OrderDto {
  const role = roleOf(order, viewerId);
  const payerUser = findUserById(order.payer_id);
  const merchantUser = findUserById(order.merchant_id);
  const counterpartyUser =
    role === "payer" ? merchantUser : payerUser;
  const counterparty: PublicUser = counterpartyUser
    ? {
        ...publicUserOf(counterpartyUser),
        displayName:
          role === "payer"
            ? order.merchant_name_snapshot || merchantNameOf(counterpartyUser)
            : order.payer_name_snapshot || displayNameOf(counterpartyUser),
      }
    : {
        id: role === "payer" ? order.merchant_id : order.payer_id,
        displayName: role === "payer" ? order.merchant_name_snapshot : order.payer_name_snapshot,
        avatarUrl: null,
        studentNoMasked: "",
        isMerchant: role === "payer",
      };
  return {
    id: order.id,
    orderNo: order.order_no,
    amountCents: order.amount_cents,
    status: order.status,
    title: order.title,
    items: parseItems(order.items_json),
    reservedNote: order.reserved_note,
    actualNote: order.actual_note,
    payChannel: order.pay_channel,
    cancelReason: order.cancel_reason,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    completedAt: order.completed_at,
    cancelledAt: order.cancelled_at,
    role,
    counterparty,
    merchantName: order.merchant_name_snapshot,
    payerNameSnapshot: order.payer_name_snapshot,
    noteRequirement: order.note_requirement_snapshot ?? "",
    events: eventsOf(order.id),
    hasAppeal: hasOpenAppeal(order.id),
    availableChannels: enabledChannels(order.merchant_id),
    createdBy: order.created_by,
    hasPaymentProof: Boolean(order.payment_proof),
    paymentProofUrl: order.payment_proof ? `/api/orders/${order.id}/payment-proof` : null,
  };
}

/** 批量查用户，避免列表接口里 N+1 查询 */
function findUsersByIds(ids: string[]): Map<string, UserRow> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
  const users = new Map<string, UserRow>();
  const chunkSize = 200;
  for (let start = 0; start < unique.length; start += chunkSize) {
    const chunk = unique.slice(start, start + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = queryAll<UserRow>(
      `SELECT * FROM users WHERE id IN (${placeholders})`,
      ...(chunk as never[]),
    );
    for (const row of rows) users.set(row.id, row);
  }
  return users;
}

/** 批量查「有未处理申诉」的订单，避免列表接口里逐条查询 */
function openAppealOrderIds(orderIds: string[]): Set<string> {
  const unique = Array.from(new Set(orderIds));
  const result = new Set<string>();
  const chunkSize = 200;
  for (let start = 0; start < unique.length; start += chunkSize) {
    const chunk = unique.slice(start, start + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = queryAll<{ order_id: string }>(
      `SELECT order_id FROM appeals WHERE status = 'open' AND order_id IN (${placeholders})`,
      ...(chunk as never[]),
    );
    for (const row of rows) result.add(row.order_id);
  }
  return result;
}

function summaryOf(
  order: OrderRow,
  viewerId: string,
  usersById: Map<string, UserRow>,
  openAppeals: Set<string>,
): OrderSummaryDto {
  const role = roleOf(order, viewerId);
  const counterpartyUser = usersById.get(role === "payer" ? order.merchant_id : order.payer_id);
  const counterparty: PublicUser = counterpartyUser
    ? {
        ...publicUserOf(counterpartyUser),
        displayName:
          role === "payer"
            ? order.merchant_name_snapshot || merchantNameOf(counterpartyUser)
            : order.payer_name_snapshot || displayNameOf(counterpartyUser),
      }
    : {
        id: role === "payer" ? order.merchant_id : order.payer_id,
        displayName: role === "payer" ? order.merchant_name_snapshot : order.payer_name_snapshot,
        avatarUrl: null,
        studentNoMasked: "",
        isMerchant: role === "payer",
      };
  return {
    id: order.id,
    orderNo: order.order_no,
    amountCents: order.amount_cents,
    status: order.status,
    title: order.title,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    role,
    counterparty,
    noteRequirement: order.note_requirement_snapshot ?? "",
    hasAppeal: openAppeals.has(order.id),
  };
}

export function toOrderSummary(order: OrderRow, viewerId: string): OrderSummaryDto {
  return summaryOf(
    order,
    viewerId,
    findUsersByIds([order.payer_id, order.merchant_id]),
    openAppealOrderIds([order.id]),
  );
}

export function findOrderById(orderId: string): OrderRow | undefined {
  return queryOne<OrderRow>("SELECT * FROM orders WHERE id = ?", orderId);
}

export function requireOrderForUser(orderId: string, user: UserRow): OrderRow {
  const order = findOrderById(orderId);
  if (!order) throw errors.notFound("订单不存在");
  if (order.payer_id !== user.id && order.merchant_id !== user.id) {
    throw errors.forbidden("无权查看该订单");
  }
  return order;
}

function addEvent(orderId: string, type: string, actorRole: string, actorId: string | null, detail?: string | null): void {
  execute(
    "INSERT INTO order_events (id, order_id, type, actor_id, actor_role, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    newId(),
    orderId,
    type,
    actorId,
    actorRole,
    detail ?? null,
    nowIso(),
  );
}

function notifyOrderUpdate(order: OrderRow): void {
  const payloadFor = (userId: string): Record<string, unknown> => {
    const role = roleOf(order, userId);
    return {
      orderId: order.id,
      orderNo: order.order_no,
      status: order.status,
      role,
      amountCents: order.amount_cents,
      title: order.title,
      counterpartyName:
        role === "payer" ? order.merchant_name_snapshot : order.payer_name_snapshot,
      updatedAt: order.updated_at,
    };
  };
  pushToUser(order.payer_id, "order_update", payloadFor(order.payer_id));
  pushToUser(order.merchant_id, "order_update", payloadFor(order.merchant_id));
}

// ---------------- 下单 ----------------

interface ItemInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderInput {
  merchantUserId: string;
  items?: ItemInput[];
  amountCents?: number;
  reservedNote?: string | null;
}

export interface MerchantCreateOrderInput {
  customer: UserRow;
  items?: ItemInput[];
  amountCents?: number;
  reservedNote?: string | null;
}

interface ResolvedItems {
  items: OrderItemDto[] | null;
  amountCents: number;
}

function resolveItems(merchantId: string, items: ItemInput[] | undefined, amountCents: number | undefined): ResolvedItems {
  if (items && items.length > 0) {
    if (items.length > 20) throw errors.validation("一次最多选择 20 种商品");
    const resolved: OrderItemDto[] = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw errors.validation("商品数量必须为 1~99 的整数");
      }
      const product = queryOne<ProductRow>(
        "SELECT * FROM products WHERE id = ? AND merchant_id = ? AND active = 1",
        item.productId,
        merchantId,
      );
      if (!product) throw errors.validation("所选商品不存在或已下架");
      resolved.push({ name: product.name, priceCents: product.price_cents, quantity });
    }
    const total = resolved.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
    return { items: resolved, amountCents: total };
  }
  if (!Number.isInteger(amountCents) || (amountCents as number) < 1) {
    throw errors.validation("请填写支付金额（单位：分）");
  }
  return { items: null, amountCents: amountCents as number };
}

function assertAmountLimits(payerId: string, amountCents: number): void {
  if (amountCents > config.security.orderMaxAmountCents) {
    writeRiskLog({
      userId: payerId,
      type: "limit_exceeded",
      detail: `单笔金额 ${amountCents} 分超过上限 ${config.security.orderMaxAmountCents} 分`,
    });
    throw errors.limitExceeded(
      `单笔支付金额不能超过 ${(config.security.orderMaxAmountCents / 100).toFixed(2)} 元`,
    );
  }
  const dayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const row = queryOne<{ total: number | null }>(
    "SELECT SUM(amount_cents) AS total FROM orders WHERE payer_id = ? AND status != 'cancelled' AND created_at >= ?",
    payerId,
    dayStart,
  );
  const used = row?.total ?? 0;
  if (used + amountCents > config.security.dailyMaxAmountCents) {
    writeRiskLog({
      userId: payerId,
      type: "limit_exceeded",
      detail: `当日累计金额将超过上限 ${config.security.dailyMaxAmountCents} 分`,
    });
    throw errors.limitExceeded(
      `当日累计支付金额不能超过 ${(config.security.dailyMaxAmountCents / 100).toFixed(2)} 元`,
    );
  }
}

/**
 * 转账限额：单笔与当日累计都只统计「转账」订单，互不影响商家订单限额。
 * 日界按服务器本地时区的自然日计算，符合用户「一天」的直觉。
 */
function assertTransferAmountLimits(payerId: string, amountCents: number): void {
  const max = config.security.transferMaxAmountCents;
  if (amountCents > max) {
    writeRiskLog({
      userId: payerId,
      type: "limit_exceeded",
      detail: `转账单笔 ${amountCents} 分超过上限 ${max} 分`,
    });
    throw errors.limitExceeded(`单笔转账金额不能超过 ${(max / 100).toFixed(2)} 元`);
  }
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = queryOne<{ total: number | null }>(
    "SELECT SUM(amount_cents) AS total FROM orders WHERE payer_id = ? AND title = '转账' AND status != 'cancelled' AND created_at >= ?",
    payerId,
    start.toISOString(),
  );
  const used = row?.total ?? 0;
  const dailyMax = config.security.transferDailyMaxAmountCents;
  if (used + amountCents > dailyMax) {
    writeRiskLog({
      userId: payerId,
      type: "limit_exceeded",
      detail: `转账当日累计将超过上限 ${dailyMax} 分`,
    });
    throw errors.limitExceeded(`当日累计转账金额不能超过 ${(dailyMax / 100).toFixed(2)} 元`);
  }
}

function generateOrderNo(): string {
  const now = new Date();
  const pad = (value: number, size = 2): string => String(value).padStart(size, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `GZ${date}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(
      Math.floor(Math.random() * 10000),
      4,
    )}`;
    const existing = queryOne<{ id: string }>("SELECT id FROM orders WHERE order_no = ?", candidate);
    if (!existing) return candidate;
  }
  return `GZ${newId().replace(/-/g, "").slice(0, 18).toUpperCase()}`;
}

interface BuildOrderParams {
  payer: UserRow;
  merchantUser: UserRow;
  items?: ItemInput[];
  amountCents?: number;
  reservedNote?: string | null;
  createdBy: "payer" | "merchant";
  /** 已快照好的商品明细（商家收款单）：跳过实时商品解析，用创建收款单时的名称与价格 */
  preparedItems?: OrderItemDto[] | null;
  /** 收款单标题（未提供时按商品/自定义付款生成） */
  preparedTitle?: string;
}

function buildOrder(params: BuildOrderParams): OrderRow {
  const merchant = queryOne<MerchantRow>(
    "SELECT * FROM merchants WHERE user_id = ?",
    params.merchantUser.id,
  );
  if (!merchant) throw errors.notFound("对方还不是商家，无法发起收款");
  if (params.merchantUser.status === "frozen") throw errors.locked("对方账号已被冻结");
  const channels = enabledChannels(merchant.user_id);
  if (channels.length === 0) throw errors.conflict("商家当前暂停收款，请稍后再试");
  if (params.payer.id === params.merchantUser.id) throw errors.conflict("不能向自己付款");

  const usePrepared = params.preparedItems !== undefined;
  let items: OrderItemDto[] | null;
  let amountCents: number;
  if (usePrepared) {
    items = params.preparedItems ?? null;
    amountCents = params.amountCents ?? 0;
  } else {
    const resolved = resolveItems(merchant.user_id, params.items, params.amountCents);
    items = resolved.items;
    amountCents = resolved.amountCents;
  }
  if (usePrepared && (!Number.isInteger(amountCents) || amountCents < 1)) {
    throw errors.validation("收款金额不正确");
  }
  assertAmountLimits(params.payer.id, amountCents);

  const reservedNote = (params.reservedNote ?? "").trim().slice(0, 200) || null;
  const title =
    params.preparedTitle ??
    (items ? `${items[0]?.name ?? "商品"}${items.length > 1 ? ` 等 ${items.length} 种商品` : ""}` : "自定义付款");
  const now = nowIso();
  const orderId = newId();
  const orderNo = generateOrderNo();
  transaction(() => {
    execute(
      `INSERT INTO orders (
        id, order_no, merchant_id, payer_id, amount_cents, title, items_json, reserved_note,
        actual_note, pay_channel, status, cancel_reason, created_by,
        merchant_name_snapshot, payer_name_snapshot, note_requirement_snapshot,
        created_at, updated_at, paid_at, completed_at, cancelled_at, flagged, closed_by_admin_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending_payment', NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, NULL)`,
      orderId,
      orderNo,
      merchant.user_id,
      params.payer.id,
      amountCents,
      title,
      items ? JSON.stringify(items) : null,
      reservedNote,
      params.createdBy,
      merchantNameOf(params.merchantUser),
      payerNameSnapshotOf(params.payer),
      merchant.note_requirement ?? "",
      now,
      now,
    );
    addEvent(
      orderId,
      "created",
      params.createdBy,
      params.createdBy === "payer" ? params.payer.id : params.merchantUser.id,
      `订单创建，金额 ￥${(amountCents / 100).toFixed(2)}`,
    );
  });

  const order = findOrderById(orderId) as OrderRow;
  notifyOrderUpdate(order);

  // 邮件通知：新订单
  const merchantSettings = ensureNotificationSettings(merchant.user_id);
  if (merchantSettings.new_order === 1 && params.merchantUser.email) {
    sendMailInBackground(
      templates.newOrder({
        to: params.merchantUser.email,
        orderNo: order.order_no,
        merchantName: order.merchant_name_snapshot,
        payerName: order.payer_name_snapshot,
        amountCents: order.amount_cents,
        title: order.title,
      }),
    );
  }
  const payerSettings = ensureNotificationSettings(params.payer.id);
  if (
    params.createdBy === "merchant" &&
    payerSettings.new_order === 1 &&
    params.payer.email
  ) {
    sendMailInBackground(
      templates.newOrder({
        to: params.payer.email,
        orderNo: order.order_no,
        merchantName: order.merchant_name_snapshot,
        payerName: order.payer_name_snapshot,
        amountCents: order.amount_cents,
        title: order.title,
      }),
    );
  }
  return order;
}

export function createOrderAsPayer(
  payer: UserRow,
  input: CreateOrderInput,
  ip: string,
): OrderRow {
  const merchantUser = findUserById(input.merchantUserId);
  if (!merchantUser) throw errors.notFound("商家不存在");
  const order = buildOrder({
    payer,
    merchantUser,
    items: input.items,
    amountCents: input.amountCents,
    reservedNote: input.reservedNote,
    createdBy: "payer",
  });
  writeAudit({
    actorId: payer.id,
    actorRole: "user",
    action: "order.created",
    targetType: "order",
    targetId: order.id,
    detail: `商家 ${order.merchant_name_snapshot}，金额 ￥${(order.amount_cents / 100).toFixed(2)}`,
    ip,
  });
  return order;
}

export function createOrderByMerchant(
  merchantUser: UserRow,
  input: MerchantCreateOrderInput,
  ip: string,
): OrderRow {
  if (input.customer.status === "frozen") throw errors.locked("对方账号已被冻结，无法发起收款");
  const order = buildOrder({
    payer: input.customer,
    merchantUser,
    items: input.items,
    amountCents: input.amountCents,
    reservedNote: input.reservedNote,
    createdBy: "merchant",
  });
  writeAudit({
    actorId: merchantUser.id,
    actorRole: "user",
    action: "order.created_by_merchant",
    targetType: "order",
    targetId: order.id,
    detail: `付款人 ${order.payer_name_snapshot}，金额 ￥${(order.amount_cents / 100).toFixed(2)}`,
    ip,
  });
  return order;
}

/** 收款单付款：用创建时快照好的金额与明细创建订单（付款人扫码后确认） */
export interface CollectionOrderInput {
  amountCents: number;
  title: string;
  items: OrderItemDto[] | null;
  reservedNote?: string | null;
}

export function createOrderFromCollection(
  payer: UserRow,
  merchantUser: UserRow,
  input: CollectionOrderInput,
  ip: string,
): OrderRow {
  const order = buildOrder({
    payer,
    merchantUser,
    amountCents: input.amountCents,
    reservedNote: input.reservedNote,
    createdBy: "payer",
    preparedItems: input.items,
    preparedTitle: input.title,
  });
  writeAudit({
    actorId: payer.id,
    actorRole: "user",
    action: "order.created_from_collection",
    targetType: "order",
    targetId: order.id,
    detail: `收款单付款：商家 ${order.merchant_name_snapshot}，金额 ￥${(order.amount_cents / 100).toFixed(2)}`,
    ip,
  });
  return order;
}

export interface CreateTransferInput {
  payee: UserRow;
  amountCents: number;
  note?: string | null;
}

/**
 * 转账：向指定学号的用户转账（付款人发起，收款人确认收款）。
 * 复用订单模型：merchant_id 记收款人、payer_id 记付款人，状态从 pending_payment 开始，
 * 因此会自动出现在双方的「待付款 / 待收款」列表里。转账没有商品，也不需要商家资质。
 */
export function createTransfer(payer: UserRow, input: CreateTransferInput, ip: string): OrderRow {
  const payee = input.payee;
  if (payee.id === payer.id) throw errors.conflict("不能给自己转账");
  if (payee.status === "frozen") throw errors.locked("对方账号已被冻结，暂时无法转账");
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1) {
    throw errors.validation("请填写转账金额");
  }
  assertTransferAmountLimits(payer.id, input.amountCents);

  const note = (input.note ?? "").trim().slice(0, 200) || null;
  const now = nowIso();
  const orderId = newId();
  const orderNo = generateOrderNo();
  const payeeName = displayNameOf(payee);

  transaction(() => {
    execute(
      `INSERT INTO orders (
        id, order_no, merchant_id, payer_id, amount_cents, title, items_json, reserved_note,
        actual_note, pay_channel, status, cancel_reason, created_by,
        merchant_name_snapshot, payer_name_snapshot, note_requirement_snapshot,
        created_at, updated_at, paid_at, completed_at, cancelled_at, flagged, closed_by_admin_id
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 'pending_payment', NULL, 'payer', ?, ?, '', ?, ?, NULL, NULL, NULL, 0, NULL)`,
      orderId,
      orderNo,
      payee.id,
      payer.id,
      input.amountCents,
      "转账",
      note,
      payeeName,
      payerNameSnapshotOf(payer),
      now,
      now,
    );
    addEvent(
      orderId,
      "created",
      "payer",
      payer.id,
      `转账给 ${payeeName}，金额 ￥${(input.amountCents / 100).toFixed(2)}`,
    );
  });

  const order = findOrderById(orderId) as OrderRow;
  notifyOrderUpdate(order);

  // 邮件通知：收款人收到一笔待收款
  const payeeSettings = ensureNotificationSettings(payee.id);
  if (payeeSettings.new_order === 1 && payee.email) {
    sendMailInBackground(
      templates.newOrder({
        to: payee.email,
        orderNo: order.order_no,
        merchantName: order.merchant_name_snapshot,
        payerName: order.payer_name_snapshot,
        amountCents: order.amount_cents,
        title: order.title,
      }),
    );
  }

  writeAudit({
    actorId: payer.id,
    actorRole: "user",
    action: "order.transfer_created",
    targetType: "order",
    targetId: order.id,
    detail: `收款人 ${order.merchant_name_snapshot}，金额 ￥${(order.amount_cents / 100).toFixed(2)}`,
    ip,
  });
  return order;
}

/** 幂等：同一用户 + 同一 key + 同一接口直接复用上次响应 */
export function readIdempotentResponse<T>(userId: string, key: string, endpoint: string): T | undefined {
  const row = queryOne<{ response_json: string; status_code: number; endpoint: string }>(
    "SELECT * FROM idempotency_keys WHERE user_id = ? AND key = ?",
    userId,
    key,
  );
  if (!row) return undefined;
  if (row.endpoint !== endpoint) return undefined;
  try {
    return JSON.parse(row.response_json) as T;
  } catch {
    return undefined;
  }
}

export function writeIdempotentResponse(
  userId: string,
  key: string,
  endpoint: string,
  response: unknown,
): void {
  try {
    execute(
      "INSERT OR REPLACE INTO idempotency_keys (user_id, key, endpoint, response_json, status_code, created_at) VALUES (?, ?, ?, ?, 200, ?)",
      userId,
      key,
      endpoint,
      JSON.stringify(response),
      nowIso(),
    );
  } catch {
    // 幂等记录写入失败不影响下单结果
  }
}

// ---------------- 列表与查询 ----------------

export type OrderStatusFilter = "pending" | "paid" | "closed" | "settled" | "all";

export interface ListOrdersQuery {
  scope: "pay" | "receive";
  status?: OrderStatusFilter;
  /** 关键词：匹配订单号、标题、备注与对方姓名 */
  keyword?: string;
  page: number;
  pageSize: number;
}

const STATUS_FILTER_VALUES: Record<Exclude<OrderStatusFilter, "all">, OrderStatus[]> = {
  // 「进行中」= 还没有完成核对：待付款、已标记支付（等待商家确认收款）
  pending: ["pending_payment", "paid"],
  paid: ["paid"],
  closed: ["completed", "cancelled"],
  // 「已结束」= 已完成核对（确认收款）或已取消
  settled: ["completed", "cancelled"],
};

export function listOrders(
  user: UserRow,
  query: ListOrdersQuery,
): { items: OrderSummaryDto[]; total: number; page: number; pageSize: number } {
  const where: string[] = [query.scope === "pay" ? "payer_id = ?" : "merchant_id = ?"];
  const params: unknown[] = [user.id];
  if (query.status && query.status !== "all") {
    const values = STATUS_FILTER_VALUES[query.status];
    where.push(`status IN (${values.map(() => "?").join(",")})`);
    params.push(...values);
  }
  const keyword = (query.keyword ?? "").trim();
  if (keyword) {
    // LIKE 通配符转义，避免用户输入 % / _ 时把全部订单都匹配出来
    const like = `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    where.push(
      `(order_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR merchant_name_snapshot LIKE ? ESCAPE '\\' OR payer_name_snapshot LIKE ? ESCAPE '\\' OR COALESCE(reserved_note, '') LIKE ? ESCAPE '\\' OR COALESCE(actual_note, '') LIKE ? ESCAPE '\\')`,
    );
    params.push(like, like, like, like, like, like);
  }
  const whereSql = where.join(" AND ");
  const total =
    queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM orders WHERE ${whereSql}`, ...(params as never[]))
      ?.count ?? 0;
  const rows = queryAll<OrderRow>(
    `SELECT * FROM orders WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...(params as never[]),
    query.pageSize,
    (query.page - 1) * query.pageSize,
  );
  // 批量取对端用户与申诉状态，整页只查两次，避免逐条订单的 N+1 查询
  const counterpartyIds = rows.map((row) =>
    row.payer_id === user.id ? row.merchant_id : row.payer_id,
  );
  const usersById = findUsersByIds(counterpartyIds);
  const openAppeals = openAppealOrderIds(rows.map((row) => row.id));
  return {
    items: rows.map((row) => summaryOf(row, user.id, usersById, openAppeals)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export interface OrdersExportQuery {
  scope: "pay" | "receive";
  status?: OrderStatusFilter;
  keyword?: string;
  /** 指定订单（详情页单笔导出）；为空表示按筛选条件批量导出 */
  ids?: string[];
  /** 时间范围（ISO 字符串，含 from、不含 to），由前端按本地「今日/本周/本月/本年」换算 */
  from?: string;
  to?: string;
  /** 最多导出多少条，默认 2000 */
  limit?: number;
}

/** 导出用：不分页，最多 5000 条，返回原始行交给 order-export 格式化 */
export function listOrdersForExport(user: UserRow, query: OrdersExportQuery): OrderRow[] {
  const where: string[] = [query.scope === "pay" ? "payer_id = ?" : "merchant_id = ?"];
  const params: unknown[] = [user.id];
  if (query.ids && query.ids.length > 0) {
    const ids = query.ids.slice(0, 500);
    where.push(`id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (query.status && query.status !== "all") {
    const values = STATUS_FILTER_VALUES[query.status];
    where.push(`status IN (${values.map(() => "?").join(",")})`);
    params.push(...values);
  }
  const keyword = (query.keyword ?? "").trim();
  if (keyword) {
    const like = `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    where.push(
      `(order_no LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR merchant_name_snapshot LIKE ? ESCAPE '\\' OR payer_name_snapshot LIKE ? ESCAPE '\\' OR COALESCE(reserved_note, '') LIKE ? ESCAPE '\\' OR COALESCE(actual_note, '') LIKE ? ESCAPE '\\')`,
    );
    params.push(like, like, like, like, like, like);
  }
  if (query.from) {
    where.push("created_at >= ?");
    params.push(query.from);
  }
  if (query.to) {
    where.push("created_at < ?");
    params.push(query.to);
  }
  const limit = Math.min(Math.max(query.limit ?? 2000, 1), 5000);
  return queryAll<OrderRow>(
    `SELECT * FROM orders WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    ...(params as never[]),
    limit,
  );
}

// ---------------- 状态流转 ----------------
function assertMerchantRole(order: OrderRow, user: UserRow): void {
  if (order.merchant_id !== user.id) throw errors.forbidden("只有商家可以执行该操作");
}

function assertPayerRole(order: OrderRow, user: UserRow): void {
  if (order.payer_id !== user.id) throw errors.forbidden("只有付款人可以执行该操作");
}

function mailToUser(userId: string, message: Parameters<typeof sendMailInBackground>[0], setting: "new_order" | "paid" | "settled"): void {
  const user = findUserById(userId);
  if (!user?.email) return;
  const settings = ensureNotificationSettings(userId);
  if (settings[setting] !== 1) return;
  sendMailInBackground({ ...message, to: user.email });
}

/** 付款人上传付款截图：待付款订单可上传，重复上传会覆盖旧图 */
export function savePaymentProof(
  orderId: string,
  payer: UserRow,
  buffer: Buffer | undefined,
  ip: string,
): OrderRow {
  const order = requireOrderForUser(orderId, payer);
  assertPayerRole(order, payer);
  if (order.status !== "pending_payment") throw errors.orderStatusInvalid("订单当前状态不能上传付款截图");
  const filename = savePaymentProofFile(orderId, buffer);
  removePaymentProofFile(order.payment_proof);
  execute(
    "UPDATE orders SET payment_proof = ?, updated_at = ? WHERE id = ?",
    filename,
    nowIso(),
    orderId,
  );
  addEvent(orderId, "payment_proof_uploaded", "payer", payer.id, "付款人上传了付款截图");
  const updated = findOrderById(orderId) as OrderRow;
  notifyOrderUpdate(updated);
  writeAudit({
    actorId: payer.id,
    actorRole: "user",
    action: "order.payment_proof",
    targetType: "order",
    targetId: orderId,
    detail: "上传付款截图",
    ip,
  });
  return updated;
}

/** 读取付款截图：只有订单双方可以看，商家确认收款前用它核对 */
export function paymentProofForUser(
  orderId: string,
  user: UserRow,
): { data: Buffer; contentType: string } {
  const order = requireOrderForUser(orderId, user);
  if (!order.payment_proof) throw errors.notFound("付款人还没有上传付款截图");
  const file = readPaymentProofFile(order.payment_proof);
  if (!file) throw errors.notFound("付款截图已失效，请让付款人重新上传");
  return file;
}

export function markOrderPaid(
  orderId: string,
  payer: UserRow,
  input: { channel: Channel; actualNote?: string | null },
  ip: string,
): OrderRow {
  const order = requireOrderForUser(orderId, payer);
  assertPayerRole(order, payer);
  if (order.status !== "pending_payment") throw errors.orderStatusInvalid("订单当前状态不能标记为已支付");
  if (!order.payment_proof) {
    throw errors.validation("请先上传付款截图，商家确认收款前会核对");
  }
  const channels = enabledChannels(order.merchant_id);
  if (!channels.includes(input.channel)) {
    throw errors.validation("商家未启用该收款方式");
  }
  const actualNote = (input.actualNote ?? "").trim().slice(0, 200) || order.reserved_note;
  execute(
    "UPDATE orders SET status = 'paid', pay_channel = ?, actual_note = ?, paid_at = ?, updated_at = ? WHERE id = ?",
    input.channel,
    actualNote,
    nowIso(),
    nowIso(),
    orderId,
  );
  addEvent(
    orderId,
    "paid",
    "payer",
    payer.id,
    `付款人标记已支付（${CHANNEL_LABELS[input.channel]}），备注：${actualNote ?? "无"}`,
  );
  const updated = findOrderById(orderId) as OrderRow;
  notifyOrderUpdate(updated);
  const merchantUser = findUserById(updated.merchant_id);
  if (merchantUser) {
    mailToUser(
      merchantUser.id,
      templates.paid({
        to: merchantUser.email ?? "",
        orderNo: updated.order_no,
        merchantName: updated.merchant_name_snapshot,
        payerName: updated.payer_name_snapshot,
        amountCents: updated.amount_cents,
      }),
      "paid",
    );
  }
  writeAudit({
    actorId: payer.id,
    actorRole: "user",
    action: "order.paid",
    targetType: "order",
    targetId: orderId,
    detail: CHANNEL_LABELS[input.channel],
    ip,
  });
  return updated;
}

export function confirmOrder(
  orderId: string,
  merchantUser: UserRow,
  ip: string,
): OrderRow {
  const order = requireOrderForUser(orderId, merchantUser);
  assertMerchantRole(order, merchantUser);
  if (order.status !== "paid") {
    throw errors.orderStatusInvalid(
      order.status === "pending_payment"
        ? "付款人还没有标记「我已支付」，请等对方上传付款截图并确认后再点确认收款"
        : "订单当前状态不能确认收款",
    );
  }
  if (!order.payment_proof) {
    throw errors.validation("付款人还没有上传付款截图，暂时不能确认收款");
  }
  const now = nowIso();
  execute(
    "UPDATE orders SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
    now,
    now,
    orderId,
  );
  addEvent(orderId, "confirmed", "merchant", merchantUser.id, "商家确认收款完成");
  const updated = findOrderById(orderId) as OrderRow;
  notifyOrderUpdate(updated);
  for (const userId of [updated.payer_id, updated.merchant_id]) {
    const target = findUserById(userId);
    if (!target?.email) continue;
    mailToUser(
      userId,
      templates.settled({
        to: target.email,
        orderNo: updated.order_no,
        statusText: "已完成",
        amountCents: updated.amount_cents,
        merchantName: updated.merchant_name_snapshot,
      }),
      "settled",
    );
  }
  writeAudit({
    actorId: merchantUser.id,
    actorRole: "user",
    action: "order.confirmed",
    targetType: "order",
    targetId: orderId,
    ip,
  });
  return updated;
}

export function markOrderNotReceived(
  orderId: string,
  merchantUser: UserRow,
  ip: string,
): OrderRow {
  const order = requireOrderForUser(orderId, merchantUser);
  assertMerchantRole(order, merchantUser);
  if (order.status !== "paid") throw errors.orderStatusInvalid("只有已支付的订单可以标记为未收到");
  execute(
    "UPDATE orders SET status = 'pending_payment', paid_at = NULL, actual_note = NULL, pay_channel = NULL, payment_proof = NULL, updated_at = ? WHERE id = ?",
    nowIso(),
    orderId,
  );
  removePaymentProofFile(order.payment_proof);
  addEvent(orderId, "not_received", "merchant", merchantUser.id, "商家未收到款项，订单退回待付款");
  const updated = findOrderById(orderId) as OrderRow;
  notifyOrderUpdate(updated);
  const payer = findUserById(updated.payer_id);
  if (payer?.email) {
    sendMailInBackground({
      ...templates.settled({
        to: payer.email,
        orderNo: updated.order_no,
        statusText: "被退回待付款",
        amountCents: updated.amount_cents,
        merchantName: updated.merchant_name_snapshot,
      }),
      kind: "not_received",
    });
  }
  writeAudit({
    actorId: merchantUser.id,
    actorRole: "user",
    action: "order.not_received",
    targetType: "order",
    targetId: orderId,
    ip,
  });
  return updated;
}

export function cancelOrder(
  orderId: string,
  merchantUser: UserRow,
  input: { reason: string; note?: string | null },
  ip: string,
): OrderRow {
  const order = requireOrderForUser(orderId, merchantUser);
  assertMerchantRole(order, merchantUser);
  if (order.status !== "pending_payment") {
    throw errors.orderStatusInvalid("只有待付款的订单可以直接取消，已支付请先标记未收到");
  }
  const reason = [input.reason, input.note?.trim()].filter(Boolean).join("：").slice(0, 200);
  const now = nowIso();
  execute(
    "UPDATE orders SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?, updated_at = ? WHERE id = ?",
    reason,
    now,
    now,
    orderId,
  );
  addEvent(orderId, "cancelled", "merchant", merchantUser.id, `商家取消订单：${reason}`);
  const updated = findOrderById(orderId) as OrderRow;
  notifyOrderUpdate(updated);
  const payer = findUserById(updated.payer_id);
  if (payer?.email) {
    mailToUser(
      payer.id,
      templates.settled({
        to: payer.email,
        orderNo: updated.order_no,
        statusText: "已被取消",
        amountCents: updated.amount_cents,
        merchantName: updated.merchant_name_snapshot,
      }),
      "settled",
    );
  }
  writeAudit({
    actorId: merchantUser.id,
    actorRole: "user",
    action: "order.cancelled",
    targetType: "order",
    targetId: orderId,
    detail: reason,
    ip,
  });
  return updated;
}

export function appealOrder(
  orderId: string,
  payer: UserRow,
  input: { reason: string },
  ip: string,
): OrderRow {
  const order = requireOrderForUser(orderId, payer);
  assertPayerRole(order, payer);
  if (hasOpenAppeal(orderId)) throw errors.conflict("该订单已有处理中的申诉");
  const reason = input.reason.trim();
  if (!reason) throw errors.validation("请填写申诉原因");
  transaction(() => {
    execute(
      "INSERT INTO appeals (id, order_id, user_id, reason, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
      newId(),
      orderId,
      payer.id,
      reason.slice(0, 500),
      nowIso(),
    );
    addEvent(orderId, "appealed", "payer", payer.id, `付款人发起申诉：${reason.slice(0, 200)}`);
  });
  writeAudit({
    actorId: payer.id,
    actorRole: "user",
    action: "order.appealed",
    targetType: "order",
    targetId: orderId,
    detail: reason.slice(0, 200),
    ip,
  });
  return findOrderById(orderId) as OrderRow;
}

/** 订单收款二维码内容（仅双方可见、渠道必须启用） */
export function orderQrContentForUser(
  orderId: string,
  user: UserRow,
  channel: string,
): string {
  const order = requireOrderForUser(orderId, user);
  if (order.status === "cancelled") throw errors.orderStatusInvalid("订单已取消，无需付款");
  if (!CHANNELS.includes(channel as Channel)) throw errors.validation("支付方式不正确");
  return channelQrContent(order.merchant_id, channel as Channel);
}

/** 账单对账命中：直接标记为已完成（无需付款截图），返回 null 表示订单状态已变化 */
export function completeOrderByReconciliation(
  orderId: string,
  input: {
    provider: "alipay" | "wechat";
    providerLabel: string;
    paidAt: string | null;
    importId: string;
  },
): OrderRow | null {
  const order = findOrderById(orderId);
  if (!order) return null;
  if (order.status !== "pending_payment" && order.status !== "paid") return null;
  const now = nowIso();
  const paidAt = order.paid_at ?? input.paidAt ?? now;
  const result = execute(
    "UPDATE orders SET status = 'completed', pay_channel = COALESCE(pay_channel, ?), paid_at = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending_payment', 'paid')",
    input.provider,
    paidAt,
    now,
    now,
    orderId,
  );
  if (result.changes === 0) return null;
  addEvent(
    orderId,
    "auto_confirmed",
    "system",
    null,
    `账单自动对账确认收款（${input.providerLabel}），账单 ${input.importId.slice(0, 8)}`,
  );
  const updated = findOrderById(orderId) as OrderRow;
  notifyOrderUpdate(updated);
  writeAudit({
    actorId: null,
    actorRole: "system",
    action: "order.auto_confirmed",
    targetType: "order",
    targetId: orderId,
    detail: `${input.providerLabel}；账单 ${input.importId}`,
  });
  return updated;
}

export function channelsOfMerchant(merchantUserId: string): Channel[] {
  return enabledChannels(merchantUserId);
}
