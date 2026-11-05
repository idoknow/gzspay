import { execute, nowIso, queryAll } from "../db/index.js";
import { csvCell } from "./csv.js";
import { newId } from "./crypto.js";
import { CHANNEL_LABELS } from "./types.js";
import type { Channel, OrderStatus, UserRow } from "./types.js";

export interface AuditEntry {
  actorId: string | null;
  actorRole: "user" | "merchant" | "admin" | "system";
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: string | null;
  ip?: string | null;
}

/** 操作日志：只允许追加，不提供修改/删除接口 */
export function writeAudit(entry: AuditEntry): void {
  execute(
    `INSERT INTO audit_logs (id, actor_id, actor_role, action, target_type, target_id, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    entry.actorId,
    entry.actorRole,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.detail ?? null,
    entry.ip ?? null,
    nowIso(),
  );
}

export function writeLoginLog(params: {
  userId: string | null;
  campuxSub?: string | null;
  method?: string | null;
  success: boolean;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): void {
  execute(
    `INSERT INTO login_logs (id, user_id, campux_sub, method, result, reason, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    params.userId,
    params.campuxSub ?? null,
    params.method ?? null,
    params.success ? "success" : "fail",
    params.reason ?? null,
    params.ip ?? null,
    (params.userAgent ?? "").slice(0, 300) || null,
    nowIso(),
  );
}

/** 风控日志：支付密码错误、限制触发等 */
export function writeRiskLog(params: {
  userId: string | null;
  type: string;
  detail: string;
  ip?: string | null;
}): void {
  execute(
    `INSERT INTO risk_logs (id, user_id, type, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    newId(),
    params.userId,
    params.type,
    params.detail,
    params.ip ?? null,
    nowIso(),
  );
}

export function writeSystemError(params: {
  scope: string;
  message: string;
  stack?: string | null;
  context?: string | null;
}): void {
  const message = params.context
    ? `${params.message.slice(0, 900)} [${params.context.slice(0, 200)}]`
    : params.message.slice(0, 1000);
  execute(
    `INSERT INTO system_errors (id, source, message, stack, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    newId(),
    params.scope,
    message,
    params.stack ? params.stack.slice(0, 4000) : null,
    nowIso(),
  );
}

export function writeMailOutbox(params: {
  to: string;
  subject: string;
  text: string;
  kind: string;
  status: "queued" | "sent" | "failed" | "skipped";
  error?: string | null;
}): void {
  execute(
    `INSERT INTO mail_outbox (id, to_email, subject, body, kind, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    params.to,
    params.subject,
    params.text,
    params.kind,
    params.status,
    params.error ?? null,
    nowIso(),
  );
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "待付款",
  paid: "已支付",
  completed: "已完成",
  cancelled: "已取消",
};

export const ORDER_STATUS_TAG_LABELS: Record<OrderStatus, string> = {
  pending_payment: "待处理",
  paid: "已支付",
  completed: "已结束",
  cancelled: "已结束",
};

export function channelLabel(channel: Channel | null | undefined): string {
  if (!channel) return "未标记";
  return CHANNEL_LABELS[channel];
}

/** 导出 CSV：转义引号/逗号，并防止 Excel 当公式执行（CSV 注入） */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map((value) => csvCell(value)).join(",")];
  for (const row of rows) {
    lines.push(row.map((value) => csvCell(value)).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** 批量取用户，避免 N+1 查询 */
export function queryUsersByIds(ids: string[]): Map<string, UserRow> {
  const unique = [...new Set(ids.filter(Boolean))];
  const result = new Map<string, UserRow>();
  if (unique.length === 0) return result;
  const placeholders = unique.map(() => "?").join(",");
  const rows = queryAll<UserRow>(
    `SELECT * FROM users WHERE id IN (${placeholders})`,
    ...unique,
  );
  for (const row of rows) result.set(row.id, row);
  return result;
}

/** 批量取展示名（用于列表/日志展示） */
export function displayNamesByIds(ids: string[]): Map<string, string> {
  const users = queryUsersByIds(ids);
  const result = new Map<string, string>();
  for (const [id, user] of users) {
    const full = [user.surname, user.given_name].filter(Boolean).join("");
    result.set(id, full || user.campux_username || "同学");
  }
  return result;
}
