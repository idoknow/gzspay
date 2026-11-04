import type { Request, Response } from "express";
import { config } from "../config.js";
import type { AuthContext } from "../lib/types.js";

interface SseClient {
  id: number;
  userId: string;
  res: Response;
}

const clients = new Set<SseClient>();
let nextClientId = 1;
const HEARTBEAT_MS = 25_000;
/** 单用户最多保留 5 条连接（多标签页/多设备够用，避免客户端异常重连把内存占满） */
const MAX_CLIENTS_PER_USER = 5;
/** 单进程 SSE 连接总数上限，超过后拒绝新连接，保护内存与 fd */
const MAX_CLIENTS_TOTAL = 2000;

export type SseEventName = "payment_request" | "order_update" | "ticket_update" | "ready" | "ping";

function countUserClients(userId: string): number {
  let count = 0;
  for (const client of clients) {
    if (client.userId === userId) count += 1;
  }
  return count;
}

function writeEvent(client: SseClient, event: SseEventName, data: unknown): void {
  try {
    // 客户端读得慢时先跳过这一条，避免堆积把内存顶爆（心跳会顺带清理状态）
    if (client.res.writableEnded || client.res.writableNeedDrain) return;
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

/** GET /api/events/stream：为当前登录用户建立 SSE 连接 */
export function eventStreamHandler(req: Request, res: Response): void {
  const auth = req.auth as AuthContext | undefined;
  if (!auth) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } });
    return;
  }
  if (clients.size >= MAX_CLIENTS_TOTAL || countUserClients(auth.user.id) >= MAX_CLIENTS_PER_USER) {
    res.status(429).json({
      error: { code: "TOO_MANY_STREAMS", message: "实时连接过多，请关闭其他页面后再试" },
    });
    return;
  }
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const client: SseClient = { id: nextClientId++, userId: auth.user.id, res };
  clients.add(client);
  // 断线后客户端按 retry 自动重连
  res.write(`retry: ${Math.max(1000, config.security.dynamicCodeRefreshSeconds * 1000)}\n\n`);
  writeEvent(client, "ready", { connectedAt: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  const cleanup = (): void => {
    clearInterval(heartbeat);
    clients.delete(client);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

/** 向单个用户推送事件（只推给该用户的所有在线连接） */
export function pushToUser(userId: string, event: SseEventName, data: unknown): void {
  for (const client of clients) {
    if (client.userId === userId) writeEvent(client, event, data);
  }
}

export function pushToUsers(
  userIds: string[],
  event: SseEventName,
  payloadFor: (userId: string) => unknown,
): void {
  if (userIds.length === 0) return;
  const targets = new Set(userIds);
  for (const client of clients) {
    if (targets.has(client.userId)) {
      writeEvent(client, event, payloadFor(client.userId));
    }
  }
}

export function activeStreamCount(): number {
  return clients.size;
}

/** 测试用：关闭全部连接 */
export function closeAllStreams(): void {
  for (const client of clients) {
    try {
      client.res.end();
    } catch {
      // 忽略
    }
  }
  clients.clear();
}

export const eventsConfig = {
  heartbeatMs: HEARTBEAT_MS,
  retryMs: config.security.dynamicCodeRefreshSeconds * 1000,
};
