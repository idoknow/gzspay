import { type Server } from "node:http";
import { app } from "./app.js";
import { config } from "./config.js";
import { cleanupExpired, closeDatabase, execute, migrate } from "./db/index.js";
import { applyRuntimeConfig, isSystemReady, readAdminConfig } from "./lib/runtime-config.js";
import { writeSystemError } from "./lib/audit.js";

const METRICS_RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function startCleanupTimer(): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      cleanupExpired();
      const cutoff = new Date(
        Date.now() - METRICS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      execute("DELETE FROM request_metrics WHERE created_at < ?", cutoff);
    } catch (error) {
      writeSystemError({
        scope: "cleanup",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }, CLEANUP_INTERVAL_MS);
  timer.unref();
  return timer;
}

function shutdown(server: Server, timer: NodeJS.Timeout, signal: string): void {
  // eslint-disable-next-line no-console
  console.log(`[gzspay] 收到 ${signal}，正在关闭服务…`);
  clearInterval(timer);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

function main(): void {
  migrate();
  try {
    readAdminConfig();
    applyRuntimeConfig();
    // eslint-disable-next-line no-console
    console.log(
      `[gzspay] 初始化状态: ${isSystemReady() ? "已完成" : "未完成（打开 /admin 完成初始化向导）"}`,
    );
  } catch (error) {
    writeSystemError({
      scope: "startup",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[gzspay] 服务已启动: http://localhost:${config.port} (${config.nodeEnv})`);
  });
  const timer = startCleanupTimer();

  process.on("SIGINT", () => shutdown(server, timer, "SIGINT"));
  process.on("SIGTERM", () => shutdown(server, timer, "SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    writeSystemError({
      scope: "unhandledRejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

main();
