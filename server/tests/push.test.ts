import { afterAll, beforeAll, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { execute, migrate, queryOne, resetDatabaseForTests } from "../src/db/index.js";
import { hashToken, randomToken } from "../src/lib/crypto.js";
import { resetRateLimits } from "../src/lib/rate-limit.js";
import { applyRuntimeConfig } from "../src/lib/runtime-config.js";
import { isPushConfigured, sendPushToUser } from "../src/services/push.js";
import { loginOrRegister } from "../src/services/users.js";

const CSRF = { "X-Requested-With": "gzspay" };
const TOKEN = "fcm-token-for-tests-0123456789-abcdefghijklmnop";

interface Session {
  post(url: string): request.Test;
  delete(url: string): request.Test;
}

function cookieSession(cookie: string): Session {
  const attach = (test: request.Test) => test.set(CSRF).set("Cookie", cookie);
  return {
    post: (url) => attach(request(app).post(url)),
    delete: (url) => attach(request(app).delete(url)),
  };
}

async function login(seed: string): Promise<{ session: Session; id: string }> {
  const { user } = loginOrRegister(
    { sub: `push-${seed}`, qq: "13800000000", username: seed },
    "127.0.0.1",
  );
  const token = randomToken(32);
  const now = new Date();
  execute(
    "INSERT INTO sessions (id, user_id, kind, ip, user_agent, created_at, expires_at, last_seen_at) VALUES (?, ?, 'user', '127.0.0.1', 'vitest', ?, ?, ?)",
    hashToken(token),
    user.id,
    now.toISOString(),
    new Date(now.getTime() + 604800000).toISOString(),
    now.toISOString(),
  );
  return { session: cookieSession(`${config.sessionCookieName}=${token}`), id: user.id };
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

beforeAll(() => {
  resetDatabaseForTests();
  migrate();
  initializeSystem();
  resetRateLimits();
});

afterAll(() => {
  vi.restoreAllMocks();
});

it("推送令牌注册是幂等的，注销后删除", async () => {
  const { session, id } = await login("owner");
  await session.post("/api/me/push-token").send({ token: TOKEN }).expect(201);
  await session.post("/api/me/push-token").send({ token: TOKEN }).expect(201);
  expect(
    queryOne<{ user_id: string }>("SELECT user_id FROM push_tokens WHERE token = ?", TOKEN)
      ?.user_id,
  ).toBe(id);
  expect(
    queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM push_tokens WHERE token = ?",
      TOKEN,
    )?.count,
  ).toBe(1);

  await session.delete("/api/me/push-token").send({ token: TOKEN }).expect(200);
  expect(queryOne("SELECT token FROM push_tokens WHERE token = ?", TOKEN)).toBeUndefined();
});

it("拒绝过短的令牌与未登录请求", async () => {
  const { session } = await login("guard");
  await session.post("/api/me/push-token").send({ token: "short" }).expect(400);
  await request(app).post("/api/me/push-token").set(CSRF).send({ token: TOKEN }).expect(401);
});

it("未配置 FCM 时不发起外部请求", async () => {
  expect(isPushConfigured()).toBe(false);
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  await sendPushToUser("nobody", { title: "t", body: "b" });
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
