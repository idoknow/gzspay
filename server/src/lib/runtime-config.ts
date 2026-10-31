import { config } from "../config.js";
import { queryAll, setConfigValue } from "../db/index.js";
import { writeAudit } from "./audit.js";
import { resetTransporter } from "./mail.js";

/**
 * 可运行时调整的配置：存在 app_config 表，启动时叠加到 config 上，
 * 这样后台改动（金额上限、邮件服务等）无需重启即可生效。
 */

interface KeyValue {
  key: string;
  value: string;
}

const SECURITY_KEYS = {
  paymentPasswordMaxAttempts: "security.paymentPasswordMaxAttempts",
  paymentPasswordLockMinutes: "security.paymentPasswordLockMinutes",
  singlePaymentLimitCents: "security.orderMaxAmountCents",
  dailyPaymentLimitCents: "security.dailyMaxAmountCents",
  dynamicCodeTtlSeconds: "security.dynamicCodeTtlSeconds",
  emailCodeTtlSeconds: "security.emailCodeTtlMinutes",
  sessionTtlDays: "security.sessionTtlDays",
} as const;

const MAIL_KEYS = {
  host: "mail.host",
  port: "mail.port",
  secure: "mail.secure",
  username: "mail.username",
  password: "mail.password",
  fromName: "mail.fromName",
  fromAddress: "mail.fromAddress",
} as const;

function storedMap(): Map<string, string> {
  const rows = queryAll<KeyValue>(
    "SELECT key, value FROM app_config WHERE key LIKE 'mail.%' OR key LIKE 'security.%'",
  );
  return new Map(rows.map((row) => [row.key, row.value]));
}

function toIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface MailConfigView {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromName: string;
  fromAddress: string;
  passwordConfigured: boolean;
}

export interface SecurityConfigView {
  paymentPasswordMaxAttempts: number;
  paymentPasswordLockMinutes: number;
  singlePaymentLimitCents: number;
  dailyPaymentLimitCents: number;
  dynamicCodeTtlSeconds: number;
  emailCodeTtlSeconds: number;
  sessionTtlDays: number;
}

export interface AdminConfigView {
  mail: MailConfigView;
  security: SecurityConfigView;
}

function splitFrom(from: string): { fromName: string; fromAddress: string } {
  const match = /^(.*)<([^>]+)>$/.exec(from.trim());
  if (match) {
    return { fromName: (match[1] ?? "").trim() || "gzspay", fromAddress: (match[2] ?? "").trim() };
  }
  return { fromName: "gzspay", fromAddress: from.trim() };
}

export function readAdminConfig(): AdminConfigView {
  const stored = storedMap();
  const { fromName, fromAddress } = splitFrom(config.smtp.from);
  return {
    mail: {
      host: stored.get(MAIL_KEYS.host) ?? config.smtp.host ?? "",
      port: toIntOr(stored.get(MAIL_KEYS.port), config.smtp.port),
      secure: (stored.get(MAIL_KEYS.secure) ?? String(config.smtp.secure)) === "true",
      username: stored.get(MAIL_KEYS.username) ?? config.smtp.user ?? "",
      fromName: stored.get(MAIL_KEYS.fromName) ?? fromName,
      fromAddress: stored.get(MAIL_KEYS.fromAddress) ?? fromAddress,
      passwordConfigured: Boolean(stored.get(MAIL_KEYS.password) ?? config.smtp.pass),
    },
    security: {
      paymentPasswordMaxAttempts: toIntOr(
        stored.get(SECURITY_KEYS.paymentPasswordMaxAttempts),
        config.security.paymentMaxAttempts,
      ),
      paymentPasswordLockMinutes: toIntOr(
        stored.get(SECURITY_KEYS.paymentPasswordLockMinutes),
        config.security.paymentLockMinutes,
      ),
      singlePaymentLimitCents: toIntOr(
        stored.get(SECURITY_KEYS.singlePaymentLimitCents),
        config.security.orderMaxAmountCents,
      ),
      dailyPaymentLimitCents: toIntOr(
        stored.get(SECURITY_KEYS.dailyPaymentLimitCents),
        config.security.dailyMaxAmountCents,
      ),
      dynamicCodeTtlSeconds: toIntOr(
        stored.get(SECURITY_KEYS.dynamicCodeTtlSeconds),
        config.security.dynamicCodeTtlSeconds,
      ),
      emailCodeTtlSeconds: toIntOr(
        stored.get(SECURITY_KEYS.emailCodeTtlSeconds),
        config.security.emailCodeTtlMinutes * 60,
      ),
      sessionTtlDays: toIntOr(stored.get(SECURITY_KEYS.sessionTtlDays), config.sessionTtlDays),
    },
  };
}

