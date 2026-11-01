import { config, isSmtpConfigured } from "../config.js";
import { queryAll, nowIso } from "../db/index.js";
import { writeSystemError } from "./audit.js";
import { sendMailInBackground } from "./mail.js";

/**
 * 严重系统错误主动告警。
 *
 * 处理流程：
 * 1. 所有错误先写入 system_errors（后台「系统状态 → 系统错误」可查）；
 * 2. 命中告警条件时，通过邮件通知有邮箱的管理员，并可选推送到 Webhook
 *    （企业微信 / 钉钉 / 飞书群机器人等，只要接受 JSON POST 即可）；
 * 3. 同一类错误在 ALERT_THROTTLE_MINUTES 内只告警一次，期间再次出现的次数合并到下一次，
 *    并且每小时最多告警 ALERT_MAX_PER_HOUR 次，避免故障期间把邮箱和群聊刷爆。
 */

export interface SystemAlertInput {
  scope: string;
  message: string;
  stack?: string | null;
  context?: string | null;
}

export type AlertSkipReason = "disabled" | "throttled" | "hourly_limit";

export interface AlertDispatchResult {
  /** 是否真的发出了主动告警 */
  alerted: boolean;
  /** 被合并的同类错误数量（下次告警时一并说明） */
  suppressed: number;
  reason?: AlertSkipReason;
}

interface ThrottleEntry {
  lastAt: number;
  suppressed: number;
}

const THROTTLE_WINDOW_MS = 60 * 1000;
const MAX_TRACKED_KEYS = 500;

const throttle = new Map<string, ThrottleEntry>();
let hourlySends: number[] = [];
let lastAlertAt: string | null = null;
let dispatchedLastHour: number[] = [];

/** 归一化错误文案：数字与随机 ID 替换成占位符，让「同一类错误」能命中同一个桶 */
export function alertKeyOf(scope: string, message: string): string {
  const normalized = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `${scope}:${normalized}`;
}

function windowMs(): number {
  return Math.max(0, config.alerts.throttleMinutes) * THROTTLE_WINDOW_MS;
}

function pruneThrottle(now: number): void {
  if (throttle.size <= MAX_TRACKED_KEYS) return;
  const limit = windowMs();
  for (const [key, entry] of throttle) {
    if (now - entry.lastAt > limit) throttle.delete(key);
  }
}

/** 判断这次是否需要主动告警（会推进节流状态） */
export function shouldDispatchAlert(
  key: string,
  now = Date.now(),
): { allowed: boolean; suppressed: number; reason?: AlertSkipReason } {
  pruneThrottle(now);
  const entry = throttle.get(key);
  const limit = windowMs();
  if (entry && limit > 0 && now - entry.lastAt < limit) {
    entry.suppressed += 1;
    return { allowed: false, suppressed: entry.suppressed, reason: "throttled" };
  }
  const hourAgo = now - 60 * 60 * 1000;
  hourlySends = hourlySends.filter((at) => at >= hourAgo);
  if (hourlySends.length >= Math.max(1, config.alerts.maxPerHour)) {
    return { allowed: false, suppressed: entry?.suppressed ?? 0, reason: "hourly_limit" };
  }
  const suppressed = entry?.suppressed ?? 0;
  throttle.set(key, { lastAt: now, suppressed: 0 });
  hourlySends.push(now);
  return { allowed: true, suppressed };
}

/** 邮件告警收件人：启用中且填了邮箱的管理员 */
export function alertRecipients(): string[] {
  const rows = queryAll<{ email: string }>(
    `SELECT u.email FROM admins a JOIN users u ON u.id = a.user_id
     WHERE u.email IS NOT NULL AND u.email <> '' AND u.status = 'active'`,
  );
  return [...new Set(rows.map((row) => row.email))];
}

export function buildAlertSubject(input: SystemAlertInput): string {
  return `【gzspay】系统错误告警：${input.scope}`;
}

