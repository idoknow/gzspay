/**
 * 商家自建收款单：商家先填好金额或点选商品，生成二维码 / 链接；
 * 付款人扫码确认后输入支付密码，系统按快照金额创建订单（一次性，付款后失效）。
 */

import { config } from "../config.js";
import { execute, isoAfter, nowIso, queryAll, queryOne, transaction } from "../db/index.js";
import { writeAudit, writeRiskLog } from "../lib/audit.js";
import { hashToken, newId, randomToken } from "../lib/crypto.js";
import { errors } from "../lib/errors.js";
import { type MerchantRow, type PaymentCollectionRow, type PublicUser, type UserRow } from "../lib/types.js";
import { resolveRequestItems } from "./dynamic.js";
import { enabledChannels, merchantNameOf, requireMerchant } from "./merchant.js";
import { findOrderById, toOrderDto, createOrderFromCollection, type OrderDto, type OrderItemDto } from "./orders.js";
import { findUserById, getMerchant, publicUserOf, verifyPaymentPassword } from "./users.js";

export interface PaymentCollectionDto {
  id: string;
  status: PaymentCollectionRow["status"];
  amountCents: number;
  title: string;
  items: OrderItemDto[] | null;
  reservedNote: string | null;
  /** 商家的备注要求（付款人核对金额时一并展示） */
  noteRequirement: string;
  merchant: PublicUser;
  merchantName: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  orderId: string | null;
}

export interface CreatePaymentCollectionResult {
  collection: PaymentCollectionDto;
  /** 收款链接（二维码内容），只在创建成功时返回，库里只存令牌哈希 */
  url: string;
}

export interface CreatePaymentCollectionInput {
  amountCents?: number;
  items?: { productId: string; quantity: number }[];
  reservedNote?: string | null;
  title?: string | null;
}

const MAX_TITLE_LENGTH = 40;

function parseItems(json: string | null): OrderItemDto[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as OrderItemDto[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function expireIfNeeded(row: PaymentCollectionRow): PaymentCollectionRow {
  if (row.status === "pending" && row.expires_at <= nowIso()) {
    execute(
      "UPDATE payment_collections SET status = 'expired', decided_at = ? WHERE id = ?",
      nowIso(),
      row.id,
    );
    return { ...row, status: "expired" };
  }
  return row;
}

function toCollectionDto(row: PaymentCollectionRow): PaymentCollectionDto {
  const merchantUser = findUserById(row.merchant_id);
  const merchant = getMerchant(row.merchant_id);
  return {
    id: row.id,
    status: row.status,
    amountCents: row.amount_cents,
    title: row.title,
    items: parseItems(row.items_json),
    reservedNote: row.reserved_note,
    noteRequirement: merchant?.note_requirement ?? "",
    merchant: merchantUser
      ? publicUserOf(merchantUser)
      : {
          id: row.merchant_id,
          displayName: "商家",
          avatarUrl: null,
          studentNoMasked: "",
          isMerchant: true,
        },
    merchantName: merchantUser ? merchantNameOf(merchantUser) : "商家",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    orderId: row.order_id,
  };
}

function findCollectionById(id: string): PaymentCollectionRow {
  const row = queryOne<PaymentCollectionRow>("SELECT * FROM payment_collections WHERE id = ?", id);
  if (!row) throw errors.notFound("收款单不存在");
  return expireIfNeeded(row);
}

/** 创建收款单并返回二维码链接（库里只存 token 的哈希，重新展示需重新创建） */
export function createPaymentCollection(
  merchantUser: UserRow,
  input: CreatePaymentCollectionInput,
  ip: string,
): CreatePaymentCollectionResult {
  const merchant: MerchantRow = requireMerchant(merchantUser);
  if (enabledChannels(merchant.user_id).length === 0) {
    throw errors.conflict("请先在商家中心启用至少一种收款方式");
  }
  const resolved = resolveRequestItems(
    merchant.user_id,
    input.items,
    input.amountCents,
    "自定义收款",
  );
  if (resolved.amountCents > config.security.orderMaxAmountCents) {
    throw errors.limitExceeded(
      `单笔金额不能超过 ${(config.security.orderMaxAmountCents / 100).toFixed(2)} 元`,
    );
  }
  const customTitle = (input.title ?? "").trim().slice(0, MAX_TITLE_LENGTH);
  const title = customTitle || resolved.title;
  const note = (input.reservedNote ?? "").trim().slice(0, 200) || null;
  const token = randomToken(24);
  const id = newId();
  const now = nowIso();
  execute(
    `INSERT INTO payment_collections (
      id, token_hash, merchant_id, amount_cents, title, items_json, reserved_note,
      status, order_id, payer_id, created_at, expires_at, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL)`,
    id,
    hashToken(token),
    merchant.user_id,
    resolved.amountCents,
    title,
    resolved.items ? JSON.stringify(resolved.items) : null,
    note,
    now,
    isoAfter(config.security.collectionTtlSeconds),
  );
  const dto = toCollectionDto(findCollectionById(id));
  writeAudit({
    actorId: merchantUser.id,
    actorRole: "user",
    action: "payment_collection.created",
    targetType: "payment_collection",
    targetId: id,
    detail: `创建收款单：${title}，金额 ￥${(resolved.amountCents / 100).toFixed(2)}`,
    ip,
  });
  return {
    collection: dto,
    url: `${config.publicBaseUrl}/collect/${token}`,
  };
}

export interface PaymentCollectionPreview extends PaymentCollectionDto {
  /** 当前是否还能被付款 */
  payeable: boolean;
}

/** 商家查看自己的收款单列表（只返回状态，不返回链接） */
export function listPaymentCollections(merchantUser: UserRow, limit = 20): PaymentCollectionDto[] {
  requireMerchant(merchantUser);
  const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 20, 1), 100);
  const rows = queryAll<PaymentCollectionRow>(
    "SELECT * FROM payment_collections WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?",
    merchantUser.id,
    safeLimit,
  );
  return rows.map((row) => toCollectionDto(expireIfNeeded(row)));
}

