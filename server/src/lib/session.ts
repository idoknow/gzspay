import type { Request, Response } from "express";
import { config } from "../config.js";
import { execute, isoAfter, nowIso, queryOne } from "../db/index.js";
import { hashToken, randomToken } from "./crypto.js";
import type { SessionRow, UserRow } from "./types.js";

/**
 * 会话只有一种：主站登录会话（Cookie 7 天）。
 * 管理后台直接复用这个会话，只额外校验当前用户是否在 admins 表里。
 */
export type SessionKind = "user";

export interface AuthSession {
  session: SessionRow;
  user: UserRow;
}

function sessionTtlSeconds(): number {
  return config.sessionTtlDays * 86400;
}

/** 创建会话并返回明文令牌（数据库只存哈希） */
export function issueSession(userId: string, req: Request): { token: string; session: SessionRow } {
  const token = randomToken(32);
  const id = hashToken(token);
  const createdAt = nowIso();
  const session: SessionRow = {
    id,
    user_id: userId,
    kind: "user",
    ip: req.ip ?? req.socket.remoteAddress ?? null,
    user_agent: (req.headers["user-agent"] ?? "").slice(0, 300) || null,
    created_at: createdAt,
    expires_at: isoAfter(sessionTtlSeconds()),
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

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: sessionTtlSeconds() * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
  });
}

/** 从请求 Cookie 中读取令牌（不校验有效性） */
export function sessionTokenFromRequest(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const token = cookies?.[config.sessionCookieName];
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** 根据令牌解析会话；过期或不存在返回 null */
export function resolveSession(token: string): AuthSession | null {
  const session = queryOne<SessionRow>("SELECT * FROM sessions WHERE id = ?", hashToken(token));
  if (!session) return null;
  if (session.kind !== "user") return null;
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

export function readSession(req: Request): AuthSession | null {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  return resolveSession(token);
}

export function revokeSessionById(sessionId: string): void {
  execute("DELETE FROM sessions WHERE id = ?", sessionId);
}

export function revokeSessionByToken(token: string): void {
  execute("DELETE FROM sessions WHERE id = ?", hashToken(token));
}

/** 强制某用户下线（管理后台「强制下线」用） */
export function revokeUserSessions(userId: string): void {
  execute("DELETE FROM sessions WHERE user_id = ?", userId);
}
