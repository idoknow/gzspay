/**
 * 登录设备：当前设备标记 + 强制退出后的实时下线。
 *
 * 第二个问题是重点：B 设备被 A 踢下线后，不能等用户自己刷新页面，
 * 服务端要通过 SSE 推 `session_revoked`，前端据此立刻退出登录。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { execute, migrate, resetDatabaseForTests } from "../src/db/index.js";
import { hashToken, randomToken } from "../src/lib/crypto.js";
import { applyRuntimeConfig } from "../src/lib/runtime-config.js";
import { closeAllStreams } from "../src/services/events.js";
import { forceUserLogout } from "../src/services/admin.js";
import { loginOrRegister } from "../src/services/users.js";

const CSRF = { "X-Requested-With": "gzspay" };

interface Agent {
  get(url: string): request.Test;
  post(url: string): request.Test;
}

interface LoggedIn {
  api: Agent;
  userId: string;
  /** 服务端 sessions.id（= hashToken(token)） */
  sessionId: string;
  cookie: string;
}

function cookieSession(cookie: string): Agent {
  const attach = (test: request.Test) => test.set(CSRF).set("Cookie", cookie);
  return {
    get: (url) => attach(request(app).get(url)),
    post: (url) => attach(request(app).post(url)),
  };
}

/** 同一 sub 每次登录都会新建一条会话，正好模拟「同一账号在两台设备上登录」 */
function login(seed: string, username: string): LoggedIn {
  const { user } = loginOrRegister(
    { sub: `test-device-${seed}`, qq: "13800000000", username },
    "127.0.0.1",
  );
  const token = randomToken(32);
  const now = new Date();
  execute(
    "INSERT INTO sessions (id, user_id, kind, ip, user_agent, created_at, expires_at, last_seen_at) VALUES (?, ?, 'user', '127.0.0.1', 'vitest', ?, ?, ?)",
    hashToken(token),
    user.id,
    now.toISOString(),
    new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString(),
    now.toISOString(),
  );
  const cookie = `${config.sessionCookieName}=${token}`;
  return { api: cookieSession(cookie), userId: user.id, sessionId: hashToken(token), cookie };
}

function initializeSystem(): void {
  const now = new Date().toISOString();
  const rows: [string, string][] = [
    ["system.initialized", "1"],
    ["system.siteName", "校园服务"],
    ["campux.baseUrl", "https://campux.test"],
    ["campux.clientId", "test-client"],
    ["campux.clientSecret", "test-secret"],
  ];
  for (const [key, value] of rows) {
    execute(
      "INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)",
      key,
      value,
      now,
    );
  }
  applyRuntimeConfig();
}

/** 等 SSE 文本出现某个片段（最多等 timeout 毫秒） */
async function waitForText(read: () => string, needle: string, timeout = 4000): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const text = read();
    if (text.includes(needle)) return text;
    await new Promise((r) => setTimeout(r, 50));
  }
  return read();
}

describe("登录设备实时状态", () => {
  const controllers: AbortController[] = [];
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    resetDatabaseForTests();
    migrate();
    initializeSystem();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const controller of controllers) controller.abort();
    // 关掉服务端残留的 SSE 连接，否则 server.close 会一直等
    closeAllStreams();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** 建立一条 SSE 连接，返回累积文本的读取函数 */
  async function openStream(cookie: string): Promise<{ read: () => string }> {
    const controller = new AbortController();
    controllers.push(controller);
    let buffered = "";
    const response = await fetch(`${baseUrl}/api/events/stream`, {
      headers: { cookie, accept: "text/event-stream" },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
        }
      } catch {
        /* 主动 abort 时抛错，忽略 */
      }
    })();
    const stream = { read: () => buffered };
    await waitForText(stream.read, "event: ready", 4000);
    return stream;
  }

  it("设备列表带本机与在线标记，强制退出后对方立刻收到 session_revoked 并失去会话", async () => {
    const deviceA = login("pair", "双设备用户");
    const deviceB = login("pair", "双设备用户");

    const listed = await deviceA.api.get("/api/me/devices").expect(200);
    expect(typeof listed.body.onlineWindowMinutes).toBe("number");
    const items = listed.body.items as Array<{
      id: string;
      current: boolean;
      online: boolean;
      lastSeenAt: string;
    }>;
    expect(items).toHaveLength(2);
    const current = items.find((item) => item.current);
    expect(current?.id).toBe(deviceA.sessionId);
    expect(current?.online).toBe(true);
    // 另一台设备也在线（刚登录，last_seen_at 是现在）
    const other = items.find((item) => item.id === deviceB.sessionId);
    expect(other?.current).toBe(false);
    expect(other?.online).toBe(true);

    // 两台设备都打开事件流
    const streamB = await openStream(deviceB.cookie);
    const streamA = await openStream(deviceA.cookie);

    const startedAt = Date.now();
    const revoked = await deviceA.api
      .post(`/api/me/devices/${deviceB.sessionId}/logout`)
      .send({})
      .expect(200);
    expect(revoked.body).toEqual({ ok: true, current: false });

    // B 的会话已删除：再访问 /api/me 直接 401
    await deviceB.api.get("/api/me").expect(401);

    const textB = await waitForText(streamB.read, "event: session_revoked", 4000);
    const elapsedMs = Date.now() - startedAt;
    expect(textB).toContain("event: session_revoked");
    expect(textB).toContain(deviceB.sessionId);
    expect(textB).toContain('"reason":"device"');
    // 顺带推一条 devices_update，让还开着的设备页刷新列表
    expect(await waitForText(streamB.read, "event: devices_update", 4000)).toContain(
      "event: devices_update",
    );
    // 实测：从踢人到被踢设备收到通知只用了这么久
    expect(elapsedMs).toBeLessThan(2000);
    console.info(`[devices] 强制退出后 ${elapsedMs}ms 内收到 session_revoked`);

    // 操作方（A）自己不受影响：不收到 session_revoked，会话依然有效
    await new Promise((r) => setTimeout(r, 300));
    expect(streamA.read()).not.toContain("session_revoked");
    await deviceA.api.get("/api/me").expect(200);

    const after = await deviceA.api.get("/api/me/devices").expect(200);
    const remaining = after.body.items as Array<{ id: string; current: boolean }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(deviceA.sessionId);
    expect(remaining[0]?.current).toBe(true);
  });

  it("管理员强制下线推送 reason=admin", async () => {
    const target = login("admin-force", "被下线用户");
    const stream = await openStream(target.cookie);

    // 后台「强制下线」：撤销该用户全部会话，并通知在线连接
    forceUserLogout(target.userId, target.userId, "127.0.0.1");

    const text = await waitForText(stream.read, "event: session_revoked", 4000);
    expect(text).toContain("event: session_revoked");
    expect(text).toContain(target.sessionId);
    expect(text).toContain('"reason":"admin"');
    await target.api.get("/api/me").expect(401);
  });
});
