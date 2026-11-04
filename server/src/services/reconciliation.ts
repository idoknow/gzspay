/**
 * 商家收款账单自动对账。
 *
 * 商家在「我收到的」页面后台上传微信 / 支付宝账单文件，解析出收款流水后：
 * - 金额相同、备注能对上的订单，直接标记为已完成（不必再上传付款截图）；
 * - 匹配不上的流水保留为「未匹配」，供商家自己核对（不提供手动关联）。
 *
 * 账单原文件存在数据目录的 `bill-uploads/` 下，按后台配置的保留天数自动删除。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { execute, nowIso, queryAll, queryOne, transaction } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { parseBillFile, type BillProvider } from "../lib/bill-parse.js";
import { newId } from "../lib/crypto.js";
import { errors } from "../lib/errors.js";
import type { BillImportRow, BillTransactionRow, OrderRow, UserRow } from "../lib/types.js";
import { requireMerchant } from "./merchant.js";
import { completeOrderByReconciliation } from "./orders.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TRANSACTIONS = 5_000;

const PROVIDER_LABELS: Record<BillProvider, string> = {
  alipay: "支付宝",
  wechat: "微信支付",
};

export interface BillTransactionDto {
  id: string;
  tradeNo: string | null;
  amountCents: number;
  payerNote: string;
  counterparty: string | null;
  paidAt: string | null;
  status: "unmatched" | "matched";
  orderId: string | null;
  orderNo: string | null;
}

export interface BillImportDto {
  id: string;
  provider: BillProvider;
  providerLabel: string;
  filename: string;
  sizeBytes: number;
  periodStart: string | null;
  periodEnd: string | null;
  transactionCount: number;
  matchedCount: number;
  unmatchedCount: number;
  createdAt: string;
}

export interface BillImportDetailDto extends BillImportDto {
  /** 未匹配的流水（已匹配的只计入 matchedCount，不再逐条展示） */
  transactions: BillTransactionDto[];
}

function uploadDir(): string {
  const base =
    config.databasePath === ":memory:"
      ? path.join(os.tmpdir(), "gzspay-bill-uploads")
      : path.dirname(config.databasePath);
  return path.join(base, "bill-uploads");
}

function storedNameOf(importId: string, provider: BillProvider): string {
  return `${importId}.${provider === "wechat" ? "xlsx" : "csv"}`;
}

/** 删除账单原文件（保留期到了由定时任务清理） */
export function removeBillUploadFile(storedName: string | null | undefined): void {
  if (!storedName || !/^[A-Za-z0-9_-]+\.(csv|xlsx)$/.test(storedName)) return;
  try {
    rmSync(path.join(uploadDir(), storedName), { force: true });
  } catch {
    // 清理失败不影响主流程
  }
}

function providerOf(row: BillImportRow): BillProvider {
  return row.provider === "wechat" ? "wechat" : "alipay";
}

function toImportDto(row: BillImportRow, unmatchedCount: number): BillImportDto {
  const provider = providerOf(row);
  return {
    id: row.id,
    provider,
    providerLabel: PROVIDER_LABELS[provider],
    filename: row.filename,
    sizeBytes: row.size_bytes,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    transactionCount: row.transaction_count,
    matchedCount: row.matched_count,
    unmatchedCount,
    createdAt: row.created_at,
  };
}

function toTransactionDto(row: BillTransactionRow, orderNo: string | null): BillTransactionDto {
  return {
    id: row.id,
    tradeNo: row.trade_no,
    amountCents: row.amount_cents,
    payerNote: row.payer_note ?? "",
    counterparty: row.counterparty,
    paidAt: row.paid_at,
    status: row.status,
    orderId: row.order_id,
    orderNo,
  };
}

