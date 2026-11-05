import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
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
}

function cookieSession(cookie: string): Agent {
  const attach = (test: request.Test) => test.set(CSRF).set("Cookie", cookie);
  return {
    get: (url) => attach(request(app).get(url)),
    post: (url) => attach(request(app).post(url)),
    patch: (url) => attach(request(app).patch(url)),
  };
}

async function login(seed: string, username: string): Promise<{ api: Agent; id: string }> {
  const { user } = loginOrRegister({ sub: `test-sec-${seed}`, qq: "13800000000", username }, "127.0.0.1");
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
  return { api: cookieSession(`${config.sessionCookieName}=${token}`), id: user.id };
}

async function loginAdmin(seed: string, role: "super" | "ops" | "auditor"): Promise<Agent> {
  const account = await login(seed, `${seed}-admin`);
  execute(
    "INSERT INTO admins (user_id, role, created_by, created_at) VALUES (?, ?, ?, ?)",
    account.id,
    role,
    null,
    new Date().toISOString(),
  );
  return account.api;
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
    execute("INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)", key, value, now);
  }
}

describe("安全加固回归", () => {
  let payer: { api: Agent; id: string };
  let outsider: { api: Agent; id: string };
  let merchantUserId = "";
  let auditor: Agent;
  let orderId = "";

  beforeAll(async () => {
    resetDatabaseForTests();
    migrate();
    initializeSystem();
    applyRuntimeConfig();

    payer = await login("payer", "payer-sec");
    await completeOnboarding(payer.api, "CSPAY001", "20239401");

    const merchant = await login("merchant", "merchant-sec");
    await completeOnboarding(merchant.api, "CSMERCH1", "20239402");
    merchantUserId = merchant.id;
    const merchantQr = await generateQrPngBuffer("https://qr.alipay.com/gzspay-sec-merchant");
    await merchant.api
      .post("/api/merchant/register")
      .field("name", "安全测试小店")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", merchantQr, "alipay.png")
      .expect(201);

    outsider = await login("outsider", "outsider-sec");
    await completeOnboarding(outsider.api, "CSOUT001", "20239403");

    auditor = await loginAdmin("auditor", "auditor");

    const created = await payer.api
      .post("/api/orders")
      .send({
        merchantUserId,
        amountCents: 660,
        reservedNote: "测试 一杯",
        paymentPassword: "123456",
        idempotencyKey: "sec-order-access-1",
      })
      .expect(201);
    orderId = created.body.order.id as string;
  });

  afterAll(() => {
    resetDatabaseForTests();
  });

  it("非参与方读取订单返回 404，不泄露订单是否存在", async () => {
    const response = await outsider.api.get(`/api/orders/${orderId}`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("超过 5MB 的付款截图直接拒绝，不会把 500 抛给前端", async () => {
    const png = await generateQrPngBuffer("https://example.test");
    const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]);
    const response = await payer.api
      .post(`/api/orders/${orderId}/payment-proof`)
      .attach("file", big, { filename: "big.png", contentType: "image/png" });
    expect([413, 400]).toContain(response.status);
    expect(response.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("只读审计员不能导出全站订单与日志", async () => {
    await auditor.get("/api/admin/orders/export").expect(403);
    await auditor.get("/api/admin/logs/export").expect(403);
  });

  it("初始化令牌校验失败时拒绝", async () => {
    const response = await request(app).post("/api/setup/token").set(CSRF).send({ token: "NOT-THE-TOKEN" });
    expect([400, 403]).toContain(response.status);
  });

  it("后台用户搜索里的 LIKE 通配符按字面处理", async () => {
    const admin = await loginAdmin("search", "super");
    const all = await admin.get("/api/admin/users").query({ query: "%" }).expect(200);
    const none = await admin.get("/api/admin/users").query({ query: "%zzz%" }).expect(200);
    expect(all.body.total).toBe(0);
    expect(none.body.total).toBe(0);
  });
});