export function buildAlertText(input: SystemAlertInput, suppressed: number): string {
  const lines = [
    "gzspay 检测到严重系统错误，请尽快排查。",
    "",
    `时间：${new Date().toISOString()}`,
    `环境：${config.nodeEnv}（v${config.version}）`,
    `来源：${input.scope}`,
  ];
  if (input.context) lines.push(`上下文：${input.context}`);
  lines.push(`错误：${input.message}`);
  if (suppressed > 0) {
    lines.push(`说明：同类错误在最近 ${config.alerts.throttleMinutes} 分钟内还有 ${suppressed} 次未单独告警。`);
  }
  if (input.stack) {
    lines.push("", "堆栈：", input.stack.slice(0, 2000));
  }
  lines.push("", `管理后台：${config.publicBaseUrl}/admin`, "", "—— 本邮件由系统自动发送，请勿直接回复。");
  return lines.join("\n");
}

export interface AlertPayload {
  event: "system_error";
  scope: string;
  message: string;
  context: string | null;
  stack: string | null;
  suppressed: number;
  environment: string;
  version: string;
  occurredAt: string;
}

export function buildAlertPayload(input: SystemAlertInput, suppressed: number): AlertPayload {
  return {
    event: "system_error",
    scope: input.scope,
    message: input.message.slice(0, 1000),
    context: input.context ?? null,
    stack: input.stack ? input.stack.slice(0, 2000) : null,
    suppressed,
    environment: config.nodeEnv,
    version: config.version,
    occurredAt: new Date().toISOString(),
  };
}

async function postWebhook(payload: AlertPayload): Promise<void> {
  const url = config.alerts.webhookUrl;
  if (!url) return;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Math.max(1000, config.alerts.webhookTimeoutMs)),
    });
    if (!response.ok) {
      // 告警通道自身失败只记录，不再递归告警
      writeSystemError({
        scope: "alert",
        message: `告警 Webhook 返回 ${response.status}`,
        context: `scope=${payload.scope}`,
      });
    }
  } catch (error) {
    writeSystemError({
      scope: "alert",
      message: `告警 Webhook 发送失败：${error instanceof Error ? error.message : String(error)}`,
      context: `scope=${payload.scope}`,
    });
  }
}

function dispatch(input: SystemAlertInput, suppressed: number): void {
  const payload = buildAlertPayload(input, suppressed);
  lastAlertAt = nowIso();
  dispatchedLastHour.push(Date.now());
  const hourAgo = Date.now() - 60 * 60 * 1000;
  dispatchedLastHour = dispatchedLastHour.filter((at) => at >= hourAgo);
  void postWebhook(payload);
  if (!config.alerts.emailEnabled || !isSmtpConfigured()) return;
  const subject = buildAlertSubject(input);
  const text = buildAlertText(input, suppressed);
  for (const to of alertRecipients()) {
    // kind=system_alert：邮件失败时不会再触发一次告警，避免递归
    sendMailInBackground({ to, subject, text, kind: "system_alert" });
  }
}

/** 告警通道是否可用（Webhook 或「管理员邮箱 + SMTP」至少有一个） */
export function isAlertChannelReady(): boolean {
  if (config.alerts.webhookUrl) return true;
  return config.alerts.emailEnabled && isSmtpConfigured() && alertRecipients().length > 0;
}

/** 记录系统错误并按需主动告警；所有错误都会写入 system_errors */
export function reportSystemError(input: SystemAlertInput): AlertDispatchResult {
  writeSystemError({
    scope: input.scope,
    message: input.message,
    stack: input.stack ?? null,
    context: input.context ?? null,
  });
  if (!isAlertChannelReady()) return { alerted: false, suppressed: 0, reason: "disabled" };
  const decision = shouldDispatchAlert(alertKeyOf(input.scope, input.message));
  if (!decision.allowed) {
    return { alerted: false, suppressed: decision.suppressed, reason: decision.reason };
  }
  dispatch(input, decision.suppressed);
  return { alerted: true, suppressed: decision.suppressed };
}

/** 供管理后台「系统状态」展示告警通道与最近告警情况 */
export function alertStatus(): {
  webhookConfigured: boolean;
  emailEnabled: boolean;
  recipients: number;
  lastAlertAt: string | null;
  dispatchedLastHour: number;
} {
  return {
    webhookConfigured: Boolean(config.alerts.webhookUrl),
    emailEnabled: config.alerts.emailEnabled && isSmtpConfigured(),
    recipients: alertRecipients().length,
    lastAlertAt,
    dispatchedLastHour: dispatchedLastHour.length,
  };
}

/** 测试用：清空节流与统计状态 */
export function resetAlertsForTest(): void {
  throttle.clear();
  hourlySends = [];
  dispatchedLastHour = [];
  lastAlertAt = null;
}
