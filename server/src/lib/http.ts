import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { config } from "../config.js";
import { queryOne } from "../db/index.js";
import { writeSystemError } from "./audit.js";
import { AppError, errors } from "./errors.js";
import { readSession } from "./session.js";
import type { AdminRole, AdminRow, AuthContext, SessionRow } from "./types.js";

/** 包装异步路由，把异常交给错误中间件 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 安全响应头 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=()",
  );
  next();
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** CSRF 防护：SameSite Cookie + 自定义请求头 + Origin/Referer 白名单 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  const reject = (message: string): void => {
    res.status(403).json({ error: { code: "CSRF_REJECTED", message } });
  };
  // 1) 自定义请求头：跨站简单请求无法伪造，浏览器跨域预检也会被同源策略拦下
  if (req.headers["x-requested-with"] !== "gzspay") {
    reject("缺少 X-Requested-With 请求头");
    return;
  }
  // 2) 同源校验：浏览器发起的跨站写请求一定带 Origin/Referer
  const allowed = new Set(
    [originOf(config.appBaseUrl), originOf(config.publicBaseUrl), ...config.extraAllowedOrigins.map(originOf)].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const origin = originOf(req.headers.origin);
  const referer = originOf(req.headers.referer);
  const source = origin ?? referer;
  if (source && !allowed.has(source)) {
    reject("请求来源不被允许");
    return;
  }
  next();
}

/** 解析登录态（不强制登录） */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const auth = readSession(req, "user");
  if (auth) {
    req.auth = { ...auth, ip: req.ip ?? req.socket.remoteAddress ?? "unknown" } as AuthContext;
  }
  next();
}

export interface RequireUserOptions {
  /** 冻结账号也允许访问（如退出登录、读取自身资料） */
  allowFrozen?: boolean;
}

/** 强制登录 */
export function requireUser(options: RequireUserOptions = {}): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth ?? (() => {
      const resolved = readSession(req, "user");
      return resolved
        ? ({ ...resolved, ip: req.ip ?? req.socket.remoteAddress ?? "unknown" } as AuthContext)
        : undefined;
    })();
    if (!auth) {
      next(errors.unauthenticated());
      return;
    }
    if (auth.user.status === "frozen" && !options.allowFrozen) {
      next(errors.locked("账号已被冻结，无法进行交易，请联系管理员"));
      return;
    }
    req.auth = auth;
    next();
  };
}

/** 解析管理员会话（admin_pending 或 admin） */
export function attachAdmin(req: Request, _res: Response, next: NextFunction): void {
  const session = readSession(req, "admin") ?? readSession(req, "admin_pending");
  if (session) {
    const admin = queryOne<AdminRow>("SELECT * FROM admins WHERE user_id = ?", session.user.id);
    if (admin && admin.role) {
      req.admin = {
        user: session.user,
        admin,
        session: session.session,
      };
    }
  }
  next();
}

/** 要求已通过邮箱二次验证的正式管理员会话 */
export function requireAdmin(roles?: AdminRole[]): RequestHandler {
  return (req, _res, next) => {
    const context = req.admin;
    if (!context) {
      next(errors.unauthenticated("请先登录管理后台"));
      return;
    }
    if (context.session.kind !== "admin") {
      next(new AppError(401, "ADMIN_2FA_REQUIRED", "请先完成邮箱二次验证"));
      return;
    }
    if (context.user.status === "frozen") {
      next(errors.locked());
      return;
    }
    if (roles && !roles.includes(context.admin.role)) {
      next(errors.forbidden("当前管理员角色没有该操作权限"));
      return;
    }
    next();
  };
}

export function currentAdminSession(req: Request): { session: SessionRow } | null {
  return req.admin ? { session: req.admin.session } : null;
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "接口不存在" } });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    res.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        message: issues[0]?.message ?? "参数不合法",
        details: { issues },
      },
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  writeSystemError({
    scope: "http",
    message,
    stack: error instanceof Error ? (error.stack ?? null) : null,
    context: `${req.method} ${req.path}`,
  });
  if (config.isProduction) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "服务器开小差了" } });
    return;
  }
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: `服务器内部错误：${message}` },
  });
}
