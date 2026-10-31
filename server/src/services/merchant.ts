import { execute, nowIso, queryAll, queryOne, transaction } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { displayFullName, newId } from "../lib/crypto.js";
import { errors } from "../lib/errors.js";
import { decodeQrImage, detectChannel, isValidChannelQr } from "../lib/qr.js";
import {
  CHANNELS,
  CHANNEL_LABELS,
  type Channel,
  type MerchantChannelRow,
  type MerchantRow,
  type ProductRow,
  type PublicUser,
  type UserRow,
} from "../lib/types.js";
import { displayNameOf, getMerchant, publicUserOf } from "./users.js";

export interface MerchantChannelDto {
  channel: Channel;
  label: string;
  enabled: boolean;
  hasQr: boolean;
  updatedAt: string | null;
}

export interface MerchantDto {
  userId: string;
  name: string;
  noteRequirement: string;
  channels: MerchantChannelDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductDto {
  id: string;
  name: string;
  priceCents: number;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export function merchantNameOf(user: UserRow): string {
  const merchant = getMerchant(user.id);
  return merchant?.name?.trim() || displayNameOf(user);
}

export function merchantDtoOf(merchant: MerchantRow): MerchantDto {
  const rows = queryAll<MerchantChannelRow>(
    "SELECT * FROM merchant_channels WHERE merchant_id = ?",
    merchant.user_id,
  );
  const byChannel = new Map(rows.map((row) => [row.channel, row]));
  return {
    userId: merchant.user_id,
    name: merchant.name,
    noteRequirement: merchant.note_requirement ?? "",
    channels: CHANNELS.map((channel) => {
      const row = byChannel.get(channel);
      return {
        channel,
        label: CHANNEL_LABELS[channel],
        enabled: row?.enabled === 1,
        hasQr: Boolean(row?.qr_content),
        updatedAt: row?.updated_at ?? null,
      };
    }),
    createdAt: merchant.created_at,
    updatedAt: merchant.updated_at,
  };
}

export function requireMerchant(user: UserRow): MerchantRow {
  const merchant = getMerchant(user.id);
  if (!merchant) throw errors.forbidden("你还不是商家，请先注册商家");
  return merchant;
}

export function enabledChannels(merchantUserId: string): Channel[] {
  const rows = queryAll<MerchantChannelRow>(
    "SELECT * FROM merchant_channels WHERE merchant_id = ? AND enabled = 1",
    merchantUserId,
  );
  // 保持固定顺序：支付宝、微信、QQ
  return CHANNELS.filter((channel) => rows.some((row) => row.channel === channel));
}

export function channelQrContent(merchantUserId: string, channel: Channel): string {
  const row = queryOne<MerchantChannelRow>(
    "SELECT * FROM merchant_channels WHERE merchant_id = ? AND channel = ?",
    merchantUserId,
    channel,
  );
  if (!row || !row.qr_content) throw errors.notFound("该收款方式尚未上传收款码");
  if (row.enabled !== 1) throw errors.conflict("该收款方式已停用");
  return row.qr_content;
}

function assertChannel(value: string): Channel {
  if (!CHANNELS.includes(value as Channel)) {
    throw errors.validation("支付方式不正确，应为 alipay、wechat 或 qq");
  }
  return value as Channel;
}

async function decodeChannelQr(file: Buffer, expected: Channel): Promise<string> {
  const content = await decodeQrImage(file);
  if (!content) throw errors.validation(`${CHANNEL_LABELS[expected]}收款码无法识别，请重新上传清晰的截图`);
  if (!isValidChannelQr(content, expected)) {
    throw errors.validation(`该二维码不属于${CHANNEL_LABELS[expected]}，请上传对应渠道的收款码`);
  }
  return content;
}

export interface RegisterMerchantInput {
  name?: string;
  noteRequirement?: string;
  channels: string[];
  files: Partial<Record<Channel, Buffer>>;
}

export async function registerMerchant(
  user: UserRow,
  input: RegisterMerchantInput,
  ip: string,
): Promise<MerchantDto> {
  if (getMerchant(user.id)) throw errors.conflict("你已经是商家，无需重复注册");
  const channels = Array.from(new Set(input.channels.map(assertChannel)));
  if (channels.length === 0) throw errors.validation("请至少选择一种收款方式");
  const decoded = new Map<Channel, string>();
  for (const channel of channels) {
    const file = input.files[channel];
    if (!file) throw errors.validation(`请上传${CHANNEL_LABELS[channel]}收款码`);
    decoded.set(channel, await decodeChannelQr(file, channel));
  }
  const name = (input.name?.trim() || displayNameOf(user)).slice(0, 40);
  const note = (input.noteRequirement ?? "").trim().slice(0, 200);
  const now = nowIso();
  transaction(() => {
    execute(
      "INSERT INTO merchants (user_id, name, note_requirement, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      user.id,
      name,
      note,
      now,
      now,
    );
    for (const channel of channels) {
      execute(
        "INSERT INTO merchant_channels (merchant_id, channel, qr_content, enabled, updated_at) VALUES (?, ?, ?, 1, ?)",
        user.id,
        channel,
        decoded.get(channel) ?? "",
        now,
      );
    }
  });
  writeAudit({
    actorId: user.id,
    actorRole: "user",
    action: "merchant.registered",
    targetType: "merchant",
    targetId: user.id,
    detail: `收款方式：${channels.map((channel) => CHANNEL_LABELS[channel]).join("、")}`,
    ip,
  });
  return merchantDtoOf(getMerchant(user.id) as MerchantRow);
}

export interface UpdateMerchantInput {
  name?: string;
  noteRequirement?: string;
}

export function updateMerchantInfo(
  user: UserRow,
  input: UpdateMerchantInput,
  ip: string,
): MerchantDto {
  const merchant = requireMerchant(user);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw errors.validation("商家名称不能为空");
    sets.push("name = ?");
    params.push(name.slice(0, 40));
  }
  if (input.noteRequirement !== undefined) {
    sets.push("note_requirement = ?");
    params.push(input.noteRequirement.trim().slice(0, 200));
  }
  if (sets.length === 0) return merchantDtoOf(merchant);
  sets.push("updated_at = ?");
  params.push(nowIso());
  params.push(user.id);
  execute(`UPDATE merchants SET ${sets.join(", ")} WHERE user_id = ?`, ...(params as never[]));
  writeAudit({
    actorId: user.id,
    actorRole: "user",
    action: "merchant.info_updated",
    targetType: "merchant",
    targetId: user.id,
    detail: Object.keys(input).join(","),
    ip,
  });
  return merchantDtoOf(getMerchant(user.id) as MerchantRow);
}

export async function replaceChannelQr(
  user: UserRow,
  channel: string,
  file: Buffer,
  ip: string,
): Promise<MerchantDto> {
  const merchant = requireMerchant(user);
  const value = assertChannel(channel);
  const content = await decodeChannelQr(file, value);
  execute(
    `INSERT INTO merchant_channels (merchant_id, channel, qr_content, enabled, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(merchant_id, channel) DO UPDATE SET qr_content = excluded.qr_content, updated_at = excluded.updated_at`,
    merchant.user_id,
    value,
    content,
    nowIso(),
  );
  writeAudit({
    actorId: user.id,
    actorRole: "user",
    action: "merchant.channel_qr_updated",
    targetType: "merchant",
    targetId: user.id,
    detail: CHANNEL_LABELS[value],
    ip,
  });
  return merchantDtoOf(merchant);
}

export function setChannelEnabled(
  user: UserRow,
  channel: string,
  enabled: boolean,
  ip: string,
): MerchantDto {
  const merchant = requireMerchant(user);
  const value = assertChannel(channel);
  const row = queryOne<MerchantChannelRow>(
    "SELECT * FROM merchant_channels WHERE merchant_id = ? AND channel = ?",
    merchant.user_id,
    value,
  );
  if (!row) throw errors.notFound("尚未配置该收款方式");
  if (!enabled) {
    const enabledRows = queryAll<MerchantChannelRow>(
      "SELECT * FROM merchant_channels WHERE merchant_id = ? AND enabled = 1",
      merchant.user_id,
    );
    if (enabledRows.length <= 1 && enabledRows.some((item) => item.channel === value)) {
      throw errors.conflict("至少保留一种启用的收款方式，否则将暂停收款");
    }
  }
  execute(
    "UPDATE merchant_channels SET enabled = ?, updated_at = ? WHERE merchant_id = ? AND channel = ?",
    enabled ? 1 : 0,
    nowIso(),
    merchant.user_id,
    value,
  );
  writeAudit({
    actorId: user.id,
    actorRole: "user",
    action: enabled ? "merchant.channel_enabled" : "merchant.channel_disabled",
    targetType: "merchant",
    targetId: user.id,
    detail: CHANNEL_LABELS[value],
    ip,
  });
  return merchantDtoOf(merchant);
}

// ---------------- 商品 ----------------

function productDtoOf(row: ProductRow): ProductDto {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    description: row.description,
    imageUrl: row.image_url,
    active: row.active === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function listProducts(user: UserRow): ProductDto[] {
  requireMerchant(user);
  return queryAll<ProductRow>(
    "SELECT * FROM products WHERE merchant_id = ? ORDER BY sort_order ASC, created_at ASC",
    user.id,
  ).map(productDtoOf);
}

function validateProductFields(input: {
  name?: string;
  priceCents?: number;
  description?: string | null;
  imageUrl?: string | null;
  active?: boolean;
}): void {
  if (input.name !== undefined && !input.name.trim()) throw errors.validation("商品名称不能为空");
  if (input.priceCents !== undefined && (!Number.isInteger(input.priceCents) || input.priceCents < 1)) {
    throw errors.validation("商品价格必须为正整数（单位：分）");
  }
}

export function createProduct(
  user: UserRow,
  input: {
    name: string;
    priceCents: number;
    description?: string | null;
    imageUrl?: string | null;
    active?: boolean;
  },
): ProductDto {
  requireMerchant(user);
  validateProductFields(input);
  const maxSort = queryOne<{ value: number | null }>(
    "SELECT MAX(sort_order) AS value FROM products WHERE merchant_id = ?",
    user.id,
  );
  const id = newId();
  const now = nowIso();
  execute(
    `INSERT INTO products (id, merchant_id, name, price_cents, description, image_url, active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    input.name.trim().slice(0, 40),
    input.priceCents,
    (input.description ?? "").slice(0, 500),
    input.imageUrl ?? null,
    input.active === false ? 0 : 1,
    (maxSort?.value ?? 0) + 1,
    now,
    now,
  );
  const row = queryOne<ProductRow>("SELECT * FROM products WHERE id = ?", id) as ProductRow;
  return productDtoOf(row);
}

export function updateProduct(
  user: UserRow,
  productId: string,
  input: {
    name?: string;
    priceCents?: number;
    description?: string | null;
    imageUrl?: string | null;
    active?: boolean;
  },
): ProductDto {
  requireMerchant(user);
  const row = queryOne<ProductRow>(
    "SELECT * FROM products WHERE id = ? AND merchant_id = ?",
    productId,
    user.id,
  );
  if (!row) throw errors.notFound("商品不存在");
  validateProductFields(input);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name.trim().slice(0, 40));
  }
  if (input.priceCents !== undefined) {
    sets.push("price_cents = ?");
    params.push(input.priceCents);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description ?? "");
  }
  if (input.imageUrl !== undefined) {
    sets.push("image_url = ?");
    params.push(input.imageUrl);
  }
  if (input.active !== undefined) {
    sets.push("active = ?");
    params.push(input.active ? 1 : 0);
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    params.push(nowIso());
    params.push(productId, user.id);
    execute(
      `UPDATE products SET ${sets.join(", ")} WHERE id = ? AND merchant_id = ?`,
      ...(params as never[]),
    );
  }
  return productDtoOf(queryOne<ProductRow>("SELECT * FROM products WHERE id = ?", productId) as ProductRow);
}

export function deleteProduct(user: UserRow, productId: string): void {
  requireMerchant(user);
  const result = execute("DELETE FROM products WHERE id = ? AND merchant_id = ?", productId, user.id);
  if (result.changes === 0) throw errors.notFound("商品不存在");
}

export function sortProducts(user: UserRow, ids: string[]): ProductDto[] {
  requireMerchant(user);
  const owned = new Set(
    queryAll<{ id: string }>("SELECT id FROM products WHERE merchant_id = ?", user.id).map(
      (row) => row.id,
    ),
  );
  if (ids.some((id) => !owned.has(id))) throw errors.validation("只能排序自己的商品");
  transaction(() => {
    ids.forEach((id, index) => {
      execute(
        "UPDATE products SET sort_order = ?, updated_at = ? WHERE id = ?",
        index + 1,
        nowIso(),
        id,
      );
    });
  });
  return listProducts(user);
}

// ---------------- 顾客视角 ----------------

export interface PublicMerchantDto {
  user: PublicUser;
  merchantName: string;
  noteRequirement: string;
  products: ProductDto[];
  channels: Channel[];
}

export function publicMerchantOf(merchantUserId: string): PublicMerchantDto {
  const user = queryOne<UserRow>("SELECT * FROM users WHERE id = ?", merchantUserId);
  if (!user) throw errors.notFound("商家不存在");
  const merchant = getMerchant(merchantUserId);
  if (!merchant) throw errors.notFound("对方还不是商家");
  const products = queryAll<ProductRow>(
    "SELECT * FROM products WHERE merchant_id = ? AND active = 1 ORDER BY sort_order ASC, created_at ASC",
    merchantUserId,
  ).map(productDtoOf);
  return {
    user: publicUserOf(user),
    merchantName: merchantNameOf(user),
    noteRequirement: merchant.note_requirement ?? "",
    products,
    channels: enabledChannels(merchantUserId),
  };
}

/** 订单里保存的付款人姓名快照 */
export function payerNameSnapshotOf(user: UserRow): string {
  return (
    displayFullName(user.surname, user.given_name) ??
    user.campux_username ??
    "同学"
  );
}
