/**
 * 上传文件保留期清理。
 *
 * 后台可配置：
 * - 账单原文件：默认保留 1 天；
 * - 付款截图：默认保留 15 天（同时清空订单上的 payment_proof，避免读到失效文件）。
 *
 * 由 server/src/index.ts 的每小时清理任务调用。
 */

import { execute, isoAfter, queryAll } from "../db/index.js";
import { readSystemConfig } from "./runtime-config.js";
import { removePaymentProofFile } from "./payment-proof.js";
import { removeBillUploadFile } from "../services/reconciliation.js";

export interface RetentionCleanupResult {
  bills: number;
  paymentProofs: number;
}

export function cleanupUploadRetention(): RetentionCleanupResult {
  const system = readSystemConfig();
  let bills = 0;
  let paymentProofs = 0;

  const billCutoff = isoAfter(-system.billRetentionDays * 86_400);
  const expiredImports = queryAll<{ id: string; stored_name: string | null }>(
    "SELECT id, stored_name FROM bill_imports WHERE created_at < ?",
    billCutoff,
  );
  for (const item of expiredImports) {
    removeBillUploadFile(item.stored_name);
    execute("DELETE FROM bill_transactions WHERE import_id = ?", item.id);
    execute("DELETE FROM bill_imports WHERE id = ?", item.id);
    bills += 1;
  }

  const proofCutoff = isoAfter(-system.paymentProofRetentionDays * 86_400);
  const expiredProofs = queryAll<{ id: string; payment_proof: string }>(
    "SELECT id, payment_proof FROM orders WHERE payment_proof IS NOT NULL AND created_at < ?",
    proofCutoff,
  );
  for (const item of expiredProofs) {
    removePaymentProofFile(item.payment_proof);
    execute("UPDATE orders SET payment_proof = NULL, updated_at = ? WHERE id = ?", isoAfter(0), item.id);
    paymentProofs += 1;
  }

  return { bills, paymentProofs };
}
