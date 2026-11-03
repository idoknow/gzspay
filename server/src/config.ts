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
/** 额外的写请求来源白名单，逗号分隔（例如局域网开发地址 http://192.168.1.10:5173） */
const extraAllowedOrigins = str("EXTRA_ALLOWED_ORIGINS", "")
  .split(",")
  .map((item) => item.trim().replace(/\/+$/, ""))
  .filter(Boolean);

/** 读取 server/package.json 的版本号（仓库版本以此为准），失败时退回 0.0.0 */
function readPackageJsonVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(SERVER_ROOT, "package.json"), "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const config = {
  version: readPackageJsonVersion(),
  nodeEnv,
  isProduction,
  isTest: nodeEnv === "test",
  exposeEmailCode: bool("EMAIL_CODE_DEV_MODE", false),
  port: int("PORT", 3000),
  appBaseUrl,
  publicBaseUrl,
  extraAllowedOrigins,

  databasePath: str("DATABASE_PATH", path.join(SERVER_ROOT, "data", "gzspay.sqlite")),
  uploadDir: str("UPLOAD_DIR", path.join(SERVER_ROOT, "data", "uploads")),
  avatarDir: str("AVATAR_DIR", path.join(SERVER_ROOT, "data", "avatars")),
  webDistDir: str("WEB_DIST_DIR", path.join(REPO_ROOT, "web", "dist")),

  sessionSecret: str("SESSION_SECRET", "dev-only-session-secret-change-me"),
  sessionCookieName: "gzs_session",
  sessionTtlDays: int("SESSION_TTL_DAYS", 7),
  /** 内网 / 无 https 证书部署时显式放行 http 地址（见 lib/security.ts） */
  allowInsecureBaseUrl: bool("ALLOW_INSECURE_BASE_URL", false),
  /**
   * 反向代理层数：默认生产信任 1 层（Nginx），开发直连不信任。
   * 不放在代理后面却信任 X-Forwarded-For，会让攻击者伪造 IP 绕过限流。
   */
  trustProxy: str("TRUST_PROXY", isProduction ? "1" : "false"),

  campux: {
    baseUrl: optionalStr("CAMPUX_BASE_URL") ?? "",
    // 服务端调用校园墙接口（token / userinfo / revoke）时使用的地址。
    // 浏览器访问公网入口、但服务器无法直连该入口（例如同集群内反向解析）时可指向内网地址。
    internalBaseUrl: (optionalStr("CAMPUX_INTERNAL_BASE_URL") ?? "").replace(/\/+$/, ""),
    clientId: str("CAMPUX_CLIENT_ID", ""),
    clientSecret: str("CAMPUX_CLIENT_SECRET", ""),
    redirectUri: str("CAMPUX_REDIRECT_URI", `${publicBaseUrl}/api/auth/callback`),
    tenantId: optionalStr("CAMPUX_TENANT_ID"),
    scope: str("CAMPUX_SCOPE", "profile"),
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

  /** 严重系统错误主动告警：邮件通知管理员 + 可选的 Webhook（企业微信 / 钉钉 / 飞书群机器人） */
  alerts: {
    webhookUrl: optionalStr("ALERT_WEBHOOK_URL"),
    webhookTimeoutMs: int("ALERT_WEBHOOK_TIMEOUT_MS", 5000),
    emailEnabled: bool("ALERT_EMAIL_ENABLED", true),
    /** 同一类错误在该窗口内只告警一次（其余计数合并到下一次） */
    throttleMinutes: int("ALERT_THROTTLE_MINUTES", 10),
    /** 每小时最多主动告警次数，避免故障时刷屏 */
    maxPerHour: int("ALERT_MAX_PER_HOUR", 30),
  },

  /**
   * 地区访问限制：默认关闭；打开后只放行中国大陆 IP（依据 APNIC CN 分配段）。
   * 数据由 scripts/geo/build-cn-ranges.mjs 生成到 server/src/data/cn-ip-ranges.json。
   */
  geo: {
    blockNonChina: bool("GEO_BLOCK_NON_CHINA", false),
    /** CDN 回源国家码请求头（如 CF-IPCountry）；确认回源可信时才配置，否则可被伪造 */
    trustHeader: str("GEO_TRUST_HEADER", ""),
    /** 例外路径，逗号分隔；以 `/` 结尾表示前缀匹配，以 `*` 结尾表示通配 */
    bypassPaths: str(
      "GEO_BYPASS_PATHS",
      "/api/health,/theme-boot.js,/sw.js,/manifest.webmanifest,/favicon.ico",
    )
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    /** 白名单 IP 或 CIDR，逗号分隔（例如运维出口 / 海外管理员固定 IP） */
    ipWhitelist: str("GEO_IP_WHITELIST", ""),
    /** 归属未知时：deny = 拦截（默认），allow = 放行 */
    unknownPolicy: str("GEO_UNKNOWN_POLICY", "deny"),
  },

  security: {
    paymentLockMinutes: int("PAYMENT_LOCK_MINUTES", 30),
    paymentMaxAttempts: int("PAYMENT_MAX_ATTEMPTS", 5),
    orderMaxAmountCents: int("ORDER_MAX_AMOUNT_CENTS", 500_000),
    dailyMaxAmountCents: int("DAILY_MAX_AMOUNT_CENTS", 2_000_000),
    /** 转账单笔上限（分），默认 200 元；与商家订单限额分开 */
    transferMaxAmountCents: int("TRANSFER_MAX_AMOUNT_CENTS", 20_000),
    /** 转账当日累计上限（分），默认 1000 元；按本地自然日统计 */
    transferDailyMaxAmountCents: int("TRANSFER_DAILY_MAX_AMOUNT_CENTS", 100_000),
    emailCodeTtlMinutes: int("EMAIL_CODE_TTL_MINUTES", 10),
    emailCodeResendSeconds: int("EMAIL_CODE_RESEND_SECONDS", 60),
    emailCodeMaxAttempts: int("EMAIL_CODE_MAX_ATTEMPTS", 5),
    passwordResetTokenTtlMinutes: 10,
    dynamicCodeTtlSeconds: 60,
    dynamicCodeRefreshSeconds: 30,
    paymentRequestTtlSeconds: 180,
    /** 商家自建收款单（固定金额二维码）有效期（秒），默认 30 分钟 */
    collectionTtlSeconds: int("COLLECTION_TTL_SECONDS", 1_800),
    /** 限流阈值（每分钟），设为 0 表示关闭对应限流 */
    rateLimitLoginPerMinute: int("RATE_LIMIT_LOGIN_PER_MINUTE", 20),
    rateLimitCallbackPerMinute: int("RATE_LIMIT_CALLBACK_PER_MINUTE", 30),
    rateLimitOrderPerMinute: int("RATE_LIMIT_ORDER_PER_MINUTE", 30),
    rateLimitTransferPerMinute: int("RATE_LIMIT_TRANSFER_PER_MINUTE", 10),
    rateLimitScanPerMinute: int("RATE_LIMIT_SCAN_PER_MINUTE", 30),
    rateLimitEmailPerMinute: int("RATE_LIMIT_EMAIL_PER_MINUTE", 5),
    rateLimitDynamicPerMinute: int("RATE_LIMIT_DYNAMIC_PER_MINUTE", 20),
  },

  /** 测试环境可通过环境变量覆盖 */
  get testDatabasePath(): string {
    return process.env.TEST_DATABASE_PATH ?? ":memory:";
  },
} as const;

/** 校园墙 OAuth 是否已配置（未配置时登录会返回明确错误） */
export function isCampuxConfigured(): boolean {
  return Boolean(config.campux.baseUrl && config.campux.clientId && config.campux.clientSecret);
}

/** 邮箱发件是否可用；未配置时邮件落到 outbox 表 */
export function isSmtpConfigured(): boolean {
  return Boolean(config.smtp.host);
}

/** 自动化测试或显式开启 EMAIL_CODE_DEV_MODE 时，把邮箱验证码回显到响应里（仅限本地/冒烟） */
export function canExposeDevCode(): boolean {
  return config.isTest || config.exposeEmailCode;
}

export function resolvePathFromRepo(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(REPO_ROOT, p);
}

export function readPackageVersion(): string {
  return config.version;
}
