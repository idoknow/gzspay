import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Server } from "node:http";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { execute, migrate, resetDatabaseForTests } from "../src/db/index.js";
import { buildCardQrContent, hashToken, randomToken } from "../src/lib/crypto.js";
import { generateQrPngBuffer } from "../src/lib/qr.js";
import { applyRuntimeConfig } from "../src/lib/runtime-config.js";
import { loginOrRegister } from "../src/services/users.js";

const CSRF = { "X-Requested-With": "gzspay" };

interface Agent {
  get(url: string): request.Test;
  post(url: string): request.Test;
  patch(url: string): request.Test;
  put(url: string): request.Test;
  delete(url: string): request.Test;
}

function cookieSession(cookie: string): Agent {
  const attach = (test: request.Test) => test.set(CSRF).set("Cookie", cookie);
  return {
    get: (url) => attach(request(app).get(url)),
    post: (url) => attach(request(app).post(url)),
    patch: (url) => attach(request(app).patch(url)),
    put: (url) => attach(request(app).put(url)),
    delete: (url) => attach(request(app).delete(url)),
  };
}

async function login(
  seed: string,
  username: string,
): Promise<{ api: Agent; id: string; cookie: string }> {
  const { user } = loginOrRegister(
    { sub: `test-ticket-sse-${seed}`, qq: "13800000000", username },
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
  return { api: cookieSession(cookie), id: user.id, cookie };
}

async function completeOnboarding(api: Agent, cardNo: string, studentNo: string): Promise<void> {
  await api.post("/api/onboarding/name").send({ surname: "测", givenName: "试" }).expect(200);
  await api.post("/api/onboarding/student-no").send({ studentNo }).expect(200);
  const email = `${studentNo}@qq.com`;
  const started = await api.post("/api/onboarding/email/start").send({ email }).expect(200);
  await api.post("/api/onboarding/email/verify").send({ email, code: started.body.devCode }).expect(200);
  await api.post("/api/onboarding/card").send({ cardContent: buildCardQrContent(cardNo) }).expect(200);
  await api.post("/api/onboarding/payment-password").send({ password: "123456", confirm: "123456" }).expect(200);
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

describe("工单消息实时推送", () => {
  let merchant: { api: Agent; id: string; cookie: string };
  let payer: { api: Agent; id: string; cookie: string };
  let server: Server;
  let baseUrl = "";
  let publisher: AbortController | null = null;
  let streamed = "";

  beforeAll(async () => {
    resetDatabaseForTests();
    migrate();
    initializeSystem();

    merchant = await login("merchant", "实时商家");
    await completeOnboarding(merchant.api, "BTMM0001", "20239401");
    const qr = await generateQrPngBuffer("https://qr.alipay.com/gzspay-ticket-sse");
    await merchant.api
      .post("/api/merchant/register")
      .field("name", "实时小卖部")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", qr, "alipay.png")
      .expect(201);

    payer = await login("payer", "实时同学");
    await completeOnboarding(payer.api, "BTPP0001", "20239402");

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
    publisher?.abort();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("对方发消息时，付款人的事件流能立刻收到 ticket_update", async () => {
    const created = await payer.api
      .post("/api/orders")
      .send({
        merchantUserId: merchant.id,
        amountCents: 1500,
        reservedNote: "实时推送",
        paymentPassword: "123456",
        idempotencyKey: "ticket-sse-order",
      })
      .expect(201);
    const orderId = created.body.order.id as string;

    const ticket = await payer.api
      .post("/api/tickets")
      .send({ orderId, category: "amount", description: "金额好像对不上，帮忙看一下" })
      .expect(201);
    const ticketId = ticket.body.ticket.id as string;

    // 付款人订阅自己的事件流
    publisher = new AbortController();
    const response = await fetch(`${baseUrl}/api/events/stream`, {
      headers: { cookie: payer.cookie, accept: "text/event-stream" },
      signal: publisher.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          streamed += decoder.decode(value, { stream: true });
        }
      } catch {
        /* 主动 abort 时抛错，忽略 */
      }
    })();

    // 等连接建立（服务端会先推一条 ready）
    await waitForText(() => streamed, "event: ready", 4000);

    // 商家在工单里回复
    await merchant.api
      .post(`/api/tickets/${ticketId}/messages`)
      .send({ body: "我核对一下账单，稍等" })
      .expect(201);

    const text = await waitForText(() => streamed, "ticket_update", 4000);
    expect(text).toContain("event: ticket_update");
    expect(text).toContain(ticketId);
    expect(text).toContain("我核对一下账单");
  });
});
