import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { execute, migrate, queryOne, resetDatabaseForTests } from "../src/db/index.js";
import { buildCardQrContent, hashToken, randomToken } from "../src/lib/crypto.js";
import { generateQrPngBuffer } from "../src/lib/qr.js";
import { resetRateLimits } from "../src/lib/rate-limit.js";
import { loginOrRegister } from "../src/services/users.js";

const CSRF = { "X-Requested-With": "gzspay" };

interface Agent {
  get(url: string): request.Test;
  post(url: string): request.Test;
  patch(url: string): request.Test;
  put(url: string): request.Test;
  delete(url: string): request.Test;
}

/** 测试会话：所有请求都带上 CSRF 头与登录 Cookie，由 Cookie 决定身份 */
interface TestSession extends Agent {}

function cookieSession(cookie: string): TestSession {
  const attach = (test: request.Test) => test.set(CSRF).set("Cookie", cookie);
  return {
    get: (url) => attach(request(app).get(url)),
    post: (url) => attach(request(app).post(url)),
    patch: (url) => attach(request(app).patch(url)),
    put: (url) => attach(request(app).put(url)),
    delete: (url) => attach(request(app).delete(url)),
  };
}

function agentWith(session: TestSession): Agent {
  return session;
}

/** 直接建立校园墙账号与会话（开发登录已移除，测试不再依赖专门的后门接口） */
async function login(seed: string, username: string): Promise<{ session: TestSession; id: string }> {
  const { user } = loginOrRegister({ sub: `test-${seed}`, qq: "13800000000", username }, "127.0.0.1");
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
  return { session: cookieSession(`${config.sessionCookieName}=${token}`), id: user.id };
}

