import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { execute, nowIso } from "../db/index.js";
import { writeSystemError } from "./audit.js";
import { newId } from "./crypto.js";
import type { UserRow } from "./types.js";

/**
 * 按 QQ 号拉取头像并缓存到 gzspay 自己的地址。
 * QQ 号仅用于此步骤：不展示、不写日志。
 */
export async function syncQqAvatar(user: UserRow): Promise<string | null> {
  const qq = user.qq?.trim();
  if (!qq || !/^\d{5,12}$/.test(qq)) return null;
  const url = config.qqAvatarUrlTemplate.replace("{qq}", encodeURIComponent(qq));

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > 2 * 1024 * 1024) return null;

    mkdirSync(config.avatarDir, { recursive: true });
    const extension = contentType.includes("png") ? "png" : "jpg";
    const fileName = `${newId()}.${extension}`;
    writeFileSync(path.join(config.avatarDir, fileName), buffer);
    const publicUrl = `/media/avatars/${fileName}`;
    execute("UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?", publicUrl, nowIso(), user.id);
    return publicUrl;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeSystemError({ scope: "avatar", message: `头像拉取失败：${reason}` });
    return null;
  }
}

/** 头像接口不可达时，由前端显示姓名首字默认头像 */
export function avatarOrDefault(avatarUrl: string | null): string | null {
  return avatarUrl ?? null;
}
