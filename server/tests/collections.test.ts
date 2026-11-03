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

/** 直接建立校园墙账号与会话（与 api.test.ts 相同的测试辅助） */
async function login(seed: string, username: string): Promise<{ api: Agent; id: string }> {
  const { user } = loginOrRegister({ sub: `test-col-${seed}`, qq: "13800000000", username }, "127.0.0.1");
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

describe("商家自建收款单", () => {
  let merchantApi: Agent;
  let payerApi: Agent;

  beforeAll(async () => {
    resetDatabaseForTests();
    migrate();
    initializeSystem();

    const merchant = await login("merchant", "收款商家");
    merchantApi = merchant.api;
    await completeOnboarding(merchantApi, "COLM0001", "20239001");
    const qr = await generateQrPngBuffer("https://qr.alipay.com/gzspay-collection-merchant");
    await merchantApi
      .post("/api/merchant/register")
      .field("name", "收款小卖部")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", qr, "alipay.png")
      .expect(201);

    const payer = await login("payer", "付款同学");
    payerApi = payer.api;
    await completeOnboarding(payerApi, "COLP0001", "20239002");
  });

  afterAll(() => {
    // 测试库留在 data 目录便于排查
  });

  it("未登录不能预览收款单", async () => {
    const response = await request(app).get("/api/collections/whatever-token");
    expect(response.status).toBe(401);
  });

  it("商家可以按金额创建收款单并拿到二维码链接", async () => {
    const response = await merchantApi
      .post("/api/merchant/collections")
      .send({ amountCents: 1580, reservedNote: "奶茶两杯" })
      .expect(201);
    expect(response.body.collection.status).toBe("pending");
    expect(response.body.collection.amountCents).toBe(1580);
    expect(response.body.collection.title).toBe("自定义收款");
    expect(response.body.collection.reservedNote).toBe("奶茶两杯");
    expect(String(response.body.url)).toContain("/collect/");
    expect(String(response.body.url)).toContain(config.publicBaseUrl);
  });

  it("超过单笔上限时不能创建收款单", async () => {
    const response = await merchantApi
      .post("/api/merchant/collections")
      .send({ amountCents: 500_001 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("LIMIT_EXCEEDED");
  });

  it("付款人扫码预览后可以用支付密码付款，收款单随即失效", async () => {
    const created = await merchantApi
      .post("/api/merchant/collections")
      .send({ amountCents: 880, title: "可乐一瓶" })
      .expect(201);
    const token = String(created.body.url).split("/collect/")[1];
    expect(token).toBeTruthy();
    const collectionId = created.body.collection.id as string;

    const preview = await payerApi.get(`/api/collections/${token}`).expect(200);
    expect(preview.body.payeable).toBe(true);
    expect(preview.body.amountCents).toBe(880);
    expect(preview.body.merchantName).toBe("收款小卖部");

    // 商家自己不能给自己的收款单付款
    const self = await merchantApi.get(`/api/collections/${token}`);
    expect(self.status).toBe(409);

    // 密码错误时收款单保持可用
    const wrong = await payerApi
      .post(`/api/collections/${token}/pay`)
      .send({ paymentPassword: "000000" });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(wrong.status).toBeLessThan(500);
    const stillPending = await merchantApi.get(`/api/merchant/collections/${collectionId}`).expect(200);
    expect(stillPending.body.status).toBe("pending");

    const paid = await payerApi
      .post(`/api/collections/${token}/pay`)
      .send({ paymentPassword: "123456" })
      .expect(201);
    expect(paid.body.order.status).toBe("pending_payment");
    expect(paid.body.order.amountCents).toBe(880);
    expect(paid.body.order.title).toBe("可乐一瓶");
    expect(paid.body.order.role).toBe("payer");
    expect(paid.body.collection.status).toBe("used");
    expect(paid.body.collection.orderId).toBe(paid.body.order.id);

    // 重复付款被拒绝
    const again = await payerApi
      .post(`/api/collections/${token}/pay`)
      .send({ paymentPassword: "123456" });
    expect(again.status).toBe(409);

    const merchantView = await merchantApi.get(`/api/merchant/collections/${collectionId}`).expect(200);
    expect(merchantView.body.status).toBe("used");
    expect(merchantView.body.orderId).toBe(paid.body.order.id);
  });

  it("商家可以作废收款单，作废后付款人不能付款", async () => {
    const created = await merchantApi
      .post("/api/merchant/collections")
      .send({ amountCents: 1200 })
      .expect(201);
    const token = String(created.body.url).split("/collect/")[1];
    const collectionId = created.body.collection.id as string;

    const cancelled = await merchantApi
      .post(`/api/merchant/collections/${collectionId}/cancel`)
      .expect(200);
    expect(cancelled.body.status).toBe("cancelled");

    const preview = await payerApi.get(`/api/collections/${token}`).expect(200);
    expect(preview.body.payeable).toBe(false);

    const pay = await payerApi
      .post(`/api/collections/${token}/pay`)
      .send({ paymentPassword: "123456" });
    expect(pay.status).toBe(409);
  });

  it("扫商家校园卡直接返回待付款收款单，并可按 id 预览与付款", async () => {
    const created = await merchantApi
      .post("/api/merchant/collections")
      .send({ amountCents: 660, title: "手打柠檬茶", reservedNote: "少冰" })
      .expect(201);
    const collectionId = created.body.collection.id as string;

    // 付款人扫商家原本的校园卡二维码，带上待付款收款单
    const scanned = await payerApi
      .post("/api/scan/card")
      .send({ cardContent: buildCardQrContent("COLM0001") })
      .expect(200);
    expect(scanned.body.isMerchant).toBe(true);
    expect(scanned.body.pendingCollection).toMatchObject({
      id: collectionId,
      amountCents: 660,
      title: "手打柠檬茶",
    });

    const preview = await payerApi.get(`/api/collections/id/${collectionId}`).expect(200);
    expect(preview.body.payeable).toBe(true);
    expect(preview.body.amountCents).toBe(660);
    expect(preview.body.reservedNote).toBe("少冰");
    expect(typeof preview.body.noteRequirement).toBe("string");

    const paid = await payerApi
      .post(`/api/collections/id/${collectionId}/pay`)
      .send({ paymentPassword: "123456" })
      .expect(201);
    expect(paid.body.order.amountCents).toBe(660);
    expect(paid.body.order.title).toBe("手打柠檬茶");
    expect(paid.body.collection.status).toBe("used");

    // 用完后扫校园卡不再带这笔收款单（前面用例可能还有其它 pending 单）
    const rescan = await payerApi
      .post("/api/scan/card")
      .send({ cardContent: buildCardQrContent("COLM0001") })
      .expect(200);
    expect(rescan.body.pendingCollection?.id).not.toBe(collectionId);

    const again = await payerApi
      .post(`/api/collections/id/${collectionId}/pay`)
      .send({ paymentPassword: "123456" });
    expect(again.status).toBe(409);
  });

  it("收款单列表只显示自己的收款单", async () => {
    const list = await merchantApi.get("/api/merchant/collections?limit=10").expect(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.items.length).toBeGreaterThan(0);

    const other = await payerApi.get("/api/merchant/collections");
    expect(other.status).toBe(403);
  });
});