async function completeOnboarding(
  session: TestSession,
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

/** 测试环境视为「已完成初始化」：写入初始化标记与站点信息 */
function initializeSystem(): void {
  const now = new Date().toISOString();
  const rows: [string, string][] = [
    ["system.initialized", "1"],
    ["system.siteName", "桂中校园支付"],
    ["campux.baseUrl", "https://campux.test"],
    ["campux.clientId", "test-client"],
  ];
  for (const [key, value] of rows) {
    execute(
      "INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)",
      key,
      value,
      now,
    );
  }
}

beforeAll(() => {
  resetDatabaseForTests();
  migrate();
  initializeSystem();
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

  it("登录后可读到自己的资料", async () => {
    const { session } = await login("basic", "基础用户");
    const response = await agentWith(session).get("/api/me").expect(200);
    expect(response.body.onboardStep).toBe("name");
    expect(response.body.onboarded).toBe(false);
    // 头像直接使用 QQ 官方头像地址（登录账号的 QQ 号来自测试种子 13800000000）
    expect(String(response.body.avatarUrl)).toContain("qlogo.cn");
    expect(String(response.body.avatarUrl)).toContain("13800000000");
    const sessionInfo = await agentWith(session).get("/api/auth/session").expect(200);
    expect(sessionInfo.body.authenticated).toBe(true);
  });

  it("开发登录接口已移除", async () => {
    const response = await request(app).post("/api/auth/dev-login").set(CSRF).send({});
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("初始化状态接口返回系统信息", async () => {
    const response = await request(app).get("/api/setup/status").expect(200);
    expect(response.body.initialized).toBe(true);
    expect(response.body.system.siteName).toBe("桂中校园支付");
    expect(typeof response.body.adminCount).toBe("number");
    expect(response.body.currentUser).toBeNull();
  });

  it("已初始化后不能再提交初始化配置", async () => {
    const response = await request(app)
      .post("/api/setup/config")
      .set(CSRF)
      .send({ system: { siteName: "另一个站点" } })
      .expect(409);
    expect(response.body.error.code).toBe("ALREADY_INITIALIZED");
  });

  it("完成初始化需要先登录", async () => {
    const response = await request(app).post("/api/setup/finish").set(CSRF).send({}).expect(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("管理后台登录跳转到主站登录", async () => {
    const response = await request(app).get("/api/admin/auth/login").expect(302);
    expect(response.headers.location).toBe("/api/auth/login?redirect=%2Fadmin");
  });

  it("未登录访问管理后台会话返回 401", async () => {
    const response = await request(app).get("/api/admin/auth/session").expect(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
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
    expect(me.body.cardNo).toBe("CARD-GUIDE-0001");
    expect(me.body.cardNoMasked).toContain("0001");
    expect(me.body.email).toBe("20230001@example.com");
  });

  it("引导接口返回步骤 key 列表并随进度推进", async () => {
    const { session } = await login("steps", "步骤用户");
    const api = agentWith(session);
    const first = await api.get("/api/onboarding").expect(200);
    expect(first.body.steps).toEqual(["name", "studentNo", "email", "card", "password"]);
    expect(first.body.step).toBe("name");

    const afterName = await api.post("/api/onboarding/name").send({ surname: "王", givenName: "五" }).expect(200);
    expect(afterName.body.step).toBe("studentNo");
    expect(afterName.body.steps).toEqual(["name", "studentNo", "email", "card", "password"]);
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
  let merchantSession: TestSession;
  let merchantId = "";
  let payerSession: TestSession;
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
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", qr, "alipay.png")
      .expect(201);
    expect(registered.body.merchant.name).toBe("桂中便利店");
    // 备注要求不在注册时填写，注册后再设置
    expect(registered.body.merchant.noteRequirement).toBe("");
    const patched = await agentWith(merchantSession)
      .patch("/api/merchant")
      .set(CSRF)
      .send({ noteRequirement: "请填写姓名和学号后四位" })
      .expect(200);
    expect(patched.body.merchant.noteRequirement).toBe("请填写姓名和学号后四位");

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

  it("未注册商家的账号不能发起收款", async () => {
    const collect = await agentWith(payerSession)
      .post("/api/orders/merchant-create")
      .set(CSRF)
      .send({
        cardContent: "gzspay:card:CARD-PAYER-0001",
        amountCents: 100,
        paymentPassword: "123456",
        idempotencyKey: "nonmerchant-collect-1",
      })
      .expect(403);
    expect(collect.body.error.code).toBe("FORBIDDEN");
    expect(collect.body.error.message).toContain("先注册商家");

    const request = await agentWith(payerSession)
      .post("/api/dynamic-code/request")
      .set(CSRF)
      .send({ token: "gzspay:dynamic:not-a-real-token", amountCents: 100 })
      .expect(409);
    expect(request.body.error.message).toContain("商家");
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

  it("按学号转账后出现在付款方待付款与收款方待收款列表", async () => {
    const created = await agentWith(payerSession)
      .post("/api/orders/transfer")
      .send({
        studentNo: "20230002",
        amountCents: 880,
        note: "班费",
        paymentPassword: "123456",
        idempotencyKey: "transfer-idem-0001",
      })
      .expect(201);
    const transferId = created.body.order.id as string;
    expect(created.body.order.title).toBe("转账");
    expect(created.body.order.status).toBe("pending_payment");
    expect(created.body.order.amountCents).toBe(880);

    const pay = await agentWith(payerSession).get("/api/orders?scope=pay&status=pending").expect(200);
    expect(pay.body.items.map((item: { id: string }) => item.id)).toContain(transferId);
    const receive = await agentWith(merchantSession).get("/api/orders?scope=receive&status=pending").expect(200);
    expect(receive.body.items.map((item: { id: string }) => item.id)).toContain(transferId);

    // 幂等：同一 key 再提交返回同一订单
    const again = await agentWith(payerSession)
      .post("/api/orders/transfer")
      .send({
        studentNo: "20230002",
        amountCents: 880,
        note: "班费",
        paymentPassword: "123456",
        idempotencyKey: "transfer-idem-0001",
      })
      .expect(200);
    expect(again.body.order.id).toBe(transferId);

    // 不能给自己转账
    const self = await agentWith(payerSession)
      .post("/api/orders/transfer")
      .send({
        studentNo: "20230003",
        amountCents: 100,
        paymentPassword: "123456",
        idempotencyKey: "transfer-self-0001",
      })
      .expect(409);
    expect(self.body.error.message).toContain("自己");

    // 学号不存在
    const missing = await agentWith(payerSession)
      .post("/api/orders/transfer")
      .send({
        studentNo: "99999999",
        amountCents: 100,
        paymentPassword: "123456",
        idempotencyKey: "transfer-missing-01",
      })
      .expect(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
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

  it("「已结算」筛选包含已完成订单且不再出现在待处理里", async () => {
    const settled = await agentWith(payerSession).get("/api/orders?scope=pay&status=settled").expect(200);
    expect(settled.body.items.map((item: { id: string }) => item.id)).toContain(orderId);
    const pending = await agentWith(payerSession).get("/api/orders?scope=pay&status=pending").expect(200);
    expect(pending.body.items.map((item: { id: string }) => item.id)).not.toContain(orderId);
    const receiveSettled = await agentWith(merchantSession).get("/api/orders?scope=receive&status=settled").expect(200);
    expect(receiveSettled.body.items.map((item: { id: string }) => item.id)).toContain(orderId);
  });

  it("已结束的订单不能再放弃支付", async () => {
    const response = await agentWith(payerSession)
      .post(`/api/orders/${orderId}/cancel`)
      .send({ reason: "其他" })
      .expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
  it("付款人的交易统计包含这笔支出与明细字段", async () => {
    const summary = await agentWith(payerSession).get("/api/stats/summary").expect(200);
    expect(summary.body.expenseCents).toBe(1200);
    expect(summary.body.expenseCount).toBeGreaterThanOrEqual(1);
    expect(summary.body.avgOrderCents).toBeGreaterThan(0);
    expect(summary.body.maxOrderCents).toBeGreaterThanOrEqual(1200);
    expect(summary.body.previous).toEqual({
      expenseCents: expect.any(Number),
      incomeCents: expect.any(Number),
      orderCount: expect.any(Number),
    });
    expect(summary.body.channels.map((item: { channel: string }) => item.channel)).toEqual([
      "alipay",
      "wechat",
      "qq",
    ]);
    const alipay = summary.body.channels.find((item: { channel: string }) => item.channel === "alipay");
    expect(alipay.count).toBeGreaterThanOrEqual(1);
    expect(alipay.amountCents).toBeGreaterThanOrEqual(1200);
    expect(summary.body.hours).toHaveLength(24);
    const timeseries = await agentWith(payerSession).get("/api/stats/timeseries?granularity=day").expect(200);
    expect(timeseries.body.buckets.length).toBeGreaterThan(0);
    expect(timeseries.body.buckets[0]).toEqual(
      expect.objectContaining({
        expenseCount: expect.any(Number),
        incomeCount: expect.any(Number),
      }),
    );
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

describe("登录设备", () => {
  it("登录设备列表返回当前会话且可退出其它与当前设备", async () => {
    const first = await login("device-list", "设备用户");
    const second = await login("device-list", "设备用户");

    const list = await agentWith(first.session).get("/api/me/devices").expect(200);
    expect(typeof list.body.onlineWindowMinutes).toBe("number");
    const items = list.body.items as Array<{
      id: string;
      current: boolean;
      online: boolean;
      deviceName: string;
      deviceType: string;
      os: string;
      browser: string;
      ip: string | null;
      createdAt: string;
      lastSeenAt: string;
    }>;
    expect(items.length).toBeGreaterThanOrEqual(2);
    const currentItems = items.filter((item) => item.current);
    expect(currentItems).toHaveLength(1);
    const current = currentItems[0]!;
    expect(current.ip).toBe("127.0.0.1");
    expect(current.online).toBe(true);
    expect(["mobile", "tablet", "desktop", "other"]).toContain(current.deviceType);
    expect(typeof current.deviceName).toBe("string");
    expect(typeof current.os).toBe("string");
    expect(typeof current.browser).toBe("string");
    expect(typeof current.lastSeenAt).toBe("string");

    // 退出全部其它设备：另一会话失效，当前会话仍可用
    const others = await agentWith(first.session)
      .post("/api/me/devices/logout-others")
      .send({})
      .expect(200);
    expect(others.body.revoked).toBeGreaterThanOrEqual(1);
    await agentWith(second.session).get("/api/me").expect(401);
    await agentWith(first.session).get("/api/me").expect(200);

    // 退出当前设备：Cookie 被清掉，会话随即失效
    const self = await agentWith(first.session)
      .post(`/api/me/devices/${current.id}/logout`)
      .send({})
      .expect(200);
    expect(self.body.current).toBe(true);
    await agentWith(first.session).get("/api/me").expect(401);
  });
});

describe("管理后台", () => {
  let adminCookie: string;
  let adminUserId: string;

  beforeAll(() => {
    const user = queryOne<{ id: string }>("SELECT id FROM users ORDER BY created_at ASC LIMIT 1");
    const userId = user?.id;
    if (!userId) throw new Error("缺少测试用户");
    adminUserId = userId;
    execute(
      "INSERT INTO admins (user_id, role, created_by, created_at) VALUES (?, 'super', NULL, ?)",
      userId,
      new Date().toISOString(),
    );
    const token = randomToken(32);
    const now = new Date();
    execute(
      "INSERT INTO sessions (id, user_id, kind, ip, user_agent, created_at, expires_at, last_seen_at) VALUES (?, ?, 'user', '127.0.0.1', 'vitest', ?, ?, ?)",
      hashToken(token),
      userId,
      now.toISOString(),
      new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString(),
      now.toISOString(),
    );
    adminCookie = `${config.sessionCookieName}=${token}`;
  });

  function adminRequest() {
    return {
      get: (url: string) => request(app).get(url).set(CSRF).set("Cookie", adminCookie),
      post: (url: string) => request(app).post(url).set(CSRF).set("Cookie", adminCookie),
      patch: (url: string) => request(app).patch(url).set(CSRF).set("Cookie", adminCookie),
      put: (url: string) => request(app).put(url).set(CSRF).set("Cookie", adminCookie),
      delete: (url: string) => request(app).delete(url).set(CSRF).set("Cookie", adminCookie),
    };
  }

  it("管理员会话可读取", async () => {
    const response = await adminRequest().get("/api/admin/auth/session").expect(200);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.initialized).toBe(true);
    expect(response.body.admin.role).toBe("super");
  });

  it("在线用户列表包含活跃会话并支持强制下线", async () => {
    const target = await login("online-target", "在线目标");

    const list = await adminRequest().get("/api/admin/users/online").expect(200);
    expect(typeof list.body.onlineWindowMinutes).toBe("number");
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    const self = list.body.items.find((row: { id: string }) => row.id === adminUserId);
    expect(self?.sessionCount).toBeGreaterThanOrEqual(1);
    const targetRow = list.body.items.find((row: { id: string }) => row.id === target.id);
    expect(targetRow?.displayName).toBe("在线目标");
    expect(targetRow?.ip).toBe("127.0.0.1");
    expect(typeof targetRow?.lastSeenAt).toBe("string");

    await adminRequest().post(`/api/admin/users/${target.id}/force-logout`).send({}).expect(200);

    const after = await agentWith(target.session).get("/api/me").expect(401);
    expect(after.body.error.code).toBe("UNAUTHENTICATED");
    const listAfter = await adminRequest().get("/api/admin/users/online").expect(200);
    expect(
      listAfter.body.items.some((row: { id: string }) => row.id === target.id),
    ).toBe(false);
  });

  it("登录情况统计返回授权登录成功人数与最近登录用户", async () => {
    const target = await login("login-log-target", "登录目标");

    const payload = await adminRequest().get("/api/admin/users/logins").expect(200);
    expect(typeof payload.body.total).toBe("number");
    expect(payload.body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(payload.body.recent)).toBe(true);
    const row = payload.body.recent.find(
      (item: { id: string }) => item.id === target.id,
    );
    expect(row?.displayName).toBe("登录目标");
    expect(typeof row?.lastLoginAt).toBe("string");
    expect(row?.lastLoginAt.length).toBeGreaterThan(0);
  });

  it("商家管理列表与详情可查看收款方式与商品", async () => {
    const merchant = await login("admin-merchant", "后台商家");
    const merchantUserId = merchant.id;
    await completeOnboarding(merchant.session, {
      cardNo: "CARD-ADMIN-MERCHANT-01",
      studentNo: "20230101",
    });
    const qr = await generateQrPngBuffer("https://qr.alipay.com/gzspay-admin-merchant");
    await agentWith(merchant.session)
      .post("/api/merchant/register")
      .field("name", "后台测试小卖部")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", qr, "alipay.png")
      .expect(201);
    await agentWith(merchant.session)
      .post("/api/merchant/products")
      .send({ name: "矿泉水", priceCents: 200 })
      .expect(201);

    const summary = await adminRequest()
      .get("/api/admin/merchants/summary")
      .expect(200);
    expect(typeof summary.body.total).toBe("number");
    expect(summary.body.total).toBeGreaterThanOrEqual(1);
    expect(typeof summary.body.ready).toBe("number");
    expect(typeof summary.body.suspended).toBe("number");

    const list = await adminRequest()
      .get("/api/admin/merchants")
      .query({ query: "后台测试小卖部" })
      .expect(200);
    const row = list.body.items.find(
      (item: { userId: string }) => item.userId === merchantUserId,
    );
    expect(row?.merchantName).toBe("后台测试小卖部");
    expect(row?.channels).toHaveLength(3);
    expect(
      row?.channels.find((item: { channel: string }) => item.channel === "alipay")
        ?.hasQr,
    ).toBe(true);
    expect(row?.productCount).toBeGreaterThanOrEqual(1);

    const detail = await adminRequest()
      .get(`/api/admin/merchants/${merchantUserId}`)
      .expect(200);
    expect(detail.body.merchant.merchantName).toBe("后台测试小卖部");
    expect(detail.body.products.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(detail.body.recentOrders)).toBe(true);
  });

  it("管理员停用收款方式后商家暂停收款，恢复后可继续下单", async () => {
    const merchant = await login("admin-merchant-pause", "后台暂停商家");
    const merchantUserId = merchant.id;
    await completeOnboarding(merchant.session, {
      cardNo: "CARD-ADMIN-MERCHANT-02",
      studentNo: "20230102",
    });
    const qr = await generateQrPngBuffer("https://qr.alipay.com/gzspay-admin-pause");
    await agentWith(merchant.session)
      .post("/api/merchant/register")
      .field("name", "暂停测试小卖部")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", qr, "alipay.png")
      .expect(201);

    const payer = await login("admin-merchant-payer", "后台付款人");
    await completeOnboarding(payer.session, {
      cardNo: "CARD-ADMIN-PAYER-01",
      studentNo: "20230103",
    });
    const orderPayload = (key: string) => ({
      merchantUserId,
      amountCents: 300,
      reservedNote: "李四 0002",
      paymentPassword: "123456",
      idempotencyKey: key,
    });

    await agentWith(payer.session)
      .post("/api/orders")
      .send(orderPayload("admin-merchant-order-1"))
      .expect(201);

    const disabled = await adminRequest()
      .post(`/api/admin/merchants/${merchantUserId}/channels`)
      .send({ channel: "alipay", enabled: false })
      .expect(200);
    expect(disabled.body.merchant.suspended).toBe(true);
    expect(disabled.body.merchant.enabledChannelCount).toBe(0);

    const blocked = await agentWith(payer.session)
      .post("/api/orders")
      .send(orderPayload("admin-merchant-order-2"))
      .expect(409);
    expect(blocked.body.error.message).toContain("暂停收款");

    const resumed = await adminRequest()
      .post(`/api/admin/merchants/${merchantUserId}/receiving`)
      .send({ enabled: true })
      .expect(200);
    expect(resumed.body.merchant.suspended).toBe(false);
    expect(resumed.body.merchant.enabledChannelCount).toBe(1);

    const created = await agentWith(payer.session)
      .post("/api/orders")
      .send(orderPayload("admin-merchant-order-3"))
      .expect(201);
    expect(created.body.order.status).toBe("pending_payment");
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

  it("公告：发布后用户端出现未读并可标记已读", async () => {
    const { session: reader } = await login("notice-reader", "公告读者");
    const created = await adminRequest()
      .post("/api/admin/announcements")
      .send({
        title: "开学通知",
        content: "## 本周开始使用 gzspay\n\n请及时绑定校园卡。",
        level: "important",
        pinned: true,
      })
      .expect(200);
    const id = created.body.id as string;

    const before = await agentWith(reader).get("/api/announcements").expect(200);
    const item = before.body.items.find((row: { id: string }) => row.id === id);
    expect(item?.title).toBe("开学通知");
    expect(item?.level).toBe("important");
    expect(item?.pinned).toBe(true);
    expect(item?.read).toBe(false);
    expect(typeof item?.publishedAt).toBe("string");
    const unreadBefore = before.body.unreadCount as number;
    expect(unreadBefore).toBeGreaterThanOrEqual(1);

    const read = await agentWith(reader)
      .post(`/api/announcements/${id}/read`)
      .send({})
      .expect(200);
    expect(read.body.ok).toBe(true);
    expect(read.body.unreadCount).toBe(unreadBefore - 1);

    // 幂等：重复标记已读不会再减少未读数
    const repeated = await agentWith(reader)
      .post(`/api/announcements/${id}/read`)
      .send({})
      .expect(200);
    expect(repeated.body.unreadCount).toBe(unreadBefore - 1);

    const after = await agentWith(reader).get("/api/announcements").expect(200);
    expect(after.body.items.find((row: { id: string }) => row.id === id)?.read).toBe(true);

    const adminList = await adminRequest().get("/api/admin/announcements").expect(200);
    const adminItem = adminList.body.items.find((row: { id: string }) => row.id === id);
    expect(adminItem?.readCount).toBe(1);
    expect(adminItem?.totalUsers).toBeGreaterThanOrEqual(1);
  });

  it("公告：修改内容与发布日期会重新推送", async () => {
    const { session: reader } = await login("notice-repush", "公告重推读者");
    const created = await adminRequest()
      .post("/api/admin/announcements")
      .send({
        title: "维护通知",
        content: "今晚维护",
        publishedAt: "2026-10-01T00:00:00.000Z",
      })
      .expect(200);
    const id = created.body.id as string;

    const first = await agentWith(reader).get("/api/announcements").expect(200);
    expect(
      first.body.items.find((row: { id: string }) => row.id === id)?.publishedAt,
    ).toBe("2026-10-01T00:00:00.000Z");
    await agentWith(reader).post(`/api/announcements/${id}/read`).send({}).expect(200);

    const updated = await adminRequest()
      .patch(`/api/admin/announcements/${id}`)
      .send({
        title: "维护通知",
        content: "维护改到明晚",
        publishedAt: "2026-10-02T00:00:00.000Z",
      })
      .expect(200);
    expect(updated.body.republished).toBe(true);

    const second = await agentWith(reader).get("/api/announcements").expect(200);
    const item = second.body.items.find((row: { id: string }) => row.id === id);
    expect(item?.read).toBe(false);
    expect(item?.publishedAt).toBe("2026-10-02T00:00:00.000Z");
    expect(item?.content).toContain("明晚");
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

  it("系统配置可单独保存校园墙 OAuth 参数", async () => {
    const saved = await adminRequest()
      .put("/api/admin/config")
      .send({
        campux: {
          baseUrl: "https://campux.example.com",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          scope: "profile extra",
        },
      })
      .expect(200);
    expect(saved.body.campux.baseUrl).toBe("https://campux.example.com");
    expect(saved.body.campux.clientId).toBe("test-client-id");
    expect(saved.body.campux.clientSecretConfigured).toBe(true);
    expect(saved.body.campux.scope).toBe("profile extra");
    // 只传校园墙一块时，邮件与安全配置保持不变
    expect(typeof saved.body.mail.host).toBe("string");
    expect(saved.body.security.singlePaymentLimitCents).toBe(600000);
  });

  it("关于页返回 Markdown 文档与改动日期", async () => {
    const about = await request(app).get("/api/about").expect(200);
    expect(about.body.privacy).toContain("# gzspay 隐私协议");
    expect(about.body.terms).toContain("## 修订记录");
    expect(about.body.privacyUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(about.body.termsUpdatedAt).toBe(about.body.privacyUpdatedAt);
    expect(about.body.legalEffectiveAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 更新日志必须能从 CHANGELOG.md 解析出来，否则「关于」页就是空的
    expect(Array.isArray(about.body.changelog)).toBe(true);
    expect(about.body.changelog.length).toBeGreaterThan(0);
    const latest = about.body.changelog[0];
    expect(typeof latest.version).toBe("string");
    expect(Array.isArray(latest.items)).toBe(true);
    expect(latest.items.length).toBeGreaterThan(0);
    for (const item of latest.items) {
      expect(typeof item).toBe("string");
      expect(item.trim().length).toBeGreaterThan(0);
    }
    // 更新日志按「新增 / 变更 / 修复」分组，分组内条目应与展平后的 items 一致
    expect(Array.isArray(latest.groups)).toBe(true);
    expect(latest.groups.length).toBeGreaterThan(0);
    for (const group of latest.groups) {
      expect(typeof group.title).toBe("string");
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.items.length).toBeGreaterThan(0);
    }
    expect(latest.groups.flatMap((group) => group.items)).toEqual(latest.items);
  });

  it("普通用户访问管理接口被拒绝", async () => {
    const { session } = await login("plain-user", "普通用户");
    const response = await agentWith(session).get("/api/admin/overview").expect(401);
    expect(response.body.error.code).toBe("NOT_ADMIN");
  });
});

describe("安全防护", () => {
  it("接口响应带安全头，且敏感接口禁止缓存", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("same-origin");
    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.headers["permissions-policy"]).toContain("camera=(self)");
    expect(response.headers["cache-control"]).toBe("no-store");
    // 测试环境不是生产：不下发 HSTS 与 CSP（否则会影响 Vite 的 HMR 与内联脚本）
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).toBeUndefined();
  });

  it("登录入口超过阈值后返回 429 并带 Retry-After", async () => {
    resetRateLimits();
    const limit = config.security.rateLimitLoginPerMinute;
    expect(limit).toBeGreaterThan(0);
    for (let index = 0; index < limit; index += 1) {
      const response = await request(app).get("/api/auth/login");
      expect(response.status).not.toBe(429);
    }
    const blocked = await request(app).get("/api/auth/login");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    resetRateLimits();
  });

  it("收款码上传只接受 PNG / JPEG 图片", async () => {
    const { session } = await login("qr-format", "收款码格式");
    const response = await agentWith(session)
      .post("/api/merchant/register")
      .field("name", "格式测试")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", Buffer.from("<svg></svg>"), {
        filename: "fake.png",
        contentType: "image/png",
      });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain("PNG 或 JPG");
  });
});
describe("错误提示", () => {
  it("参数校验失败返回中文提示，不暴露字段名与英文校验文案", async () => {
    const { session } = await login("error-tips", "提示用户");
    const response = await agentWith(session).post("/api/orders").send({}).expect(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    const message = String(response.body.error.message);
    expect(message).toMatch(/[\u4e00-\u9fa5]/);
    expect(message).not.toMatch(/Required|Expected|received|merchantUserId|paymentPassword/);
  });

  it("请求体不是合法 JSON 时给出可读提示", async () => {
    const { session } = await login("error-json", "提示解析");
    const response = await agentWith(session)
      .post("/api/orders")
      .set("Content-Type", "application/json")
      .send('{"merchantUserId":');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
    expect(String(response.body.error.message)).toContain("请求内容格式不正确");
  });
});

describe("支付密码·校园墙再验证", () => {
  it("会话里能读到校园墙是否已配置，未验证时不能领取重置凭证", async () => {
    const { session } = await login("pwd-campux-claim", "再验证用户");
    const sessionResponse = await agentWith(session).get("/api/auth/session").expect(200);
    expect(typeof sessionResponse.body.campuxConfigured).toBe("boolean");

    const anonymous = await request(app).get("/api/me/payment-password/reset/campux/start");
    expect(anonymous.status).toBe(401);

    const claim = await agentWith(session).post("/api/me/payment-password/reset/campux/claim");
    expect(claim.status).toBe(400);
    expect(claim.body.error.code).toBe("VALIDATION_FAILED");
    expect(String(claim.body.error.message)).toContain("校园墙验证");
  });

  it("校园墙验证通过后可领取一次性凭证并修改支付密码", async () => {
    const { session, id } = await login("pwd-campux-flow", "再验证流程");
    await completeOnboarding(session, { cardNo: "2026999001", studentNo: "26999001" });

    const now = new Date();
    execute(
      "INSERT INTO password_verifications (id, user_id, method, expires_at, used_at, created_at) VALUES (?, ?, 'campux', ?, NULL, ?)",
      randomToken(16),
      id,
      new Date(now.getTime() + 5 * 60_000).toISOString(),
      now.toISOString(),
    );

    const claimed = await agentWith(session)
      .post("/api/me/payment-password/reset/campux/claim")
      .expect(200);
    expect(claimed.body.resetToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const resetToken = String(claimed.body.resetToken);

    // 验证记录是一次性的
    const again = await agentWith(session).post("/api/me/payment-password/reset/campux/claim");
    expect(again.status).toBe(400);

    await agentWith(session)
      .post("/api/me/payment-password/reset/confirm")
      .send({ resetToken, password: "654321", confirm: "654321" })
      .expect(200);

    const verified = await agentWith(session)
      .post("/api/me/payment-password/verify")
      .send({ password: "654321" })
      .expect(200);
    expect(verified.body.ok).toBe(true);
  });

  it("未配置校园墙时发起验证给出明确错误或跳转授权页", async () => {
    const { session } = await login("pwd-campux-start", "再验证发起");
    const response = await agentWith(session)
      .get("/api/me/payment-password/reset/campux/start")
      .redirects(0);
    expect([302, 503]).toContain(response.status);
    if (response.status === 503) {
      expect(response.body?.error?.code).toBe("CAMPUX_NOT_CONFIGURED");
    } else {
      expect(String(response.headers.location)).toContain("/oauth/authorize");
    }
  });
});