/** config 对象声明为 const 断言（只读），运行时配置需要就地覆盖，这里做一次结构化类型转换 */
interface MutableConfig {
  smtp: {
    host: string | null;
    port: number;
    secure: boolean;
    user: string | null;
    pass: string | null;
    from: string;
  };
  security: {
    paymentMaxAttempts: number;
    paymentLockMinutes: number;
    orderMaxAmountCents: number;
    dailyMaxAmountCents: number;
    dynamicCodeTtlSeconds: number;
    emailCodeTtlMinutes: number;
  };
  sessionTtlDays: number;
}

const mutableConfig = config as unknown as MutableConfig;

/** 把 app_config 中的覆盖值写回内存 config（服务运行期间即时生效） */
export function applyRuntimeConfig(): void {
  const stored = storedMap();
  const view = readAdminConfig();
  const { mail, security } = view;
  mutableConfig.smtp.host = mail.host || null;
  mutableConfig.smtp.port = mail.port;
  mutableConfig.smtp.secure = mail.secure;
  mutableConfig.smtp.user = mail.username || null;
  mutableConfig.smtp.pass = stored.get(MAIL_KEYS.password) ?? mutableConfig.smtp.pass ?? null;
  mutableConfig.smtp.from = `${mail.fromName || "gzspay"} <${mail.fromAddress || "no-reply@gzspay.local"}>`;
  resetTransporter();

  mutableConfig.security.paymentMaxAttempts = security.paymentPasswordMaxAttempts;
  mutableConfig.security.paymentLockMinutes = security.paymentPasswordLockMinutes;
  mutableConfig.security.orderMaxAmountCents = security.singlePaymentLimitCents;
  mutableConfig.security.dailyMaxAmountCents = security.dailyPaymentLimitCents;
  mutableConfig.security.dynamicCodeTtlSeconds = security.dynamicCodeTtlSeconds;
  mutableConfig.security.emailCodeTtlMinutes = Math.max(
    1,
    Math.round(security.emailCodeTtlSeconds / 60),
  );
  mutableConfig.sessionTtlDays = security.sessionTtlDays;
}

export interface SaveConfigInput {
  mail: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    fromName: string;
    fromAddress: string;
    password?: string;
  };
  security: SecurityConfigView;
}

export function saveAdminConfig(actorId: string, input: SaveConfigInput, ip: string): void {
  const { mail, security } = input;
  setConfigValue(MAIL_KEYS.host, mail.host.trim());
  setConfigValue(MAIL_KEYS.port, String(mail.port));
  setConfigValue(MAIL_KEYS.secure, String(mail.secure));
  setConfigValue(MAIL_KEYS.username, mail.username.trim());
  setConfigValue(MAIL_KEYS.fromName, mail.fromName.trim());
  setConfigValue(MAIL_KEYS.fromAddress, mail.fromAddress.trim());
  if (mail.password !== undefined && mail.password !== "") {
    setConfigValue(MAIL_KEYS.password, mail.password);
  }
  setConfigValue(SECURITY_KEYS.paymentPasswordMaxAttempts, String(security.paymentPasswordMaxAttempts));
  setConfigValue(SECURITY_KEYS.paymentPasswordLockMinutes, String(security.paymentPasswordLockMinutes));
  setConfigValue(SECURITY_KEYS.singlePaymentLimitCents, String(security.singlePaymentLimitCents));
  setConfigValue(SECURITY_KEYS.dailyPaymentLimitCents, String(security.dailyPaymentLimitCents));
  setConfigValue(SECURITY_KEYS.dynamicCodeTtlSeconds, String(security.dynamicCodeTtlSeconds));
  setConfigValue(SECURITY_KEYS.emailCodeTtlSeconds, String(security.emailCodeTtlSeconds));
  setConfigValue(SECURITY_KEYS.sessionTtlDays, String(security.sessionTtlDays));
  applyRuntimeConfig();
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.config.updated",
    targetType: "app_config",
    targetId: null,
    detail: "更新系统配置（邮件服务与安全防护）",
    ip,
  });
}
