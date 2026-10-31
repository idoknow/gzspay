import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { config } from "../config.js";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

/** 生成 UUID 主键 */
export function newId(): string {
  return randomUUID();
}

/** 生成不可预测的随机令牌（base64url） */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** 会话令牌等只存哈希，避免数据库泄露导致会话被直接复用 */
export function hashToken(token: string): string {
  return sha256(`${token}.${config.sessionSecret}`);
}

function hmac(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("hex");
}

/** 低熵验证码（6 位）用带密钥的 HMAC 存储，避免被离线穷举 */
export function hashEmailCode(code: string): string {
  return hmac(`email-code:${code}`, config.sessionSecret);
}

export function verifyEmailCodeHash(code: string, storedHash: string): boolean {
  return timingSafeEqualStr(hashEmailCode(code), storedHash);
}

/** 支付密码慢哈希：scrypt$N$r$p$salt$hash */
export function hashPaymentPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export function verifyPaymentPasswordHash(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number.parseInt(parts[1] ?? "", 10);
  const r = Number.parseInt(parts[2] ?? "", 10);
  const p = Number.parseInt(parts[3] ?? "", 10);
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const derived = scryptSync(password.normalize("NFKC"), salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 6 位数字验证码 */
export function generateNumericCode(length = 6): string {
  let code = "";
  while (code.length < length) {
    const byte = randomBytes(1)[0] ?? 0;
    if (byte < 250) {
      code += String(byte % 10);
    }
  }
  return code;
}

// ---------------- 脱敏与展示 ----------------

/** 学号脱敏：保留前 4 位与后 2 位 */
export function maskStudentNo(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 6) return `${value.slice(0, 1)}****`;
  return `${value.slice(0, 4)}${"*".repeat(Math.max(2, value.length - 6))}${value.slice(-2)}`;
}

/** 邮箱脱敏：只保留首字符与域名 */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return "";
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  const name = value.slice(0, at);
  const domain = value.slice(at + 1);
  const head = name.slice(0, 1);
  return `${head}${"*".repeat(Math.max(3, name.length - 1))}@${domain}`;
}

/** 卡号脱敏：只显示后四位 */
export function maskCardNo(value: string | null | undefined): string {
  if (!value) return "";
  const tail = value.slice(-4);
  return `****${tail}`;
}

/** 姓名展示：姓 + 名 */
export function displayFullName(
  surname: string | null | undefined,
  givenName: string | null | undefined,
): string | null {
  const full = `${surname ?? ""}${givenName ?? ""}`.trim();
  return full.length > 0 ? full : null;
}

/** 默认头像使用的首字 */
export function nameInitial(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1) : "友";
}

// ---------------- 校园卡二维码 ----------------

export const CARD_QR_PREFIX = "gzspay:card:";

/** 生成校园卡静态二维码内容（仅用于识别身份，不能单独授权支付） */
export function buildCardQrContent(cardNo: string): string {
  return `${CARD_QR_PREFIX}${cardNo}`;
}

/** 解析扫描到的校园卡内容，兼容纯卡号 */
export function parseCardQrContent(raw: string): string | null {
  const content = raw.trim();
  if (!content) return null;
  const value = content.startsWith(CARD_QR_PREFIX)
    ? content.slice(CARD_QR_PREFIX.length)
    : content;
  // 卡号：字母数字，4~32 位
  if (!/^[A-Za-z0-9-]{4,32}$/.test(value)) return null;
  return value;
}

/** 学号格式：6~20 位数字（桂中校学号为纯数字） */
export function isValidStudentNo(value: string): boolean {
  return /^\d{6,20}$/.test(value);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function isValidPaymentPassword(value: string): boolean {
  return /^\d{6}$/.test(value);
}
