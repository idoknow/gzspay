/**
 * 付款截图存储。
 *
 * 截图里往往有转账单号、收款人姓名等敏感信息，所以不放进公开的 `/media`：
 * 文件落在数据目录下的 `payment-proofs/`，只能通过鉴权接口
 * `GET /api/orders/:id/payment-proof` 读取（仅订单双方可看）。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";
import { errors } from "./errors.js";
import { imageExtension, sniffImageKind } from "./image.js";

/** 单张截图大小上限 */
const MAX_BYTES = 5 * 1024 * 1024;

/** 只接受服务端自己生成的文件名，避免路径穿越 */
const FILENAME_PATTERN = /^[A-Za-z0-9_-]+\.(png|jpg)$/;

function storageDir(): string {
  const dbPath = config.databasePath;
  const base = dbPath === ":memory:" ? path.join(os.tmpdir(), "gzspay-payment-proofs") : path.dirname(dbPath);
  return path.join(base, "payment-proofs");
}

/** 保存上传的截图，返回落盘文件名（写进 orders.payment_proof） */
export function savePaymentProofFile(orderId: string, buffer: Buffer | undefined): string {
  if (!buffer || buffer.length === 0) throw errors.validation("请上传付款截图");
  if (buffer.length > MAX_BYTES) throw errors.validation("付款截图不能超过 5MB");
  const kind = sniffImageKind(buffer);
  if (!kind) throw errors.validation("请上传 PNG 或 JPG 图片格式的付款截图");
  const dir = storageDir();
  mkdirSync(dir, { recursive: true });
  const filename = `${orderId}-${Date.now()}.${imageExtension(kind)}`;
  writeFileSync(path.join(dir, filename), buffer);
  return filename;
}

/** 读取截图内容，文件不存在或文件名非法时返回 null */
export function readPaymentProofFile(filename: string): { data: Buffer; contentType: string } | null {
  if (!FILENAME_PATTERN.test(filename)) return null;
  try {
    const data = readFileSync(path.join(storageDir(), filename));
    const contentType = filename.endsWith(".png") ? "image/png" : "image/jpeg";
    return { data, contentType };
  } catch {
    return null;
  }
}

/** 删除截图文件（订单退回待付款或重新上传时清理旧图） */
export function removePaymentProofFile(filename: string | null | undefined): void {
  if (!filename || !FILENAME_PATTERN.test(filename)) return;
  try {
    rmSync(path.join(storageDir(), filename), { force: true });
  } catch {
    // 清理失败不影响主流程
  }
}
