import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/src -> server -> 仓库根 */
export const REPO_ROOT = path.resolve(here, "..", "..");
export const SERVER_ROOT = path.resolve(here, "..");

// 依次加载仓库根与 server/ 下的 .env，已存在的环境变量优先
for (const file of [path.join(REPO_ROOT, ".env"), path.join(SERVER_ROOT, ".env")]) {
  if (existsSync(file)) {
    dotenv.config({ path: file, override: false, quiet: true });
  }
}

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function optionalStr(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? null : value.trim();
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

const nodeEnv = str("NODE_ENV", "development");
const isProduction = nodeEnv === "production";
const appBaseUrl = str("APP_BASE_URL", "http://localhost:5173").replace(/\/+$/, "");
const publicBaseUrl = str("PUBLIC_BASE_URL", appBaseUrl).replace(/\/+$/, "");

export const config = {
  version: "0.1.0",
  nodeEnv,
  isProduction,
  isTest: nodeEnv === "test",
  port: int("PORT", 3000),
  appBaseUrl,
  publicBaseUrl,

  databasePath: str("DATABASE_PATH", path.join(SERVER_ROOT, "data", "gzspay.sqlite")),
  uploadDir: str("UPLOAD_DIR", path.join(SERVER_ROOT, "data", "uploads")),
  avatarDir: str("AVATAR_DIR", path.join(SERVER_ROOT, "data", "avatars")),
  webDistDir: str("WEB_DIST_DIR", path.join(REPO_ROOT, "web", "dist")),

  sessionSecret: str("SESSION_SECRET", "dev-only-session-secret-change-me"),
  sessionCookieName: "gzs_session",
  adminCookieName: "gzs_admin",
  sessionTtlDays: int("SESSION_TTL_DAYS", 7),
  adminSessionTtlMinutes: int("ADMIN_SESSION_TTL_MINUTES", 30),

  campux: {
    baseUrl: str("CAMPUX_BASE_URL", "https://campux.example.com").replace(/\/+$/, ""),
    clientId: str("CAMPUX_CLIENT_ID", ""),
    clientSecret: str("CAMPUX_CLIENT_SECRET", ""),
    redirectUri: str("CAMPUX_REDIRECT_URI", `${publicBaseUrl}/api/auth/callback`),
    tenantId: optionalStr("CAMPUX_TENANT_ID"),
    scope: str("CAMPUX_SCOPE", "profile tenant"),
    adminRedirectUri: str(
      "CAMPUX_ADMIN_REDIRECT_URI",
      `${publicBaseUrl}/api/admin/auth/callback`,
    ),
  },

  qqAvatarUrlTemplate: str(
    "QQ_AVATAR_URL_TEMPLATE",
    "https://q1.qlogo.cn/g?b=qq&nk={qq}&s=100",
  ),

  smtp: {
    host: optionalStr("SMTP_HOST"),
    port: int("SMTP_PORT", 465),
    secure: bool("SMTP_SECURE", true),
    user: optionalStr("SMTP_USER"),
    pass: optionalStr("SMTP_PASS"),
    from: str("MAIL_FROM", "gzspay <no-reply@gzspay.local>"),
  },

  security: {
    paymentLockMinutes: int("PAYMENT_LOCK_MINUTES", 30),
    paymentMaxAttempts: int("PAYMENT_MAX_ATTEMPTS", 5),
    orderMaxAmountCents: int("ORDER_MAX_AMOUNT_CENTS", 500_000),
    dailyMaxAmountCents: int("DAILY_MAX_AMOUNT_CENTS", 2_000_000),
    emailCodeTtlMinutes: int("EMAIL_CODE_TTL_MINUTES", 10),
    emailCodeResendSeconds: int("EMAIL_CODE_RESEND_SECONDS", 60),
    emailCodeMaxAttempts: int("EMAIL_CODE_MAX_ATTEMPTS", 5),
    passwordResetTokenTtlMinutes: 10,
    dynamicCodeTtlSeconds: 60,
    dynamicCodeRefreshSeconds: 30,
    paymentRequestTtlSeconds: 180,
  },

  dev: {
    authEnabled: bool("DEV_AUTH_ENABLED", !isProduction),
    sub: str("DEV_LOGIN_SUB", "dev-user-1"),
    name: str("DEV_LOGIN_NAME", "10001"),
    username: str("DEV_LOGIN_USERNAME", "测试同学"),
  },

  /** 测试环境可通过环境变量覆盖 */
  get testDatabasePath(): string {
    return process.env.TEST_DATABASE_PATH ?? ":memory:";
  },
} as const;

/** 校园墙 OAuth 是否已配置（未配置时登录会返回明确错误） */
export function isCampuxConfigured(): boolean {
  return Boolean(config.campux.clientId && config.campux.clientSecret);
}

/** 邮箱发件是否可用；未配置时邮件落到 outbox 表 */
export function isSmtpConfigured(): boolean {
  return Boolean(config.smtp.host);
}

/** 开发模式才允许把验证码回显到响应中，便于本地联调 */
export function canExposeDevCode(): boolean {
  return !config.isProduction;
}

export function resolvePathFromRepo(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(REPO_ROOT, p);
}

export function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(SERVER_ROOT, "package.json"), "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? config.version;
  } catch {
    return config.version;
  }
}
