import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { execute, nowIso, queryAll, queryOne } from "../db/index.js";
import { randomToken, sha256 } from "./crypto.js";
import { rateLimit } from "./rate-limit.js";
import { readAdminEntryConfig } from "./runtime-config.js";

/**
 * 管理后台安全入口：
 * - 未配置时行为不变，直接访问 /admin 即可；
 * - 配置后管理入口为 `/{入口}/admin`，访问后写入短期 Cookie 并跳转到 /admin；
 * - 不经过安全入口直接访问 /admin（或 /admin/xxx）的请求会被记录（IP、UA、路径、来源等），
 *   并返回普通 404，隐藏后台存在。
 */

export const ADMIN_ENTRY_COOKIE = "gzs_admin_entry";
/** 入口 Cookie 有效期：8 小时，过期后需要重新从安全入口进入 */
export const ADMIN_ENTRY_TTL_SECONDS = 8 * 60 * 60;

/** 入口名不能与站点已有路径冲突 */
const RESERVED_ENTRIES = new Set([
  "api",
  "admin",
  "assets",
  "media",
  "login",
  "logout",
  "auth",
  "me",
  "guide",
  "setup",
  "health",
  "docs",
  "static",
  "favicon.ico",
  "theme-boot.js",
  "sw.js",
  "manifest.webmanifest",
]);

const ENTRY_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

