/**
 * 登录设备：把会话（sessions）整理成「设备」视图，供「我的 → 设置 → 登录设备管理」使用。
 *
 * 会话表只存 User-Agent，这里就地解析出设备名称、类型与浏览器；
 * 「在线」与后台用户管理保持一致：会话未过期且最近 5 分钟内有请求。
 */
import { execute, nowIso, queryAll } from "../db/index.js";
import type { SessionRow } from "../lib/types.js";

/** 判定「在线」的活跃窗口（分钟）：会话未过期且最近这么多分钟内有请求。 */
export const ONLINE_WINDOW_MINUTES = 5;

/** 设备列出的最大条数（按最近活跃倒序）。 */
const DEVICE_LIMIT = 30;

export type DeviceType = "mobile" | "tablet" | "desktop" | "other";

export interface DeviceDescriptor {
  deviceName: string;
  deviceType: DeviceType;
  os: string;
  browser: string;
}

export interface DeviceView extends DeviceDescriptor {
  id: string;
  /** 是否就是当前发起请求的设备 */
  current: boolean;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  online: boolean;
}

function describeBrowser(userAgent: string): string {
  if (/MicroMessenger/i.test(userAgent)) return "微信";
  if (/MQQBrowser/i.test(userAgent)) return "QQ 浏览器";
  if (/Edg[A-Z]?\//i.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/i.test(userAgent)) return "Opera";
  if (/Firefox\/|FxiOS/i.test(userAgent)) return "Firefox";
  if (/CriOS\/|Chrome\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "未知客户端";
}

/** 把 User-Agent 归纳成设备名称、类型、系统与浏览器。 */
export function describeUserAgent(raw: string | null): DeviceDescriptor {
  const userAgent = raw ?? "";
  if (!userAgent.trim()) {
    return { deviceName: "未知设备", deviceType: "other", os: "未知系统", browser: "未知客户端" };
  }
  const browser = describeBrowser(userAgent);
  if (/iPhone/i.test(userAgent)) {
    return { deviceName: "iPhone", deviceType: "mobile", os: "iOS", browser };
  }
  if (/iPad/i.test(userAgent)) {
    return { deviceName: "iPad", deviceType: "tablet", os: "iPadOS", browser };
  }
  if (/iPod/i.test(userAgent)) {
    return { deviceName: "iPod touch", deviceType: "mobile", os: "iOS", browser };
  }
  if (/Android/i.test(userAgent)) {
    const tablet = !/Mobile/i.test(userAgent);
    return {
      deviceName: tablet ? "Android 平板" : "Android 手机",
      deviceType: tablet ? "tablet" : "mobile",
      os: "Android",
      browser,
    };
  }
  if (/Windows/i.test(userAgent)) {
    return { deviceName: "Windows 电脑", deviceType: "desktop", os: "Windows", browser };
  }
  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return { deviceName: "Mac", deviceType: "desktop", os: "macOS", browser };
  }
  if (/Linux/i.test(userAgent)) {
    return { deviceName: "Linux 电脑", deviceType: "desktop", os: "Linux", browser };
  }
  return { deviceName: "未知设备", deviceType: "other", os: "未知系统", browser };
}

function isOnline(session: SessionRow, now: string, since: string): boolean {
  return session.expires_at > now && session.last_seen_at >= since;
}

/** 列出该用户最近的登录设备（含已过期但尚未清理的会话）。 */
export function listUserDevices(userId: string, currentSessionId: string | null): DeviceView[] {
  const rows = queryAll<SessionRow>(
    `SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT ${DEVICE_LIMIT}`,
    userId,
  );
  const now = nowIso();
  const since = new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60_000).toISOString();
  return rows.map((row) => ({
    id: row.id,
    current: currentSessionId !== null && row.id === currentSessionId,
    ...describeUserAgent(row.user_agent),
    ip: row.ip,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    online: isOnline(row, now, since),
  }));
}

/** 强制退出指定设备（只能操作自己的会话）。返回是否找到并删除。 */
export function revokeUserDevice(userId: string, sessionId: string): boolean {
  const row = queryAll<{ id: string }>(
    "SELECT id FROM sessions WHERE id = ? AND user_id = ?",
    sessionId,
    userId,
  )[0];
  if (!row) return false;
  execute("DELETE FROM sessions WHERE id = ?", sessionId);
  return true;
}

/** 退出除当前设备外的其它设备，返回退出数量。 */
export function revokeOtherUserDevices(userId: string, currentSessionId: string | null): number {
  if (currentSessionId) {
    return execute("DELETE FROM sessions WHERE user_id = ? AND id != ?", userId, currentSessionId)
      .changes;
  }
  return execute("DELETE FROM sessions WHERE user_id = ?", userId).changes;
}
