import { config } from "../config.js";
import { execute, nowIso, queryAll } from "../db/index.js";
import { sniffImageKind } from "./image.js";
import type { UserRow } from "./types.js";

const QQ_PATTERN = /^\d{5,12}$/;

/** 允许代理的头像域名（QQ 头像 CDN） */
const ALLOWED_AVATAR_HOSTS = ["qlogo.cn"];
/** 单个头像最大 2MB，防止被当成流量通道 */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const AVATAR_CACHE_LIMIT = 500;

export interface AvatarPayload {
  data: Buffer;
  contentType: string;
}

const avatarCache = new Map<string, { payload: AvatarPayload; at: number }>();

/**
 * 对外展示的头像地址：统一走本站 `/api/avatar/<用户 id>` 代理。
 * 数据库里仍存 QQ 头像地址（含 QQ 号），但不会下发给前端，
 * 避免页面源码、网络请求、截图里暴露用户的 QQ 号。
 */
export function avatarPathOf(user: { id: string; avatar_url: string | null }): string | null {
  return user.avatar_url ? `/api/avatar/${user.id}` : null;
}

/** 只允许 https 且域名属于 QQ 头像 CDN，避免被写入任意地址后当成 SSRF 跳板 */
export function isProxyableAvatarUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_AVATAR_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/**
 * 服务端拉取并缓存头像（6 小时），拉取失败时回退到旧缓存。
 * 注意：本地历史头像（`/media/...`）不走这里，直接重定向到自己的静态路径。
 */
export async function loadProxyAvatar(user: { id: string; avatar_url: string | null }): Promise<AvatarPayload | null> {
  const raw = user.avatar_url;
  if (!raw || !isProxyableAvatarUrl(raw)) return null;

  const cached = avatarCache.get(raw);
  if (cached && Date.now() - cached.at < AVATAR_CACHE_TTL_MS) return cached.payload;

  try {
    const response = await fetch(raw, {
      redirect: "error",
      signal: AbortSignal.timeout(6_000),
      headers: { accept: "image/*", "user-agent": "gzspay-avatar-proxy" },
    });
    if (!response.ok) return cached?.payload ?? null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) return cached?.payload ?? null;
    const kind = sniffImageKind(buffer);
    if (!kind) return cached?.payload ?? null;

    const payload: AvatarPayload = { data: buffer, contentType: `image/${kind}` };
    if (avatarCache.size >= AVATAR_CACHE_LIMIT) avatarCache.clear();
    avatarCache.set(raw, { payload, at: Date.now() });
    return payload;
  } catch {
    return cached?.payload ?? null;
  }
}

/**
 * 按 QQ 号拼出 QQ 官方头像地址（默认 `https://q1.qlogo.cn/g?b=qq&nk={qq}&s=100`）。
 * 直接使用 QQ 头像而不是下载缓存：用户换 QQ 头像后页面自动跟着变。
 * QQ 号不合法或未填写时返回 null（前端用姓名首字兜底）。
 */
export function qqAvatarUrl(qq: string | null | undefined): string | null {
  const value = qq?.trim();
  if (!value || !QQ_PATTERN.test(value)) return null;
  return config.qqAvatarUrlTemplate.replace("{qq}", encodeURIComponent(value));
}

/**
 * 把历史缓存在本地的头像（`/media/avatars/...`）换回 QQ 头像地址。
 * 启动时执行一次即可：只处理有合法 QQ 号的账号，自定义头像与没有 QQ 号的账号保持原样，幂等。
 */
export function backfillQqAvatars(): number {
  const rows = queryAll<Pick<UserRow, "id" | "qq" | "avatar_url">>(
    "SELECT id, qq, avatar_url FROM users WHERE qq IS NOT NULL",
  );
  const now = nowIso();
  let updated = 0;
  for (const row of rows) {
    const url = qqAvatarUrl(row.qq);
    if (!url || url === row.avatar_url) continue;
    // 只覆盖本地缓存头像（或空头像）；其它自定义地址不动
    if (row.avatar_url && !row.avatar_url.startsWith("/media/avatars/")) continue;
    execute("UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?", url, now, row.id);
    updated += 1;
  }
  return updated;
}
