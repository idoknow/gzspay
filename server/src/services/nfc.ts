/**
 * NFC 卡片：把「我的卡片」变成一张别人贴一贴就能读取的公开链接。
 *
 * 令牌存在 `users.nfc_token`，由用户自己开启、更换或关闭；公开接口只返回
 * 姓名、头像与打码后的学号 / 校园卡号，不含 QQ、邮箱、完整学号等敏感字段。
 */
import { randomBytes } from "node:crypto";
import { execute, nowIso, queryOne } from "../db/index.js";
import { errors } from "../lib/errors.js";
import { readSystemConfig } from "../lib/runtime-config.js";
import type { UserRow } from "../lib/types.js";

/** 公开卡片信息：别人用 NFC 读到的就是这些。 */
export interface NfcCardDto {
  displayName: string;
  avatarUrl: string | null;
  studentNoMasked: string;
  cardNoMasked: string;
  merchant: boolean;
}

export interface NfcCardStateDto {
  /** 是否已经开启（有令牌） */
  enabled: boolean;
  /** 公开链接，未开启时为 null */
  url: string | null;
  /** 令牌本身，客户端写进 NFC 的 NDEF 记录 */
  token: string | null;
}

function displayNameOf(user: UserRow): string {
  const name = [user.surname, user.given_name].filter(Boolean).join("");
  return name || user.campux_username || "校园用户";
}

function maskMiddle(value: string | null, keepStart: number, keepEnd: number): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (text.length <= keepStart + keepEnd) return `${text.slice(0, 1)}${"*".repeat(Math.max(1, text.length - 1))}`;
  return `${text.slice(0, keepStart)}${"*".repeat(text.length - keepStart - keepEnd)}${text.slice(-keepEnd)}`;
}

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

function toState(token: string | null): NfcCardStateDto {
  if (!token) return { enabled: false, url: null, token: null };
  const base = readSystemConfig().publicBaseUrl.replace(/\/+$/, "");
  return { enabled: true, url: `${base}/nfc/${token}`, token };
}

/** 读取当前用户的 NFC 卡片状态（不会自动创建令牌）。 */
export function nfcCardState(user: UserRow): NfcCardStateDto {
  return toState(user.nfc_token);
}

/** 开启或更换令牌：已开启时调用等于「换一张新卡」，旧链接立即失效。 */
export function rotateNfcToken(user: UserRow): NfcCardStateDto {
  const token = newToken();
  const at = nowIso();
  execute("UPDATE users SET nfc_token = ?, updated_at = ? WHERE id = ?", [token, at, user.id]);
  return toState(token);
}

/** 关闭 NFC 卡片：清空令牌，旧链接立即失效。 */
export function disableNfcCard(user: UserRow): NfcCardStateDto {
  execute("UPDATE users SET nfc_token = NULL, updated_at = ? WHERE id = ?", [nowIso(), user.id]);
  return toState(null);
}

/** 按令牌读取公开卡片信息；令牌不存在或账号被冻结时一律 404。 */
export function publicCardByToken(token: string): NfcCardDto {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 64) throw errors.notFound("卡片不存在或已失效");
  const user = queryOne<UserRow>(
    "SELECT * FROM users WHERE nfc_token = ? AND status = 'active' LIMIT 1",
    [trimmed],
  );
  if (!user) throw errors.notFound("卡片不存在或已失效");
  const merchant = Boolean(
    queryOne<{ id: string }>("SELECT id FROM merchants WHERE user_id = ? LIMIT 1", [user.id]),
  );
  return {
    displayName: displayNameOf(user),
    avatarUrl: user.avatar_url ? `/api/avatar/${user.id}` : null,
    studentNoMasked: maskMiddle(user.student_no, 4, 2),
    cardNoMasked: maskMiddle(user.card_no, 4, 2),
    merchant,
  };
}
