import cookieParser from "cookie-parser";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { gzip, gzipSync } from "node:zlib";
import { config } from "./config.js";
import {
  attachUser,
  csrfGuard,
  errorHandler,
  notFoundHandler,
  scannerGuard,
  securityHeaders,
  systemGate,
} from "./lib/http.js";
import { createAdminEntryGuard } from "./lib/admin-entry.js";
import { createGeoGuard } from "./lib/geo.js";
import { recordRequestMetric } from "./lib/metrics.js";
import { createStaticAssets, sendAsset } from "./lib/static-assets.js";
import { createTrafficMiddleware } from "./lib/traffic.js";
import { geoGuardConfig } from "./lib/runtime-config.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { dynamicRouter } from "./routes/dynamic.js";
import { meRouter } from "./routes/me.js";
import { merchantRouter } from "./routes/merchant.js";
import { miscRouter } from "./routes/misc.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { ordersRouter } from "./routes/orders.js";
import { scanRouter } from "./routes/scan.js";
import { setupRouter } from "./routes/setup.js";
import { statsRouter } from "./routes/stats.js";

const METRIC_SKIP_PREFIXES = ["/media/", "/assets/", "/api/events/stream"];

function shouldSkipMetrics(pathname: string): boolean {
  return METRIC_SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** 记录接口耗时与状态，用于管理后台的系统状态页（内存缓冲后批量入库） */
function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (shouldSkipMetrics(req.path)) {
    next();
    return;
  }
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    recordRequestMetric(req.method, req.path, res.statusCode, Math.round(durationMs));
  });
  next();
}

/** gzip 压缩阈值：小于 1KB 不值得压缩，大于 512KB 不压（避免大包占用压缩线程池） */
const COMPRESS_MIN_BYTES = 1024;
const COMPRESS_MAX_BYTES = 512 * 1024;
/** 小响应同步压省一次线程池调度，大响应交给异步 zlib，避免阻塞事件循环 */
const COMPRESS_SYNC_LIMIT = 4096;

function acceptsGzip(header: string | undefined): boolean {
  return typeof header === "string" && /(^|,)\s*(gzip|\*)\s*(;|,|$)/i.test(header);
}

/**
 * 对较大的 JSON 响应做 gzip。
 * 只处理 GET（不压缩写请求的响应），带 If-None-Match 时交给 Express 自己的 304 逻辑，
 * 压缩失败则退回原 res.json。
 */
function jsonCompression(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" || req.headers["if-none-match"]) {
    next();
    return;
  }
  if (!acceptsGzip(req.headers["accept-encoding"])) {
    next();
    return;
  }
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown): Response => {
    try {
      const text = JSON.stringify(body);
      if (text.length < COMPRESS_MIN_BYTES || text.length > COMPRESS_MAX_BYTES) {
        return originalJson(body);
      }
      const send = (compressed: Buffer): Response => {
        res.setHeader("Vary", "Accept-Encoding");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Content-Length", String(compressed.length));
        return res.end(compressed) as Response;
      };
      if (text.length <= COMPRESS_SYNC_LIMIT) {
        return send(gzipSync(text));
      }
      gzip(Buffer.from(text), (error, compressed) => {
        if (error || res.writableEnded) {
          if (!res.headersSent) originalJson(body);
          return;
        }
        send(compressed);
      });
      return res;
    } catch {
      return originalJson(body);
    }
  }) as Response["json"];
  next();
}

/**
 * 解析 TRUST_PROXY：默认生产信任 1 层反向代理，开发环境不信任。
 * 直接在公网暴露时保持 false，否则 X-Forwarded-For 可被伪造（影响限流与审计 IP）。
 */
function parseTrustProxy(value: string): boolean | number | string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "" || trimmed === "false" || trimmed === "0") return false;
  if (trimmed === "true") return true;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return value.trim();
}

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", parseTrustProxy(config.trustProxy));
  app.use(securityHeaders);
  // 访问统计与请求指标必须挂在地区限制 / 扫描器拦截之前，才能统计到被拦截的请求
  app.use(createTrafficMiddleware());
  app.use(metricsMiddleware);
  // 扫描器探测路径（/.env、wp-admin 等）直接 404
  app.use(scannerGuard);
  // 地区访问限制：放在最前面，境外请求连接口与静态资源都不必再解析；
  // 配置从 app_config 每请求读取，后台保存后立即生效
  app.use(createGeoGuard({ resolve: geoGuardConfig }));
  app.use(jsonCompression);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());
  // 管理后台安全入口：配置后 /admin 需先经 `/{入口}/admin` 进入，否则记录并返回 404
  app.use(createAdminEntryGuard());

  // 头像与上传文件
  app.use("/media/avatars", express.static(config.avatarDir, { maxAge: "7d", index: false }));
  app.use("/media", express.static(config.uploadDir, { maxAge: "7d", index: false }));

  // 接口统一挂载点：CSRF 校验 + 会话解析 + 初始化状态闸门
  const api = express.Router();
  api.use(csrfGuard);
  api.use(attachUser);
  api.use("/setup", setupRouter);
  api.use(systemGate);
  api.use("/auth", authRouter);
  api.use("/onboarding", onboardingRouter);
  api.use("/me", meRouter);
  api.use("/merchant", merchantRouter);
  api.use("/orders", ordersRouter);
  api.use("/scan", scanRouter);
  api.use("/dynamic-code", dynamicRouter);
  api.use("/stats", statsRouter);
  api.use("/admin", adminRouter);
  api.use(miscRouter);
  app.use("/api", api);

  // 生产环境托管前端构建产物（开发环境由 Vite 提供）
  const hasWebDist = existsSync(path.join(config.webDistDir, "index.html"));
  const indexFile = path.join(config.webDistDir, "index.html");
  if (config.isProduction && hasWebDist) {
    // 静态资源优先发送构建期预压缩的 .br / .gz 变体，主包 377KB → 约 100KB
    app.use(createStaticAssets(config.webDistDir));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api/") || req.path.startsWith("/media/")) {
        next();
        return;
      }
      // SPA 兜底：同样走内容协商，避免 index.html 未压缩
      sendAsset(req, res, next, indexFile, "/index.html", { cacheControl: "no-cache" });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export const app: Express = createApp();
