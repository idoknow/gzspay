import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * 进程内滑动窗口限流。
 *
 * 适用场景：单实例部署（本项目就是单进程 + SQLite），因此用内存计数即可，
 * 不引入 Redis 等外部依赖。多实例部署时应换成共享存储。
 *
 * 注意：命中限流时直接返回 429，响应体结构与项目其它错误一致
 * （`{ error: { code: "RATE_LIMITED", message } }`），并带上 Retry-After 秒数。
 */

/** 清理周期：定期扫掉过期桶，避免内存无限增长 */
const CLEANUP_INTERVAL_MS = 60_000;
/** 桶数量上限，超过时先清理；仍然超限则拒绝新 key，避免被伪造 IP 撑爆内存 */
const MAX_BUCKETS = 50_000;
/** 桶内最久保留的命中时间（窗口最长按 1 小时算） */
const MAX_WINDOW_MS = 60 * 60 * 1000;

interface Bucket {
  hits: number[];
  /** 最后一次命中时间，用于按空闲时长清理 */
  last: number;
}

const buckets = new Map<string, Bucket>();
let cleanupTimer: NodeJS.Timeout | null = null;

/** 客户端 IP：优先用 express 的 req.ip（已按 trust proxy 解析），退回复用 socket 地址 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.last >= MAX_WINDOW_MS) {
      buckets.delete(key);
      continue;
    }
    const alive = bucket.hits.filter((at) => now - at < MAX_WINDOW_MS);
    if (alive.length === 0) buckets.delete(key);
    else if (alive.length !== bucket.hits.length) bucket.hits = alive;
  }
}

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    try {
      sweep(Date.now());
    } catch {
      // 清理失败不影响请求处理
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

/** 测试用：清空所有计数与定时器 */
export function resetRateLimits(): void {
  buckets.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export interface RateLimitOptions {
  /** 计数作用域，例如 "auth.login"；不同作用域互不影响 */
  scope: string;
  /** 窗口内允许的最大请求数；<= 0 表示关闭该限流 */
  limit: number;
  /** 窗口长度（秒） */
  windowSeconds: number;
  /** 计数键，默认按客户端 IP；登录用户可传 user id 以免共用出口 IP 互相影响 */
  keyBy?: (req: Request) => string;
  /** 超限时的提示文案 */
  message?: string;
}

/**
 * 生成限流中间件。
 *
 * 顺序很重要：需要按用户计数的接口，应放在 `requireUser()` 之后，
 * 这样 `req.auth` 已经解析出来。
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { scope, limit, windowSeconds } = options;
  const windowMs = Math.max(1, Math.floor(windowSeconds)) * 1000;
  const keyOf = options.keyBy ?? clientIp;
  const message = options.message ?? "请求过于频繁，请稍后再试";
  const enabled = limit > 0;
  if (enabled) ensureCleanupTimer();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled) {
      next();
      return;
    }
    const key = `${scope}:${keyOf(req)}`;
    const now = Date.now();
    const existing = buckets.get(key);
    const hits = (existing?.hits ?? []).filter((at) => now - at < windowMs);
    if (hits.length >= limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowMs - (now - hits[0]!)) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: { code: "RATE_LIMITED", message } });
      return;
    }
    if (!existing) {
      // 桶数量超上限时先清理一遍；仍然超限就拒绝新 key（宁可误伤也不让内存被撑爆）
      if (buckets.size >= MAX_BUCKETS) {
        sweep(now);
        if (buckets.size >= MAX_BUCKETS) {
          res.setHeader("Retry-After", "60");
          res
            .status(429)
            .json({ error: { code: "RATE_LIMITED", message: "服务器繁忙，请稍后再试" } });
          return;
        }
      }
    }
    hits.push(now);
    buckets.set(key, { hits, last: now });
    next();
  };
}

/** 按登录用户计数的键（`requireUser()` 之后可用） */
export function userKey(req: Request): string {
  return req.auth?.user.id ?? clientIp(req);
}
