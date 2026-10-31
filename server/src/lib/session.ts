import type { Request, Response } from "express";
import { config } from "../config.js";
import { execute, isoAfter, nowIso, queryOne } from "../db/index.js";
import { hashToken, randomToken } from "./crypto.js";
import type { SessionRow, UserRow } from "./types.js";

export type SessionKind = "user" | "admin_pending" | "admin";

export interface AuthSession {
  session: SessionRow;
  user: UserRow;
}

function cookieName(kind: SessionKind): string {
  return kind === "user" ? config.sessionCookieName : config.adminCookieName;
}

function sessionTtlSeconds(kind: SessionKind): number {
  if (kind === "user") return config.sessionTtlDays * 86400;
  if (kind === "admin_pending") return 10 * 60;
  return config.adminSessionTtlMinutes * 60;
}

/** 创建会话并返回明文令牌（数据库只存哈希） */
export function issueSession(
  userId: string,
  kind: SessionKind,
  req: Request,
): { token: string; session: SessionRow } {
  const token = randomToken(32);
  const id = hashToken(token);
  const createdAt = nowIso();
  const session: SessionRow = {
    id,
    user_id: userId,
    kind,
    ip: req.ip ?? req.socket.remoteAddress ?? null,
    user_agent: (req.headers["user-agent"] ?? "").slice(0, 300) || null,
    created_at: createdAt,
    expires_at: isoAfter(sessionTtlSeconds(kind)),
    last_seen_at: createdAt,
  };
  execute(
    `INSERT INTO sessions (id, user_id, kind, ip, user_agent, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    session.id,
    session.user_id,
    session.kind,
    session.ip,
    session.user_agent,
    session.created_at,
    session.expires_at,
    session.last_seen_at,
  );
  return { token, session };
}

export function setSessionCookie(res: Response, token: string, kind: SessionKind): void {
  res.cookie(cookieName(kind), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: sessionTtlSeconds(kind) * 1000,
  });
}

export function clearSessionCookie(res: Response, kind: SessionKind): void {
  res.clearCookie(cookieName(kind), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
  });
}

export function redirectUri(kind: SessionKind): string {
  return kind === "user" ? config.campux.redirectUri : config.campux.adminRedirectUri;
}

/** 从请求 Cookie 中读取令牌（不校验有效性） */
export function sessionTokenFromRequest(req: Request, kind: SessionKind): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const token = cookies?.[cookieName(kind)];
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** 根据令牌解析会话；过期或不存在返回 null */
export function resolveSession(token: string, kind: SessionKind): AuthSession | null {
  const session = queryOne<SessionRow>("SELECT * FROM sessions WHERE id = ?", hashToken(token));
  if (!session) return null;
  if (session.kind !== kind) return null;
  if (session.expires_at <= nowIso()) {
    execute("DELETE FROM sessions WHERE id = ?", session.id);
    return null;
  }
  const user = queryOne<UserRow>("SELECT * FROM users WHERE id = ?", session.user_id);
  if (!user) {
    execute("DELETE FROM sessions WHERE id = ?", session.id);
    return null;
  }
  // 节流更新 last_seen_at
  if (Date.now() - Date.parse(session.last_seen_at) > 60_000) {
    execute("UPDATE sessions SET last_seen_at = ? WHERE id = ?", nowIso(), session.id);
  }
  return { session, user };
}

export function readSession(req: Request, kind: SessionKind): AuthSession | null {
  const token = sessionTokenFromRequest(req, kind);
  if (!token) return null;
  return resolveSession(token, kind);
}

export function revokeSessionById(sessionId: string): void {
  execute("DELETE FROM sessions WHERE id = ?", sessionId);
}

export function revokeSessionByToken(token: string): void {
  execute("DELETE FROM sessions WHERE id = ?", hashToken(token));
}

/** 强制某用户下线 */
export function revokeUserSessions(userId: string, kind?: SessionKind): void {
  if (kind) {
    execute("DELETE FROM sessions WHERE user_id = ? AND kind = ?", userId, kind);
  } else {
    execute("DELETE FROM sessions WHERE user_id = ?", userId);
  }
}

/** 升级管理员待验证会话为正式会话：销毁旧的，签发新令牌 */
export function upgradeToAdminSession(
  req: Request,
  res: Response,
  userId: string,
): { token: string; session: SessionRow } {
  const pending = sessionTokenFromRequest(req, "admin_pending");
  if (pending) {
    revokeSessionByToken(pending);
  }
  const issued = issueSession(userId, "admin", req);
  setSessionCookie(res, issued.token, "admin");
  return issued;
}