/** 归一化备注：去掉空白与常见标点，便于「互相包含」比较 */
function normalizeNote(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[\s\-_.,，。、|:：;；/\\()（）【】[\]"'“”‘’]/g, "");
}

function notesMatch(orderNote: string, billNote: string): boolean {
  const left = normalizeNote(orderNote);
  const right = normalizeNote(billNote);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 2) return false;
  return left.includes(right) || right.includes(left);
}

function orderNotesOf(order: OrderRow): string[] {
  return [order.actual_note, order.reserved_note]
    .map((note) => (note ?? "").trim())
    .filter((note) => note.length > 0);
}

/**
 * 尝试为一条账单流水找唯一匹配的订单。
 * 规则：金额完全相等 + 备注能对上（订单的实际备注 / 预留备注 与账单备注互相包含），
 * 命中多个订单时视为有歧义，宁可留给商家人工核对也不自动确认。
 */
function findMatch(
  transaction: BillTransactionRow,
  candidatesByAmount: Map<number, OrderRow[]>,
  usedOrderIds: Set<string>,
): OrderRow | null {
  const candidates = (candidatesByAmount.get(transaction.amount_cents) ?? []).filter((candidate) => {
    if (usedOrderIds.has(candidate.id)) return false;
    const billNotes = [transaction.payer_note, transaction.counterparty]
      .map((note) => (note ?? "").trim())
      .filter((note) => note.length > 0);
    if (billNotes.length === 0) return false;
    return orderNotesOf(candidate).some((orderNote) =>
      billNotes.some((billNote) => notesMatch(orderNote, billNote)),
    );
  });
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

/** multer 按 latin1 解码 multipart 文件名，中文文件名会变成乱码；这里按原字节还原成 UTF-8。 */
function decodeUploadFilename(name: string): string {
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\ufffd") ? name : decoded;
}

export function importBill(
  merchantUser: UserRow,
  file: { filename: string; buffer: Buffer } | undefined,
  ip: string,
): BillImportDetailDto {
  const merchant = requireMerchant(merchantUser);
  if (!file || file.buffer.length === 0) throw errors.validation("请选择要上传的账单文件");
  if (file.buffer.length > MAX_FILE_BYTES) throw errors.validation("账单文件不能超过 5MB");

  const filename = decodeUploadFilename(file.filename);
  const parsed = parseBillFile(filename, file.buffer);
  if (parsed.rows.length === 0) {
    throw errors.validation("账单里没有识别到收款记录，请确认导出的是收款账单");
  }
  if (parsed.rows.length > MAX_TRANSACTIONS) {
    throw errors.validation(`账单记录太多（超过 ${MAX_TRANSACTIONS} 笔），请分批上传`);
  }

  const importId = newId();
  const storedName = storedNameOf(importId, parsed.provider);
  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, storedName), file.buffer);

  const createdAt = nowIso();
  const insertedTransactions: BillTransactionRow[] = [];
  transaction(() => {
    execute(
      `INSERT INTO bill_imports
         (id, merchant_id, provider, filename, stored_name, size_bytes, period_start, period_end,
          transaction_count, matched_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      importId,
      merchant.user_id,
      parsed.provider,
      filename.slice(0, 200),
      storedName,
      file.buffer.length,
      parsed.periodStart,
      parsed.periodEnd,
      parsed.rows.length,
      createdAt,
    );
    for (const row of parsed.rows) {
      const transactionId = newId();
      execute(
        `INSERT INTO bill_transactions
           (id, import_id, merchant_id, provider, trade_no, amount_cents, payer_note, counterparty, paid_at, status, order_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', NULL, ?)`,
        transactionId,
        importId,
        merchant.user_id,
        parsed.provider,
        row.tradeNo,
        row.amountCents,
        row.payerNote || null,
        row.counterparty,
        row.paidAt,
        createdAt,
      );
      insertedTransactions.push({
        id: transactionId,
        import_id: importId,
        merchant_id: merchant.user_id,
        provider: parsed.provider,
        trade_no: row.tradeNo,
        amount_cents: row.amountCents,
        payer_note: row.payerNote || null,
        counterparty: row.counterparty,
        paid_at: row.paidAt,
        status: "unmatched",
        order_id: null,
        created_at: createdAt,
      });
    }
  });

  // 匹配阶段放在事务外：自动确认订单内部会自己开事务
  const pendingOrders = queryAll<OrderRow>(
    "SELECT * FROM orders WHERE merchant_id = ? AND status IN ('pending_payment', 'paid') ORDER BY created_at ASC",
    merchant.user_id,
  );
  const candidatesByAmount = new Map<number, OrderRow[]>();
  for (const order of pendingOrders) {
    const list = candidatesByAmount.get(order.amount_cents) ?? [];
    list.push(order);
    candidatesByAmount.set(order.amount_cents, list);
  }
  const usedOrderIds = new Set<string>();
  let matchedCount = 0;
  for (const transaction of insertedTransactions) {
    const target = findMatch(transaction, candidatesByAmount, usedOrderIds);
    if (!target) continue;
    const completed = completeOrderByReconciliation(target.id, {
      provider: parsed.provider,
      providerLabel: PROVIDER_LABELS[parsed.provider],
      paidAt: transaction.paid_at,
      importId,
    });
    if (!completed) continue;
    usedOrderIds.add(target.id);
    matchedCount += 1;
    execute(
      "UPDATE bill_transactions SET status = 'matched', order_id = ? WHERE id = ?",
      target.id,
      transaction.id,
    );
    transaction.status = "matched";
    transaction.order_id = target.id;
  }
  execute(
    "UPDATE bill_imports SET matched_count = ? WHERE id = ?",
    matchedCount,
    importId,
  );
  writeAudit({
    actorId: merchantUser.id,
    actorRole: "user",
    action: "bill.imported",
    targetType: "bill_import",
    targetId: importId,
    detail: `${PROVIDER_LABELS[parsed.provider]}：${parsed.rows.length} 笔收款，自动匹配 ${matchedCount} 笔`,
    ip,
  });

  return getBillImport(importId, merchantUser);
}

