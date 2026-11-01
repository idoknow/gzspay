import { config } from "../config.js";
import { queryAll, queryOne, setConfigValue } from "../db/index.js";
import { writeAudit } from "./audit.js";
import { resetTransporter } from "./mail.js";

/**
 * 可运行时调整的配置：存在 app_config 表，启动时叠加到 config 上，
 * 这样后台改动（校园墙登录、邮件服务、安全防护、站点信息）无需重启即可生效。
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

const CAMPUX_KEYS = {
  baseUrl: "campux.baseUrl",
  clientId: "campux.clientId",
  clientSecret: "campux.clientSecret",
  scope: "campux.scope",
} as const;

const SYSTEM_KEYS = {
  siteName: "system.siteName",
  adminQq: "system.adminQq",
  publicBaseUrl: "system.publicBaseUrl",
  initialized: "system.initialized",
} as const;

const DEFAULT_SITE_NAME = "gzspay 桂中校园支付";

/**
 * app_config 的读取非常频繁：systemGate 每个 /api 请求都要判断系统是否初始化、
 * 校园墙是否配置。原来每个请求都会扫一遍 app_config 表，这里加一层短 TTL 缓存，
 * 配置写入时主动失效，写入后立即生效。
 */
const STORED_CONFIG_TTL_MS = 2000;
let storedCache: { at: number; map: Map<string, string> } | null = null;
let readyCache: { at: number; value: boolean } | null = null;

/** 配置变更后调用，让下一次读取重新查库 */
export function invalidateRuntimeConfigCache(): void {
  storedCache = null;
  readyCache = null;
}

