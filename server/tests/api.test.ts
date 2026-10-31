import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { execute, migrate, queryOne, resetDatabaseForTests } from "../src/db/index.js";
import { buildCardQrContent, hashToken, randomToken } from "../src/lib/crypto.js";
import { generateQrPngBuffer } from "../src/lib/qr.js";

const CSRF = { "X-Requested-With": "gzspay" };

interface Agent {
  get(url: string): request.Test;
  post(url: string): request.Test;
  patch(url: string): request.Test;
  put(url: string): request.Test;
  delete(url: string): request.Test;
}

function agentWith(session: request.SuperAgentTest): Agent {
  return {
    get: (url) => session.get(url).set(CSRF),
    post: (url) => session.post(url).set(CSRF),
    patch: (url) => session.patch(url).set(CSRF),
    put: (url) => session.put(url).set(CSRF),
    delete: (url) => session.delete(url).set(CSRF),
  };
}

async function login(seed: string, username: string): Promise<{ session: request.SuperAgentTest; id: string }> {
  const session = request.agent(app);
  const response = await session
    .post("/api/auth/dev-login")
    .set(CSRF)
    .send({ sub: `test-${seed}`, name: "13800000000", username })
    .expect(200);
  return { session, id: response.body.me.id as string };
}

async function completeOnboarding(
  session: request.SuperAgentTest,
  options: { cardNo: string; studentNo: string },
): Promise<void> {
  const api = agentWith(session);
  await api.post("/api/onboarding/name").send({ surname: "张", givenName: "三" }).expect(200);
  await api.post("/api/onboarding/student-no").send({ studentNo: options.studentNo }).expect(200);
  const email = `${options.studentNo}@example.com`;
  const started = await api.post("/api/onboarding/email/start").send({ email }).expect(200);
  expect(started.body.devCode).toMatch(/^\d{6}$/);
  await api.post("/api/onboarding/email/verify").send({ email, code: started.body.devCode }).expect(200);
  await api.post("/api/onboarding/card").send({ cardContent: buildCardQrContent(options.cardNo) }).expect(200);
  await api.post("/api/onboarding/payment-password").send({ password: "123456", confirm: "123456" }).expect(200);
}

beforeAll(() => {
  resetDatabaseForTests();
  migrate();
});

afterAll(() => {
  // 测试库留在 data 目录，便于排查失败用例
});