/** 商家查看单个收款单 */
export function getPaymentCollection(id: string, merchantUser: UserRow): PaymentCollectionDto {
  const row = findCollectionById(id);
  if (row.merchant_id !== merchantUser.id) throw errors.forbidden("无权查看该收款单");
  return toCollectionDto(row);
}

/** 商家作废收款单 */
export function cancelPaymentCollection(id: string, merchantUser: UserRow, ip: string): PaymentCollectionDto {
  const row = findCollectionById(id);
  if (row.merchant_id !== merchantUser.id) throw errors.forbidden("无权操作该收款单");
  if (row.status !== "pending") throw errors.orderStatusInvalid("该收款单已失效，无法作废");
  const result = execute(
    "UPDATE payment_collections SET status = 'cancelled', decided_at = ? WHERE id = ? AND status = 'pending'",
    nowIso(),
    id,
  );
  if (result.changes !== 1) throw errors.orderStatusInvalid("该收款单已失效，无法作废");
  writeAudit({
    actorId: merchantUser.id,
    actorRole: "user",
    action: "payment_collection.cancelled",
    targetType: "payment_collection",
    targetId: id,
    detail: `作废收款单：${row.title}，金额 ￥${(row.amount_cents / 100).toFixed(2)}`,
    ip,
  });
  return toCollectionDto(findCollectionById(id));
}

function findCollectionByToken(rawToken: string): PaymentCollectionRow {
  const token = rawToken.trim();
  if (!token) throw errors.validation("收款单链接不正确");
  const row = queryOne<PaymentCollectionRow>(
    "SELECT * FROM payment_collections WHERE token_hash = ?",
    hashToken(token),
  );
  if (!row) throw errors.notFound("收款单不存在或链接已失效");
  return expireIfNeeded(row);
}

function previewRow(row: PaymentCollectionRow, viewer: UserRow): PaymentCollectionPreview {
  if (row.merchant_id === viewer.id) throw errors.conflict("这是你自己发起的收款单，不能付款");
  const dto = toCollectionDto(row);
  return { ...dto, payeable: row.status === "pending" };
}

/** 付款人扫码后的收款单预览（已失效也返回状态，由前端提示） */
export function previewPaymentCollection(rawToken: string, viewer: UserRow): PaymentCollectionPreview {
  return previewRow(findCollectionByToken(rawToken), viewer);
}

