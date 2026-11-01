import cookieParser from "cookie-parser";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { execute } from "./db/index.js";
import {
  attachUser,
  csrfGuard,
  errorHandler,
  notFoundHandler,
  securityHeaders,
  systemGate,
} from "./lib/http.js";
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

/** 记录接口耗时与状态，用于管理后台的系统状态页。 */
function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (shouldSkipMetrics(req.path)) {
    next();
    return;
  }
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      execute(
        "INSERT INTO request_metrics (method, path, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)",
        req.method,
        req.path,
        res.statusCode,
        Math.round(durationMs),
        new Date().toISOString(),
      );
    } catch {
      // 指标写入失败不影响业务请求
    }
  });
  next();
}

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(securityHeaders);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());
  app.use(metricsMiddleware);

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
  if (config.isProduction && hasWebDist) {
    app.use(
      express.static(config.webDistDir, {
        index: false,
        maxAge: "1h",
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api/") || req.path.startsWith("/media/")) {
        next();
        return;
      }
      res.sendFile(path.join(config.webDistDir, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

export const app: Express = createApp();
