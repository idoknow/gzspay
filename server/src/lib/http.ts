import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { config } from "../config.js";
import { queryOne } from "../db/index.js";
import { reportSystemError } from "./alerts.js";
import { AppError, errors } from "./errors.js";
import { readSession } from "./session.js";
import { isCampuxReady, isSystemReady } from "./runtime-config.js";
import { validationError } from "./validate.js";
import type { AdminRole, AdminRow, AuthContext, SessionRow } from "./types.js";

/** 包装异步路由，把异常交给错误中间件 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 生产环境 CSP：脚本只允许同源（前端构建产物都是同源文件），
 * 样式允许内联（React 的 style 属性与开屏样式需要），图片允许 data:/blob:（二维码与头像预览）。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** 安全响应头 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  // 接口响应可能包含个人信息、卡号脱敏值、管理员数据，禁止中间缓存
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  // HSTS 与 CSP 只在上线环境下发：开发环境 Vite 的 HMR 需要内联脚本与 ws 连接
  if (config.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  }
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

/** 初始化之前也允许访问的接口前缀（登录、初始化、健康检查、管理后台鉴权） */
const OPEN_PREFIXES = ["/health", "/setup", "/auth", "/admin/auth"];

/**
 * 系统初始化闸门：没配好校园墙登录 / 没完成初始化时，除白名单外的接口一律 503。
 * 这样「没配置主站不让用」，同时在初始化向导里仍然可以保存配置并完成登录。
 */
export function systemGate(req: Request, res: Response, next: NextFunction): void {
  const current = req.path;
  const open = OPEN_PREFIXES.some(
    (prefix) => current === prefix || current.startsWith(`${prefix}/`),
  );
  if (open) {
    next();
    return;
  }
  if (!isCampuxReady()) {
    res.status(503).json({
      error: {
        code: "CAMPUX_NOT_CONFIGURED",
        message: "系统尚未配置校园墙登录，请管理员先在管理后台完成初始化",
      },
    });
    return;
  }
  if (!isSystemReady()) {
    res.status(503).json({
      error: {
        code: "SYSTEM_NOT_INITIALIZED",
        message: "系统尚未初始化，请管理员先在管理后台完成初始化",
      },
    });
    return;
  }
  next();
}

/** 解析登录态（不强制登录） */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const auth = readSession(req);
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
      const resolved = readSession(req);
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

/** 解析管理员身份：直接复用主站登录会话，再校验 admins 表 */
export function attachAdmin(req: Request, _res: Response, next: NextFunction): void {
  const auth = readSession(req);
  if (auth) {
    const admin = queryOne<AdminRow>("SELECT * FROM admins WHERE user_id = ?", auth.user.id);
    if (admin && admin.role) {
      req.admin = { user: auth.user, admin, session: auth.session };
    }
  }
  next();
}

/** 要求当前登录账号是管理员（roles 为空表示任意角色） */
export function requireAdmin(roles?: AdminRole[]): RequestHandler {
  return (req, _res, next) => {
    const context = req.admin;
    if (!context) {
      if (!req.auth) {
        next(errors.unauthenticated("请先登录"));
        return;
      }
      next(new AppError(401, "NOT_ADMIN", "你的账号不在管理员名单内"));
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

/** 读取中间件抛出的 HTTP 状态码（如 express.json 的 JSON 解析错误、请求体过大） */
function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { status?: unknown; statusCode?: unknown };
  const value = record.status ?? record.statusCode;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    // 统一转成中文提示；生产环境不返回字段路径等内部细节
    const validation = validationError(error.issues);
    res.status(validation.status).json({
      error: {
        code: validation.code,
        message: validation.message,
        ...(validation.details !== undefined ? { details: validation.details } : {}),
      },
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        // 细节（剩余次数、字段路径等）只在非生产环境返回
        ...(!config.isProduction && error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }
  const status = errorStatus(error);
  if (status !== null && status >= 400 && status < 500) {
    // express.json 等中间件抛出的 4xx（JSON 格式错误、请求体过大等）
    res.status(status).json({
      error: {
        code: "BAD_REQUEST",
        message: status === 413 ? "上传的内容过大" : "请求内容格式不正确，请刷新后重试",
      },
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  // 5xx 属于严重错误：入库 + 主动告警（邮件 / Webhook，带节流）
  reportSystemError({
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
