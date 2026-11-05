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
const PID = "2088123456789012";

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

async function login(seed: string, username: string): Promise<{ api: Agent; id: string }> {
  const { user } = loginOrRegister(
    { sub: `test-prefill-${seed}`, qq: "13800000000", username },
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
    execute(
      "INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)",
      key,
      value,
      now,
    );
  }
  applyRuntimeConfig();
}

/** 拼一份支付宝记账本导出的 CSV（说明行 + 表头 + 数据） */
function alipayCsv(rows: { time: string; amount: string; note: string }[]): Buffer {
  const header = "记录时间,分类,收支类型,金额,备注,账户,来源,标签,";
  const lines = [
    "支付宝记账本导出",
    "导出说明：仅供本人核对使用",
    "",
    header,
    ...rows.map((row) => `${row.time},生意,收入,${row.amount},${row.note},,,,`),
  ];
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

describe("支付宝一键付款（金额与备注预填）", () => {
  let merchantApi: Agent;
  let merchantId: string;
  let payerApi: Agent;
  let opsApi: Agent;
  let auditorApi: Agent;
  let idempotency = 0;

  async function createOrder(amountCents: number): Promise<{ id: string; orderNo: string }> {
    idempotency += 1;
    const created = await payerApi
      .post("/api/orders")
      .send({
        merchantUserId: merchantId,
        amountCents,
        reservedNote: "一键付款测试",
        paymentPassword: "123456",
        idempotencyKey: `prefill-${idempotency}`,
      })
      .expect(201);
    return { id: created.body.order.id as string, orderNo: created.body.order.orderNo as string };
  }

  beforeAll(async () => {
    resetDatabaseForTests();
    migrate();
    initializeSystem();

    const merchant = await login("merchant", "预填商家");
    merchantApi = merchant.api;
    merchantId = merchant.id;
    await completeOnboarding(merchantApi, "BFMM0001", "20239301");
    const qr = await generateQrPngBuffer("https://qr.alipay.com/gzspay-prefill-merchant");
    await merchantApi
      .post("/api/merchant/register")
      .field("name", "预填小卖部")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", qr, "alipay.png")
      .expect(201);

    const payer = await login("payer", "预填同学");
    payerApi = payer.api;
    await completeOnboarding(payerApi, "BFPP0001", "20239302");

    opsApi = await loginAdmin("prefill-ops", "ops");
    auditorApi = await loginAdmin("prefill-auditor", "auditor");
  });

  afterAll(() => {
    // 测试库留在 data 目录便于排查
  });

  it("后台还没填 PID 时，订单不提供一键付款", async () => {
    const order = await createOrder(1200);
    const detail = await payerApi.get(`/api/orders/${order.id}`).expect(200);
    expect(detail.body.alipayPrefillEnabled).toBe(false);

    const response = await payerApi.get(`/api/orders/${order.id}/alipay-prefill`).expect(400);
    expect(response.body.error.message).toContain("还没有开通支付宝快捷付款");
  });

  it("只有运营能填 PID，且 PID 必须是 2088 开头的数字", async () => {
    const denied = await auditorApi
      .post(`/api/admin/merchants/${merchantId}/channels/alipay/pay-uid`)
      .send({ payUid: PID })
      .expect(403);
    expect(denied.body.error).toBeTruthy();

    const invalid = await opsApi
      .post(`/api/admin/merchants/${merchantId}/channels/alipay/pay-uid`)
      .send({ payUid: "1234567890" })
      .expect(400);
    expect(invalid.body.error.message).toContain("2088");

    const wechat = await opsApi
      .post(`/api/admin/merchants/${merchantId}/channels/wechat/pay-uid`)
      .send({ payUid: PID })
      .expect(400);
    expect(wechat.body.error.message).toContain("支付宝");

    const saved = await opsApi
      .post(`/api/admin/merchants/${merchantId}/channels/alipay/pay-uid`)
      .send({ payUid: PID })
      .expect(200);
    const alipay = (saved.body.merchant.channels as { channel: string; alipayPid: string }[]).find(
      (item) => item.channel === "alipay",
    );
    expect(alipay?.alipayPid).toBe(PID);
  });

  it("付款人能拿到预填金额与备注的唤起链接与二维码", async () => {
    const order = await createOrder(1200);
    const detail = await payerApi.get(`/api/orders/${order.id}`).expect(200);
    expect(detail.body.alipayPrefillEnabled).toBe(true);

    const prefill = await payerApi.get(`/api/orders/${order.id}/alipay-prefill`).expect(200);
    expect(String(prefill.body.scheme)).toContain("alipays://platformapi/startapp");
    expect(String(prefill.body.scheme)).toContain(PID);
    expect(String(prefill.body.scheme)).toContain("12.00");
    expect(prefill.body.amountCents).toBe(1200);
    expect(prefill.body.memo).toBe(order.orderNo);
    expect(String(prefill.body.qrPayload)).toContain("appId=20000067");

    const png = await payerApi.get(`/api/orders/${order.id}/alipay-prefill/qr`).expect(200);
    expect(png.headers["content-type"]).toContain("image/png");
    expect(png.body.subarray(0, 4).toString("hex")).toBe("89504e47");

    // 商家不能替付款人取这个链接
    const merchantView = await merchantApi
      .get(`/api/orders/${order.id}/alipay-prefill`)
      .expect(403);
    expect(merchantView.body.error.message).toContain("付款人");
  });

  it("账单备注写订单号时也能自动对账确认收款", async () => {
    const order = await createOrder(2300);
    const uploaded = await merchantApi
      .post("/api/merchant/bills")
      .attach(
        "file",
        alipayCsv([{ time: "2026-11-06 09:30:00", amount: "23.00", note: `订单${order.orderNo}` }]),
        "prefill.csv",
      )
      .expect(201);
    expect(uploaded.body.matchedCount).toBe(1);

    const detail = await payerApi.get(`/api/orders/${order.id}`).expect(200);
    expect(detail.body.status).toBe("completed");

    // 已完成的订单不再提供一键付款
    const closed = await payerApi.get(`/api/orders/${order.id}/alipay-prefill`).expect(409);
    expect(closed.body.error.message).toContain("不需要付款");
  });

  it("清空 PID 后一键付款重新关闭", async () => {
    const cleared = await opsApi
      .post(`/api/admin/merchants/${merchantId}/channels/alipay/pay-uid`)
      .send({ payUid: "" })
      .expect(200);
    const alipay = (cleared.body.merchant.channels as { channel: string; alipayPid: string }[]).find(
      (item) => item.channel === "alipay",
    );
    expect(alipay?.alipayPid).toBe("");

    const order = await createOrder(900);
    const detail = await payerApi.get(`/api/orders/${order.id}`).expect(200);
    expect(detail.body.alipayPrefillEnabled).toBe(false);
  });
});