function storedMap(): Map<string, string> {
  const now = Date.now();
  if (storedCache && now - storedCache.at < STORED_CONFIG_TTL_MS) {
    return storedCache.map;
  }
  const rows = queryAll<KeyValue>("SELECT key, value FROM app_config");
  const map = new Map(rows.map((row) => [row.key, row.value]));
  storedCache = { at: now, map };
  return map;
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

export interface CampuxConfigView {
  baseUrl: string;
  clientId: string;
  clientSecretConfigured: boolean;
  scope: string;
}

export interface SystemConfigView {
  siteName: string;
  adminQq: string;
  publicBaseUrl: string;
}

export interface AdminConfigView {
  campux: CampuxConfigView;
  mail: MailConfigView;
  security: SecurityConfigView;
  system: SystemConfigView;
}

function splitFrom(from: string): { fromName: string; fromAddress: string } {
  const match = /^(.*)<([^>]+)>$/.exec(from.trim());
  if (match) {
    return { fromName: (match[1] ?? "").trim() || "gzspay", fromAddress: (match[2] ?? "").trim() };
  }
  return { fromName: "gzspay", fromAddress: from.trim() };
}

export function readMailConfig(): MailConfigView {
  const stored = storedMap();
  const { fromName, fromAddress } = splitFrom(config.smtp.from);
  return {
    host: stored.get(MAIL_KEYS.host) ?? config.smtp.host ?? "",
    port: toIntOr(stored.get(MAIL_KEYS.port), config.smtp.port),
    secure: (stored.get(MAIL_KEYS.secure) ?? String(config.smtp.secure)) === "true",
    username: stored.get(MAIL_KEYS.username) ?? config.smtp.user ?? "",
    fromName: stored.get(MAIL_KEYS.fromName) ?? fromName,
    fromAddress: stored.get(MAIL_KEYS.fromAddress) ?? fromAddress,
    passwordConfigured: Boolean(stored.get(MAIL_KEYS.password) ?? config.smtp.pass),
  };
}

export function readCampuxConfig(): CampuxConfigView {
  const stored = storedMap();
  return {
    baseUrl: stored.get(CAMPUX_KEYS.baseUrl) ?? config.campux.baseUrl,
    clientId: stored.get(CAMPUX_KEYS.clientId) ?? config.campux.clientId,
    clientSecretConfigured: Boolean(
      stored.get(CAMPUX_KEYS.clientSecret) ?? config.campux.clientSecret,
    ),
    scope: stored.get(CAMPUX_KEYS.scope) ?? config.campux.scope,
  };
}

export function readSystemConfig(): SystemConfigView {
  const stored = storedMap();
  return {
    siteName: stored.get(SYSTEM_KEYS.siteName) ?? DEFAULT_SITE_NAME,
    adminQq: stored.get(SYSTEM_KEYS.adminQq) ?? "",
    publicBaseUrl: stored.get(SYSTEM_KEYS.publicBaseUrl) ?? config.publicBaseUrl,
  };
}

/** 系统是否已完成初始化（配置完成且已有管理员） */
export function readInitializedFlag(): boolean {
  return (storedMap().get(SYSTEM_KEYS.initialized) ?? "") === "1";
}

export function readAdminConfig(): AdminConfigView {
  const stored = storedMap();
  const mail = readMailConfig();
  return {
    campux: readCampuxConfig(),
    mail,
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
    system: readSystemConfig(),
  };
}

/** config 对象声明为 const 断言（只读），运行时配置需要就地覆盖，这里做一次结构化类型转换 */
interface MutableConfig {
  publicBaseUrl: string;
  campux: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scope: string;
  };
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
  const { mail, security, campux, system } = view;

  mutableConfig.campux.baseUrl = campux.baseUrl.replace(/\/+$/, "");
  mutableConfig.campux.clientId = campux.clientId;
  mutableConfig.campux.clientSecret =
    stored.get(CAMPUX_KEYS.clientSecret) ?? mutableConfig.campux.clientSecret;
  mutableConfig.campux.scope = campux.scope;
  mutableConfig.publicBaseUrl = system.publicBaseUrl.replace(/\/+$/, "");
  mutableConfig.campux.redirectUri = `${mutableConfig.publicBaseUrl}/api/auth/callback`;

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

export interface SaveMailInput {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromName: string;
  fromAddress: string;
  /** 空字符串或未提供表示保留已保存的密码 */
  password?: string;
}

export interface SaveSecurityInput extends SecurityConfigView {}

export interface SaveCampuxInput {
  baseUrl: string;
  clientId: string;
  /** 空字符串或未提供表示保留已保存的密钥 */
  clientSecret?: string;
  scope: string;
}

export interface SaveSystemInput {
  siteName: string;
  adminQq: string;
  publicBaseUrl: string;
}

function writeMail(input: SaveMailInput): void {
  setConfigValue(MAIL_KEYS.host, input.host.trim());
  setConfigValue(MAIL_KEYS.port, String(input.port));
  setConfigValue(MAIL_KEYS.secure, String(input.secure));
  setConfigValue(MAIL_KEYS.username, input.username.trim());
  setConfigValue(MAIL_KEYS.fromName, input.fromName.trim());
  setConfigValue(MAIL_KEYS.fromAddress, input.fromAddress.trim());
  if (input.password !== undefined && input.password !== "") {
    setConfigValue(MAIL_KEYS.password, input.password);
  }
}

function writeCampux(input: SaveCampuxInput): void {
  setConfigValue(CAMPUX_KEYS.baseUrl, input.baseUrl.trim().replace(/\/+$/, ""));
  setConfigValue(CAMPUX_KEYS.clientId, input.clientId.trim());
  setConfigValue(CAMPUX_KEYS.scope, input.scope.trim() || "profile");
  if (input.clientSecret !== undefined && input.clientSecret !== "") {
    setConfigValue(CAMPUX_KEYS.clientSecret, input.clientSecret);
  }
}

function writeSystem(input: SaveSystemInput): void {
  setConfigValue(SYSTEM_KEYS.siteName, input.siteName.trim() || DEFAULT_SITE_NAME);
  setConfigValue(SYSTEM_KEYS.adminQq, input.adminQq.trim());
  setConfigValue(
    SYSTEM_KEYS.publicBaseUrl,
    input.publicBaseUrl.trim().replace(/\/+$/, "") || config.appBaseUrl,
  );
}

function writeSecurity(input: SaveSecurityInput): void {
  setConfigValue(SECURITY_KEYS.paymentPasswordMaxAttempts, String(input.paymentPasswordMaxAttempts));
  setConfigValue(SECURITY_KEYS.paymentPasswordLockMinutes, String(input.paymentPasswordLockMinutes));
  setConfigValue(SECURITY_KEYS.singlePaymentLimitCents, String(input.singlePaymentLimitCents));
  setConfigValue(SECURITY_KEYS.dailyPaymentLimitCents, String(input.dailyPaymentLimitCents));
  setConfigValue(SECURITY_KEYS.dynamicCodeTtlSeconds, String(input.dynamicCodeTtlSeconds));
  setConfigValue(SECURITY_KEYS.emailCodeTtlSeconds, String(input.emailCodeTtlSeconds));
  setConfigValue(SECURITY_KEYS.sessionTtlDays, String(input.sessionTtlDays));
}

export interface SaveConfigInput {
  campux?: SaveCampuxInput;
  mail?: SaveMailInput;
  security?: SaveSecurityInput;
  system?: SaveSystemInput;
}

/** 写回 app_config（mail / campux / system / security 均可选），并立即生效 */
export function writeRuntimeConfig(input: SaveConfigInput): void {
  // 先失效缓存，保证接下来的 applyRuntimeConfig 读到刚写入的值
  invalidateRuntimeConfigCache();
  if (input.campux) writeCampux(input.campux);
  if (input.mail) writeMail(input.mail);
  if (input.system) writeSystem(input.system);
  if (input.security) writeSecurity(input.security);
  applyRuntimeConfig();
  invalidateRuntimeConfigCache();
}

/** 后台「系统配置」保存入口（保留旧签名，供管理后台使用） */
export function saveAdminConfig(actorId: string, input: SaveConfigInput, ip: string): void {
  writeRuntimeConfig(input);
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.config.updated",
    targetType: "app_config",
    targetId: null,
    detail: "更新系统配置（校园墙登录、邮件服务、安全防护与站点信息）",
    ip,
  });
}

/** 标记系统已完成初始化 */
export function markInitialized(): void {
  setConfigValue(SYSTEM_KEYS.initialized, "1");
  invalidateRuntimeConfigCache();
}

export function countAdmins(): number {
  const row = queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM admins");
  return row ? Number(row.count) : 0;
}

export function isSystemReady(): boolean {
  const now = Date.now();
  if (readyCache && now - readyCache.at < STORED_CONFIG_TTL_MS) return readyCache.value;
  const value = readInitializedFlag() || countAdmins() > 0;
  readyCache = { at: now, value };
  return value;
}

/** 校园墙登录是否可用（运行期配置优先，环境变量兜底） */
export function isCampuxReady(): boolean {
  const campux = readCampuxConfig();
  return Boolean(campux.clientId && config.campux.clientSecret);
}

/** 邮件服务是否可用（运行期配置优先） */
export function isMailReady(): boolean {
  return Boolean(readMailConfig().host);
}

export const CONFIG_KEYS = { SECURITY_KEYS, MAIL_KEYS, CAMPUX_KEYS, SYSTEM_KEYS } as const;