/** 校验并规范化安全入口名；返回 null 表示不合法（空字符串视为「关闭」，由调用方处理） */
export function normalizeEntryPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!ENTRY_PATTERN.test(trimmed)) return null;
  if (RESERVED_ENTRIES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/** 入口 Cookie 值：用会话密钥签名，避免被随意伪造 */
export function entryCookieValue(entryPath: string): string {
  return createHmac("sha256", config.sessionSecret)
    .update(`admin-entry:${entryPath}`)
    .digest("base64url");
}

function cookieMatches(value: string | undefined, entryPath: string): boolean {
  if (!value) return false;
  const expected = Buffer.from(entryCookieValue(entryPath));
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface AdminEntryVisit {
  id: string;
  ip: string | null;
  method: string;
  path: string;
  query: string | null;
  userAgent: string | null;
  referer: string | null;
  createdAt: string;
}

const MAX_VISITS = 3000;
let insertSincePrune = 0;

/** 记录一次「未通过安全入口」的访问，失败不影响响应 */
export function recordAdminEntryVisit(req: Request): void {
  try {
    const ip = req.ip ?? req.socket.remoteAddress ?? null;
    // 只留探索路径本身：不落 query（可能带 token）、UA、Referer 与明文 IP，
    // IP 做哈希后仍可用于「同一扫描源来了几次」的聚合判断。
    const ipHash = ip ? sha256(`admin-entry:${ip}`).slice(0, 16) : null;
    execute(
      `INSERT INTO admin_entry_visits (id, ip, method, path, query, user_agent, referer, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      randomToken(16),
      ipHash,
      req.method,
      req.path.slice(0, 300),
      null,
      null,
      null,
      nowIso(),
    );
    insertSincePrune += 1;
    if (insertSincePrune >= 50) {
      insertSincePrune = 0;
      execute(
        `DELETE FROM admin_entry_visits
         WHERE rowid <= (SELECT MAX(rowid) - ? FROM admin_entry_visits)`,
        MAX_VISITS,
      );
    }
  } catch (error) {
    console.warn("[gzspay] 记录后台入口访问失败", error);
  }
}

/** 后台查看访问记录（按时间倒序） */
export function listAdminEntryVisits(limit = 20): { total: number; items: AdminEntryVisit[] } {
  const size = Math.min(Math.max(limit, 1), 100);
  const rows = queryAll<{
    id: string;
    ip: string | null;
    method: string;
    path: string;
    query: string | null;
    user_agent: string | null;
    referer: string | null;
    created_at: string;
  }>(
    `SELECT id, ip, method, path, query, user_agent, referer, created_at
     FROM admin_entry_visits ORDER BY created_at DESC LIMIT ?`,
    size,
  );
  const totalRow = queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM admin_entry_visits");
  return {
    total: totalRow ? Number(totalRow.count) : 0,
    items: rows.map((row) => ({
      id: row.id,
      ip: row.ip,
      method: row.method,
      path: row.path,
      query: row.query,
      userAgent: row.user_agent,
      referer: row.referer,
      createdAt: row.created_at,
    })),
  };
}

const NOT_FOUND_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>页面不存在</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f5f5f2;color:#1c1c1a;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.card{max-width:340px;padding:30px 24px;border-radius:18px;background:#fff;
box-shadow:0 18px 48px -28px rgba(0,0,0,.3);text-align:center}
h1{margin:0 0 8px;font-size:16px}
p{margin:0;font-size:13px;line-height:1.7;color:#6b6b66}
</style></head>
<body><div class="card"><h1>页面不存在</h1>
<p>你访问的页面不存在或已被移除。</p>
</div></body></html>`;

function setEntryCookie(res: Response, entryPath: string): void {
  res.cookie(ADMIN_ENTRY_COOKIE, entryCookieValue(entryPath), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: ADMIN_ENTRY_TTL_SECONDS * 1000,
  });
}

/**
 * 安全入口中间件：必须在 cookie-parser 之后、静态资源与页面路由之前挂载。
 * 只处理页面导航（GET/HEAD），接口请求不受影响。
 */
/**
 * 管理入口探测防护：同一 IP 每分钟最多 10 次后台入口相关请求。
 * 没有入口名时也能挡住「字典猜入口」这类扫描。
 */
const entryProbeLimit = rateLimit({
  scope: "admin.entry",
  limit: 10,
  windowSeconds: 60,
  message: "请求太频繁了，请稍后再试",
  keyBy: (req) => req.ip ?? req.socket.remoteAddress ?? "unknown",
});

/**
 * 入口名猜测防护：`/<猜错的名字>/admin` 不经过上面的真实入口分支，
 * 会变成「302 = 猜中、404 = 猜错」的无成本 oracle，可被全速跑字典。
 * 用独立计数桶，避免与真实入口/后台页面的探测额度互相挤占。
 */
const entryGuessLimit = rateLimit({
  scope: "admin.entry.guess",
  limit: 10,
  windowSeconds: 60,
  message: "请求太频繁了，请稍后再试",
  keyBy: (req) => req.ip ?? req.socket.remoteAddress ?? "unknown",
});

export function createAdminEntryGuard(): (req: Request, res: Response, next: NextFunction) => void {
  return function adminEntryGuard(req: Request, res: Response, next: NextFunction): void {
    const { entryPath } = readAdminEntryConfig();
    if (!entryPath) {
      next();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const pathname = req.path;
    const prefix = `/${entryPath}`;
    const adminPath = pathname === "/admin" || pathname.startsWith("/admin/");

    if (pathname === prefix || pathname === `${prefix}/` || pathname.startsWith(`${prefix}/`)) {
      const isEntryAdmin =
        pathname === `${prefix}/admin` || pathname.startsWith(`${prefix}/admin/`);
      if (isEntryAdmin) {
        setEntryCookie(res, entryPath);
        const rest = pathname.slice(prefix.length) || "/admin";
        const searchIndex = req.originalUrl.indexOf("?");
        const search = searchIndex >= 0 ? req.originalUrl.slice(searchIndex) : "";
        res.redirect(302, `${rest}${search}`);
        return;
      }
      // 安全入口下的其它路径当作普通页面处理，交给后面的路由 / 404
      next();
      return;
    }

    // 猜错的入口名也要限流，否则可以全速枚举哪个 /<名字>/admin 会返回 302
    if (/^\/[^/]+\/admin(?:\/|$)/.test(pathname)) {
      entryGuessLimit(req, res, () => next());
      return;
    }

    if (!adminPath) {
      next();
      return;
    }

    // 只有 /admin* 才计入探测限流，避免正常浏览页面被限
    entryProbeLimit(req, res, () => {
      if (cookieMatches(req.cookies?.[ADMIN_ENTRY_COOKIE], entryPath)) {
        next();
        return;
      }

      recordAdminEntryVisit(req);
      // 打标记：访问统计里记为「后台入口探测」
      res.locals.adminEntryProbe = true;
      res.status(404).type("html").send(NOT_FOUND_HTML);
    });
  };
}
