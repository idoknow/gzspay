import { type Server } from "node:http";
import { app } from "./app.js";
import { config } from "./config.js";
import { cleanupExpired, closeDatabase, execute, migrate, optimizeDatabase } from "./db/index.js";
import { cleanupUploadRetention } from "./lib/retention.js";
import { flushRequestMetrics } from "./lib/metrics.js";
import { flushTrafficCounters, pruneTrafficCounters } from "./lib/traffic.js";
import { backfillQqAvatars } from "./lib/avatar.js";
import { geoDataError, geoDataMeta } from "./lib/geo.js";
import { applyRuntimeConfig, isSystemReady, readAdminConfig } from "./lib/runtime-config.js";
import { assertSecureConfig } from "./lib/security.js";
import { ensureSetupToken } from "./lib/setup-token.js";
import { reportSystemError } from "./lib/alerts.js";

const METRICS_RETENTION_DAYS = 7;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function startCleanupTimer(): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      cleanupExpired();
      cleanupUploadRetention();
      const cutoff = new Date(
        Date.now() - METRICS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      execute("DELETE FROM request_metrics WHERE created_at < ?", cutoff);
      pruneTrafficCounters(400);
      optimizeDatabase();
    } catch (error) {
      reportSystemError({
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
    flushRequestMetrics();
    flushTrafficCounters();
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => {
    flushRequestMetrics();
    flushTrafficCounters();
    closeDatabase();
    process.exit(0);
  }, 5000).unref();
}

function main(): void {
  // 生产环境配置不合格直接拒绝启动，避免带着示例密钥 / http 地址上线
  try {
    assertSecureConfig();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[gzspay] 启动失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (config.isProduction && config.exposeEmailCode) {
    // eslint-disable-next-line no-console
    console.warn("[gzspay] 警告：生产环境开启了 EMAIL_CODE_DEV_MODE，邮箱验证码会回显到接口响应里，请尽快关闭");
  }

  migrate();
  try {
    const refreshed = backfillQqAvatars();
    if (refreshed > 0) {
      // eslint-disable-next-line no-console
      console.log(`[gzspay] 已把 ${refreshed} 个账号的历史缓存头像换回 QQ 头像地址`);
    }
  } catch (error) {
    reportSystemError({
      scope: "avatar",
      message: `头像地址迁移失败：${error instanceof Error ? error.message : String(error)}`,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  try {
    readAdminConfig();
    applyRuntimeConfig();
    // eslint-disable-next-line no-console
    console.log(
      `[gzspay] 初始化状态: ${isSystemReady() ? "已完成" : "未完成（打开 /admin 完成初始化向导）"}`,
    );
    // 未初始化时生成一次性初始化令牌并打印到日志：写初始化配置与首个管理员
    // 授予都要求该令牌，避免攻击者抢先初始化并接管管理员账号。
    if (!isSystemReady()) ensureSetupToken();
  } catch (error) {
    reportSystemError({
      scope: "startup",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[gzspay] 服务已启动: http://localhost:${config.port} (${config.nodeEnv})`);
    if (config.geo.blockNonChina) {
      const meta = geoDataMeta();
      const error = geoDataError();
      // eslint-disable-next-line no-console
      console.log(
        error
          ? `[gzspay] 地区限制已开启，但 IP 归属数据加载失败（${error}），未知归属将按 GEO_UNKNOWN_POLICY=${config.geo.unknownPolicy} 处理`
          : `[gzspay] 地区限制已开启：仅放行中国大陆 IP（数据更新于 ${meta.updatedAt ?? "未知"}，IPv4 ${meta.ipv4Count} 段 / IPv6 ${meta.ipv6Count} 条）`,
      );
    }
  });
  // keep-alive 比反向代理的空闲超时略长，避免代理复用连接时拿到已关闭的 socket；
  // headersTimeout 必须大于 keepAliveTimeout，否则 Node 会先掐掉请求头。
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 60_000;
  const timer = startCleanupTimer();

  process.on("SIGINT", () => shutdown(server, timer, "SIGINT"));
  process.on("SIGTERM", () => shutdown(server, timer, "SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    reportSystemError({
      scope: "unhandledRejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on("uncaughtException", (error) => {
    reportSystemError({
      scope: "uncaughtException",
      message: error.message,
      stack: error.stack ?? undefined,
    });
    // 未捕获异常后进程状态不可信：记录并告警后退出，由守护进程（pm2 / systemd）拉起
    flushRequestMetrics();
    flushTrafficCounters();
    process.exit(1);
  });
}

main();
