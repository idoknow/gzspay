import { config } from "../config.js";
import { execute, nowIso, queryAll } from "../db/index.js";
import type { UserRow } from "./types.js";

const QQ_PATTERN = /^\d{5,12}$/;

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