describe("基础接口", () => {
  it("健康检查可用", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.database).toBe("up");
  });

  it("写接口缺少 X-Requested-With 时返回 CSRF_REJECTED", async () => {
    const response = await request(app).post("/api/auth/logout").send({}).expect(403);
    expect(response.body.error.code).toBe("CSRF_REJECTED");
  });

  it("未登录访问受保护接口返回 401", async () => {
    const response = await request(app).get("/api/me").expect(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("开发登录后可读到自己的资料", async () => {
    const { session } = await login("basic", "基础用户");
    const response = await agentWith(session).get("/api/me").expect(200);
    expect(response.body.onboardStep).toBe("name");
    expect(response.body.onboarded).toBe(false);
    const sessionInfo = await agentWith(session).get("/api/auth/session").expect(200);
    expect(sessionInfo.body.authenticated).toBe(true);
  });
});

describe("新用户引导", () => {
  it("按步骤完成引导后进入已完成状态", async () => {
    const { session } = await login("onboard", "引导用户");
    await completeOnboarding(session, { cardNo: "CARD-GUIDE-0001", studentNo: "20230001" });
    const me = await agentWith(session).get("/api/me").expect(200);
    expect(me.body.onboarded).toBe(true);
    expect(me.body.onboardStep).toBe("done");
    expect(me.body.paymentPasswordSet).toBe(true);
    expect(me.body.studentNo).toBe("20230001");
    expect(me.body.cardNoMasked).toContain("0001");
    expect(me.body.email).toBe("20230001@example.com");
  });

  it("学号不可重复绑定", async () => {
    const { session } = await login("dup-student", "重复学号");
    const api = agentWith(session);
    await api.post("/api/onboarding/name").send({ surname: "李", givenName: "四" }).expect(200);
    const response = await api.post("/api/onboarding/student-no").send({ studentNo: "20230001" });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });
});

describe("商家与订单", () => {
  let merchantSession: request.SuperAgentTest;
  let merchantId = "";
  let payerSession: request.SuperAgentTest;
  let payerId = "";
  let orderId = "";

  beforeAll(async () => {
    const merchant = await login("merchant", "商家同学");
    merchantSession = merchant.session;
    merchantId = merchant.id;
    await completeOnboarding(merchantSession, { cardNo: "CARD-MERCHANT-01", studentNo: "20230002" });
    const qr = await generateQrPngBuffer("https://qr.alipay.com/gzspay-merchant");
    const registered = await agentWith(merchantSession)
      .post("/api/merchant/register")
      .field("name", "桂中便利店")
      .field("noteRequirement", "请填写姓名和学号后四位")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", qr, "alipay.png")
      .expect(201);
    expect(registered.body.merchant.name).toBe("桂中便利店");

    const payer = await login("payer", "付款同学");
    payerSession = payer.session;
    payerId = payer.id;
    await completeOnboarding(payerSession, { cardNo: "CARD-PAYER-0001", studentNo: "20230003" });
  });

  it("商家可以查询自己的商家信息", async () => {
    const response = await agentWith(merchantSession).get("/api/merchant").expect(200);
    expect(response.body.registered).toBe(true);
    expect(response.body.merchant.channels[0]).toMatchObject({ channel: "alipay", enabled: true, hasQr: true });
  });

  it("付款人可以扫码后看到商家主页", async () => {
    const response = await agentWith(payerSession).get(`/api/merchant/public/${merchantId}`).expect(200);
    expect(response.body.merchantName).toBe("桂中便利店");
    expect(response.body.channels).toContain("alipay");
  });

  it("下单需要正确的支付密码", async () => {
    const response = await agentWith(payerSession)
      .post("/api/orders")
      .send({
        merchantUserId: merchantId,
        amountCents: 1200,
        reservedNote: "张三 0001",
        paymentPassword: "000000",
        idempotencyKey: "order-bad-password",
      })
      .expect(400);
    expect(response.body.error.code).toBe("PAYMENT_PASSWORD_WRONG");
    expect(response.body.error.details.remaining).toBeGreaterThan(0);
  });

  it("下单成功且幂等键复用返回同一订单", async () => {
    const payload = {
      merchantUserId: merchantId,
      amountCents: 1200,
      reservedNote: "张三 0001",
      paymentPassword: "123456",
      idempotencyKey: "order-idem-0001",
    };
    const created = await agentWith(payerSession).post("/api/orders").send(payload).expect(201);
    orderId = created.body.order.id;
    expect(created.body.order.status).toBe("pending_payment");
    expect(created.body.order.amountCents).toBe(1200);
    expect(created.body.order.noteRequirement).toBe("请填写姓名和学号后四位");
    const again = await agentWith(payerSession).post("/api/orders").send(payload).expect(200);
    expect(again.body.order.id).toBe(orderId);
  });

  it("同一订单同时出现在双方列表里", async () => {
    const pay = await agentWith(payerSession).get("/api/orders?scope=pay&status=pending").expect(200);
    expect(pay.body.items.map((item: { id: string }) => item.id)).toContain(orderId);
    const receive = await agentWith(merchantSession).get("/api/orders?scope=receive&status=pending").expect(200);
    expect(receive.body.items.map((item: { id: string }) => item.id)).toContain(orderId);
  });

  it("付款、确认收款的状态流转", async () => {
    const paid = await agentWith(payerSession)
      .post(`/api/orders/${orderId}/pay`)
      .send({ channel: "alipay", actualNote: "张三 0001" })
      .expect(200);
    expect(paid.body.status).toBe("paid");
    const detail = await agentWith(merchantSession).get(`/api/orders/${orderId}`).expect(200);
    expect(detail.body.role).toBe("merchant");
    expect(detail.body.events.length).toBeGreaterThanOrEqual(2);
    const completed = await agentWith(merchantSession).post(`/api/orders/${orderId}/confirm`).send({}).expect(200);
    expect(completed.body.status).toBe("completed");
  });

  it("已结束的订单不能再放弃支付", async () => {
    const response = await agentWith(payerSession)
      .post(`/api/orders/${orderId}/cancel`)
      .send({ reason: "其他" })
      .expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
  it("付款人的交易统计包含这笔支出", async () => {
    const summary = await agentWith(payerSession).get("/api/stats/summary").expect(200);
    expect(summary.body.expenseCents).toBe(1200);
    const timeseries = await agentWith(payerSession).get("/api/stats/timeseries?granularity=day").expect(200);
    expect(timeseries.body.buckets.length).toBeGreaterThan(0);
  });

  it("订单二维码与保存收款码接口返回 PNG", async () => {
    const qr = await agentWith(payerSession).get(`/api/orders/${orderId}/qr?channel=alipay`).expect(200);
    expect(qr.headers["content-type"]).toContain("image/png");
  });

  it("商家可以维护商品列表", async () => {
    const created = await agentWith(merchantSession)
      .post("/api/merchant/products")
      .send({ name: "矿泉水", priceCents: 200 })
      .expect(201);
    const productId = created.body.product.id as string;
    const updated = await agentWith(merchantSession)
      .patch(`/api/merchant/products/${productId}`)
      .send({ active: false })
      .expect(200);
    expect(updated.body.product.active).toBe(false);
    const list = await agentWith(merchantSession).get("/api/merchant/products").expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toContain(productId);
  });

  it("动态码收款请求可以被客户接受并生成订单", async () => {
    const issued = await agentWith(payerSession).post("/api/dynamic-code").send({}).expect(201);
    const token = issued.body.token as string;
    const resolved = await agentWith(merchantSession).get(`/api/dynamic-code/${token}/resolve`).expect(200);
    expect(resolved.body.user.id).toBe(payerId);
    const requested = await agentWith(merchantSession)
      .post("/api/dynamic-code/request")
      .send({ token, amountCents: 300, reservedNote: "动态码订单" })
      .expect(201);
    const requestId = requested.body.id as string;
    const accepted = await agentWith(payerSession)
      .post(`/api/dynamic-code/requests/${requestId}/accept`)
      .send({ paymentPassword: "123456" })
      .expect(200);
    expect(accepted.body.order.status).toBe("pending_payment");
    expect(accepted.body.order.amountCents).toBe(300);
  });
});

describe("管理后台", () => {
  let adminCookie: string;

  beforeAll(() => {
    const user = queryOne<{ id: string }>("SELECT id FROM users ORDER BY created_at ASC LIMIT 1");
    const userId = user?.id;
    if (!userId) throw new Error("缺少测试用户");
    execute(
      "INSERT INTO admins (user_id, role, created_by, created_at) VALUES (?, 'super', NULL, ?)",
      userId,
      new Date().toISOString(),
    );
    const token = randomToken(32);
    execute(
      "INSERT INTO sessions (id, user_id, kind, ip, user_agent, created_at, expires_at, last_seen_at) VALUES (?, ?, 'admin', '127.0.0.1', 'vitest', ?, ?, ?)",
      hashToken(token),
      userId,
      new Date().toISOString(),
      new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      new Date().toISOString(),
    );
    adminCookie = `${config.adminCookieName}=${token}`;
  });

  function adminRequest() {
    return {
      get: (url: string) => request(app).get(url).set(CSRF).set("Cookie", adminCookie),
      post: (url: string) => request(app).post(url).set(CSRF).set("Cookie", adminCookie),
      put: (url: string) => request(app).put(url).set(CSRF).set("Cookie", adminCookie),
    };
  }

  it("管理员会话可读取", async () => {
    const response = await adminRequest().get("/api/admin/auth/session").expect(200);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.admin.role).toBe("super");
  });

  it("总览与月度数据", async () => {
    const overview = await adminRequest().get("/api/admin/overview").expect(200);
    expect(overview.body.userCount).toBeGreaterThanOrEqual(3);
    expect(overview.body.totalAmountCents).toBeGreaterThanOrEqual(1200);
    const monthly = await adminRequest().get("/api/admin/monthly").expect(200);
    expect(monthly.body.months.length).toBe(12);
  });

  it("交易明细与导出", async () => {
    const orders = await adminRequest().get("/api/admin/orders").expect(200);
    expect(orders.body.items.length).toBeGreaterThanOrEqual(1);
    const csv = await adminRequest().get("/api/admin/orders/export").expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("订单号");
  });

  it("公告可以被管理员创建并在用户端生效", async () => {
    await adminRequest()
      .post("/api/admin/announcements")
      .send({ title: "开学通知", content: "本周开始使用 gzspay", pinned: true })
      .expect(200);
    const active = await request(app).get("/api/announcements/active").expect(200);
    expect(active.body.items[0].title).toBe("开学通知");
  });

  it("系统配置可读可写", async () => {
    const current = await adminRequest().get("/api/admin/config").expect(200);
    const payload = {
      mail: current.body.mail,
      security: { ...current.body.security, singlePaymentLimitCents: 600000 },
    };
    const saved = await adminRequest().put("/api/admin/config").send(payload).expect(200);
    expect(saved.body.security.singlePaymentLimitCents).toBe(600000);
  });

  it("普通用户访问管理接口被拒绝", async () => {
    const { session } = await login("plain-user", "普通用户");
    const response = await agentWith(session).get("/api/admin/overview").expect(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});