export function listBillImports(merchantUser: UserRow, limit = 20): BillImportDto[] {
  const merchant = requireMerchant(merchantUser);
  const size = Math.min(Math.max(Math.trunc(limit) || 20, 1), 50);
  const rows = queryAll<BillImportRow & { unmatched_count: number }>(
    `SELECT i.*,
            (SELECT COUNT(*) FROM bill_transactions t WHERE t.import_id = i.id AND t.status = 'unmatched') AS unmatched_count
       FROM bill_imports i
      WHERE i.merchant_id = ?
      ORDER BY i.created_at DESC
      LIMIT ?`,
    merchant.user_id,
    size,
  );
  return rows.map((row) => toImportDto(row, row.unmatched_count));
}

export function getBillImport(importId: string, merchantUser: UserRow): BillImportDetailDto {
  const merchant = requireMerchant(merchantUser);
  const row = queryOne<BillImportRow>(
    "SELECT * FROM bill_imports WHERE id = ? AND merchant_id = ?",
    importId,
    merchant.user_id,
  );
  if (!row) throw errors.notFound("账单不存在或已过期清理");
  const unmatched = queryAll<BillTransactionRow>(
    "SELECT * FROM bill_transactions WHERE import_id = ? AND status = 'unmatched' ORDER BY paid_at DESC",
    importId,
  );
  const orderNos = new Map<string, string>();
  for (const transaction of unmatched) {
    if (!transaction.order_id) continue;
    const order = queryOne<OrderRow>("SELECT * FROM orders WHERE id = ?", transaction.order_id);
    if (order) orderNos.set(transaction.order_id, order.order_no);
  }
  const transactions = unmatched.map((transaction) =>
    toTransactionDto(
      transaction,
      transaction.order_id ? (orderNos.get(transaction.order_id) ?? null) : null,
    ),
  );
  return {
    ...toImportDto(row, transactions.length),
    transactions,
  };
}
