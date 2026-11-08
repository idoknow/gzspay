import { config } from "../config.js";
import { execute, isoAfter, nowIso, queryAll, queryOne, transaction } from "../db/index.js";
import { writeAudit, writeRiskLog } from "../lib/audit.js";
import { hashToken, newId, randomToken } from "../lib/crypto.js";
import { errors } from "../lib/errors.js";
import {
  type Channel,
  type PaymentRequestRow,
  type PublicUser,
  type UserRow,
} from "../lib/types.js";
import { createOrderAsPayer, findOrderById, type OrderDto, toOrderDto } from "./orders.js";
import { enabledChannels, merchantNameOf, payerNameSnapshotOf } from "./merchant.js";
import { pushToUser } from "./events.js";
import { pushNotification } from "./push.js";
import { displayNameOf, findUserById, publicUserOf, verifyPaymentPassword } from "./users.js";

export interface DynamicCodeDto {
  token: string;
  expiresAt: string;
  refreshAfter: string;
}

/** 签发一次性动态码（签到即作废旧码） */
export function issueDynamicCode(user: UserRow): DynamicCodeDto {
  const token = randomToken(24);
  const now = nowIso();
  execute("UPDATE dynamic_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL", now, user.id);
  const expiresAt = isoAfter(config.security.dynamicCodeTtlSeconds);
  execute(
    "INSERT INTO dynamic_codes (id, token_hash, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
    newId(),
    hashToken(token),
    user.id,
    expiresAt,
    now,
  );
  return {
    token,
    expiresAt,
    refreshAfter: isoAfter(config.security.dynamicCodeRefreshSeconds),
  };
}

export interface DynamicCodeResolution {
  user: PublicUser;
  isMerchant: boolean;
  merchantName: string | null;
  channels: Channel[];
}

/**
 * 扫码方解析动态码。
 * 默认只读（resolve 接口用），真正消费发生在「创建收款请求」或「客户下单」时，
 * 这样商家在 resolve 出客户之后、填写金额期间令牌仍然有效。
 */
export function resolveDynamicCode(
  rawToken: string,
  viewer: UserRow,
  options: { consume?: boolean } = {},
): DynamicCodeResolution {
  const token = rawToken.trim();
  if (!token) throw errors.validation("动态码内容为空");
  const row = queryOne<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
    "SELECT * FROM dynamic_codes WHERE token_hash = ?",
    hashToken(token),
  );
  if (!row) throw errors.validation("动态码无效，请刷新后重新扫描");
  if (row.used_at) throw errors.conflict("该动态码已被使用，请重新展示或刷新");
  if (row.expires_at <= nowIso()) throw errors.conflict("动态码已过期，请刷新后重新扫描");
  if (row.user_id === viewer.id) throw errors.conflict("不能扫描自己的收付款码");
  const owner = findUserById(row.user_id);
  if (!owner) throw errors.validation("动态码对应的账号不存在");
  if (owner.status === "frozen") throw errors.locked("对方账号已被冻结");
  if (options.consume !== false) {
    execute("UPDATE dynamic_codes SET used_at = ? WHERE id = ?", nowIso(), row.id);
  }
  const channels = enabledChannels(owner.id);
  return {
    user: publicUserOf(owner),
    isMerchant: channels.length > 0,
    merchantName: channels.length > 0 ? merchantNameOf(owner) : null,
    channels,
  };
}

export interface PaymentRequestDto {
  id: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  amountCents: number;
  title: string;
  reservedNote: string | null;
  createdAt: string;
  expiresAt: string;
  merchant: PublicUser;
  merchantName: string;
  customerId: string;
  orderId: string | null;
}

function toPaymentRequestDto(row: PaymentRequestRow): PaymentRequestDto {
  const merchantUser = findUserById(row.merchant_id);
  return {
    id: row.id,
    status: row.status,
    amountCents: row.amount_cents,
    title: row.title,
    reservedNote: row.reserved_note,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
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
    customerId: row.customer_id,
    orderId: row.order_id,
  };
}

function expireIfNeeded(row: PaymentRequestRow): PaymentRequestRow {
  if (row.status === "pending" && row.expires_at <= nowIso()) {
    execute(
      "UPDATE payment_requests SET status = 'expired', decided_at = ? WHERE id = ?",
      nowIso(),
      row.id,
    );
    return { ...row, status: "expired" };
  }
  return row;
}

function findPaymentRequest(id: string): PaymentRequestRow {
  const row = queryOne<PaymentRequestRow>("SELECT * FROM payment_requests WHERE id = ?", id);
  if (!row) throw errors.notFound("收款请求不存在或已过期");
  return expireIfNeeded(row);
}

/** 把「商品列表 / 自定义金额」解析成收款明细（收款请求与商家收款单共用） */
export function resolveRequestItems(
  merchantId: string,
  items: { productId: string; quantity: number }[] | undefined,
  amountCents: number | undefined,
  amountTitle = "自定义付款",
): {
  items: { name: string; priceCents: number; quantity: number }[] | null;
  amountCents: number;
  title: string;
} {
  if (items && items.length > 0) {
    const resolved: { name: string; priceCents: number; quantity: number }[] = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw errors.validation("商品数量必须为 1~99 的整数");
      }
      const product = queryOne<{ name: string; price_cents: number }>(
        "SELECT name, price_cents FROM products WHERE id = ? AND merchant_id = ? AND active = 1",
        item.productId,
        merchantId,
      );
      if (!product) throw errors.validation("所选商品不存在或已下架");
      resolved.push({ name: product.name, priceCents: product.price_cents, quantity });
    }
    const total = resolved.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
    return {
      items: resolved,
      amountCents: total,
      title: `${resolved[0]?.name ?? "商品"}${resolved.length > 1 ? ` 等 ${resolved.length} 种商品` : ""}`,
    };
  }
  if (!Number.isInteger(amountCents) || (amountCents as number) < 1) {
    throw errors.validation("请填写收款金额（单位：分）");
  }
  return { items: null, amountCents: amountCents as number, title: amountTitle };
}

