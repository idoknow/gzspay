import { runBatch } from "../db/index.js";

/**
 * 请求指标批量写入。
 *
 * 原实现是每个请求 finish 后直接 INSERT 一行：高并发下这会把数据库写事务
 * 打散成大量小事务，既拖慢请求也让 WAL 频繁落盘。这里先在内存里攒着，
 * 最多每秒（或攒满 200 条）批量写一次，读接口不受影响。
 */
interface MetricEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  createdAt: string;
}

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_THRESHOLD = 200;
const BUFFER_LIMIT = 5000;

let buffer: MetricEntry[] = [];
let timer: NodeJS.Timeout | null = null;

function insertRows(entries: MetricEntry[]): void {
  try {
    runBatch(
      entries.map((entry) => ({
        sql: "INSERT INTO request_metrics (method, path, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)",
        params: [entry.method, entry.path, entry.status, entry.durationMs, entry.createdAt],
      })),
    );
  } catch {
    // 指标写入失败不影响业务请求
  }
}

/** 立刻把缓冲区写入数据库（定时器触发、进程退出前调用） */
export function flushRequestMetrics(): void {
  if (buffer.length === 0) return;
  const pending = buffer;
  buffer = [];
  insertRows(pending);
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setInterval(() => {
    flushRequestMetrics();
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

/** 记录一次请求；写满阈值时立即落库，否则等定时器 */
export function recordRequestMetric(
  method: string,
  path: string,
  status: number,
  durationMs: number,
): void {
  if (buffer.length >= BUFFER_LIMIT) {
    // 极端情况下（大量并发 + 数据库写入慢）丢弃最旧的指标，优先保证内存不涨
    buffer.splice(0, buffer.length - BUFFER_LIMIT + 1);
  }
  buffer.push({
    method,
    path,
    status,
    durationMs,
    createdAt: new Date().toISOString(),
  });
  if (buffer.length >= FLUSH_THRESHOLD) {
    flushRequestMetrics();
    return;
  }
  scheduleFlush();
}

/** 测试用：清空缓冲，不写库 */
export function resetRequestMetricsBuffer(): void {
  buffer = [];
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
