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

export type SseEventName = "payment_request" | "order_update" | "ready" | "ping";

function writeEvent(client: SseClient, event: SseEventName, data: unknown): void {
  try {
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
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const client: SseClient = { id: nextClientId++, userId: auth.user.id, res };
  clients.add(client);
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
  for (const client of clients) {
    if (userIds.includes(client.userId)) {
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