/** 按 id 预览收款单：付款人扫商家校园卡时用（库里只存令牌哈希，扫卡拿不到令牌） */
export function previewPaymentCollectionById(id: string, viewer: UserRow): PaymentCollectionPreview {
  return previewRow(findCollectionById(id), viewer);
}

/** 商家当前待付款的收款单（扫校园卡时据此直接进入指定金额收款页） */
export function findPendingCollectionForMerchant(merchantUserId: string): PaymentCollectionRow | null {
  const row = queryOne<PaymentCollectionRow>(
    `SELECT * FROM payment_collections
      WHERE merchant_id = ? AND status = 'pending' AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1`,
    merchantUserId,
    nowIso(),
  );
  return row ?? null;
}

/** 付款人确认付款：校验支付密码后按收款单快照创建订单（一次性占用收款单） */
function payRow(
  row: PaymentCollectionRow,
  payer: UserRow,
  paymentPassword: string,
  ip: string,
): { collection: PaymentCollectionDto; order: OrderDto } {
  if (row.merchant_id === payer.id) throw errors.conflict("不能向自己付款");
  if (row.status === "used") throw errors.conflict("该收款单已被使用，请让商家重新发起");
  if (row.status !== "pending") throw errors.conflict("该收款单已失效，请让商家重新发起");
  if (row.expires_at <= nowIso()) throw errors.conflict("该收款单已过期，请让商家重新发起");
  if (payer.status === "frozen") throw errors.locked("你的账号已被冻结，暂时无法付款");
  const merchantUser = findUserById(row.merchant_id);
  if (!merchantUser) throw errors.notFound("商家不存在");
  if (merchantUser.status === "frozen") throw errors.locked("商家账号已被冻结，暂时无法收款");

  verifyPaymentPassword(payer, paymentPassword, ip);

  // 先占住收款单，避免并发重复付款；创建订单失败则退回 pending
  const claimed = transaction(() => {
    const result = execute(
      `UPDATE payment_collections
         SET status = 'used', payer_id = ?, decided_at = ?
       WHERE id = ? AND status = 'pending' AND expires_at > ?`,
      payer.id,
      nowIso(),
      row.id,
      nowIso(),
    );
    return result.changes === 1;
  });
  if (!claimed) throw errors.conflict("该收款单已被使用或已过期，请让商家重新发起");

  let order;
  try {
    order = createOrderFromCollection(
      payer,
      merchantUser,
      {
        amountCents: row.amount_cents,
        title: row.title,
        items: parseItems(row.items_json),
        reservedNote: row.reserved_note,
      },
      ip,
    );
  } catch (error) {
    execute(
      "UPDATE payment_collections SET status = 'pending', payer_id = NULL, decided_at = NULL WHERE id = ?",
      row.id,
    );
    writeRiskLog({
      userId: payer.id,
      type: "collection_payment_failed",
      detail: `收款单付款失败：${row.id}`,
      ip,
    });
    throw error;
  }

  execute("UPDATE payment_collections SET order_id = ? WHERE id = ?", order.id, row.id);
  writeAudit({
    actorId: payer.id,
    actorRole: "user",
    action: "payment_collection.paid",
    targetType: "payment_collection",
    targetId: row.id,
    detail: `扫码付款：商家 ${order.merchant_name_snapshot}，金额 ￥${(order.amount_cents / 100).toFixed(2)}`,
    ip,
  });
  return {
    collection: toCollectionDto(findCollectionById(row.id)),
    order: toOrderDto(findOrderById(order.id) ?? order, payer.id),
  };
}

/** 付款人打开收款链接（令牌）确认付款 */
export function payPaymentCollection(
  rawToken: string,
  payer: UserRow,
  paymentPassword: string,
  ip: string,
): { collection: PaymentCollectionDto; order: OrderDto } {
  return payRow(findCollectionByToken(rawToken), payer, paymentPassword, ip);
}

/** 付款人扫商家校园卡后直接确认付款（按收款单 id） */
export function payPaymentCollectionById(
  id: string,
  payer: UserRow,
  paymentPassword: string,
  ip: string,
): { collection: PaymentCollectionDto; order: OrderDto } {
  return payRow(findCollectionById(id), payer, paymentPassword, ip);
}