/** 商家扫客户动态码后发起收款请求，实时推送到客户手机 */
export function createPaymentRequest(
  merchantUser: UserRow,
  input: {
    token: string;
    amountCents?: number;
    items?: { productId: string; quantity: number }[];
    reservedNote?: string | null;
  },
  ip: string,
): PaymentRequestDto {
  const channels = enabledChannels(merchantUser.id);
  if (channels.length === 0) throw errors.conflict("请先注册成为商家并启用至少一种收款方式");
  const resolution = resolveDynamicCode(input.token, merchantUser);
  const customer = findUserById(resolution.user.id);
  if (!customer) throw errors.notFound("对方账号不存在");
  const resolved = resolveRequestItems(merchantUser.id, input.items, input.amountCents);
  if (resolved.amountCents > config.security.orderMaxAmountCents) {
    throw errors.limitExceeded(
      `单笔金额不能超过 ${(config.security.orderMaxAmountCents / 100).toFixed(2)} 元`,
    );
  }
  const id = newId();
  const now = nowIso();
  const expiresAt = isoAfter(config.security.paymentRequestTtlSeconds);
  execute(
    `INSERT INTO payment_requests (id, merchant_id, customer_id, amount_cents, reserved_note, items_json, title, status, order_id, created_at, expires_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)`,
    id,
    merchantUser.id,
    customer.id,
    resolved.amountCents,
    (input.reservedNote ?? "").trim().slice(0, 200) || null,
    resolved.items ? JSON.stringify(resolved.items) : null,
    resolved.title,
    now,
    expiresAt,
  );
  const row = findPaymentRequest(id);
  const dto = toPaymentRequestDto(row);
  pushToUser(customer.id, "payment_request", {
    id: dto.id,
    amountCents: dto.amountCents,
    title: dto.title,
    reservedNote: dto.reservedNote,
    merchantName: dto.merchantName,
    expiresAt: dto.expiresAt,
  });
  pushNotification(customer.id, {
    title: "收到收款请求",
    body: `${dto.merchantName} 向你收款 ￥${(dto.amountCents / 100).toFixed(2)}`,
    url: "/trades",
  });
  writeAudit({
    actorId: merchantUser.id,
    actorRole: "user",
    action: "payment_request.created",
    targetType: "payment_request",
    targetId: id,
    detail: `向 ${payerNameSnapshotOf(customer)} 发起收款 ￥${(dto.amountCents / 100).toFixed(2)}`,
    ip,
  });
  return dto;
}

export function getPaymentRequest(id: string, user: UserRow): PaymentRequestDto {
  const row = findPaymentRequest(id);
  if (row.customer_id !== user.id && row.merchant_id !== user.id) {
    throw errors.forbidden("无权查看该收款请求");
  }
  return toPaymentRequestDto(row);
}

export function listPendingPaymentRequests(user: UserRow): PaymentRequestDto[] {
  const rows = queryAll<PaymentRequestRow>(
    "SELECT * FROM payment_requests WHERE customer_id = ? AND status = 'pending' ORDER BY created_at DESC",
    user.id,
  );
  return rows.map((row) => toPaymentRequestDto(expireIfNeeded(row)));
}

export function acceptPaymentRequest(
  id: string,
  customer: UserRow,
  paymentPassword: string,
  ip: string,
): { request: PaymentRequestDto; order: OrderDto } {
  const row = findPaymentRequest(id);
  if (row.customer_id !== customer.id) throw errors.forbidden("这不是发给你的收款请求");
  if (row.status !== "pending") throw errors.orderStatusInvalid("该收款请求已失效");
  verifyPaymentPassword(customer, paymentPassword, ip);
  const merchantUser = findUserById(row.merchant_id);
  if (!merchantUser) throw errors.notFound("商家不存在");
  const items = row.items_json
    ? (JSON.parse(row.items_json) as { productId?: string; name: string; priceCents: number; quantity: number }[])
    : undefined;
  void items;
  const order = createOrderAsPayer(
    customer,
    {
      merchantUserId: row.merchant_id,
      amountCents: row.amount_cents,
      reservedNote: row.reserved_note,
      items: undefined,
    },
    ip,
  );
  execute(
    "UPDATE payment_requests SET status = 'accepted', order_id = ?, decided_at = ? WHERE id = ?",
    order.id,
    nowIso(),
    id,
  );
  return {
    request: toPaymentRequestDto(findPaymentRequest(id)),
    order: toOrderDto(findOrderById(order.id) ?? order, customer.id),
  };
}

export function rejectPaymentRequest(id: string, customer: UserRow, ip: string): PaymentRequestDto {
  const row = findPaymentRequest(id);
  if (row.customer_id !== customer.id) throw errors.forbidden("这不是发给你的收款请求");
  if (row.status !== "pending") throw errors.orderStatusInvalid("该收款请求已失效");
  execute(
    "UPDATE payment_requests SET status = 'rejected', decided_at = ? WHERE id = ?",
    nowIso(),
    id,
  );
  writeRiskLog({
    userId: customer.id,
    type: "payment_request_rejected",
    detail: `拒绝商家收款请求 ${row.id}`,
    ip,
  });
  return toPaymentRequestDto(findPaymentRequest(id));
}

export function dynamicCodeOwnerName(userId: string): string {
  const user = findUserById(userId);
  return user ? displayNameOf(user) : "用户";
}
