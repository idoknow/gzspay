import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { execute, migrate, queryAll, resetDatabaseForTests } from "../src/db/index.js";
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

async function login(seed: string, username: string): Promise<{ api: Agent; id: string }> {
  const { user } = loginOrRegister({ sub: `test-ticket-${seed}`, qq: "13800000000", username }, "127.0.0.1");
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

/** 建一个管理后台账号（super / ops / auditor）并返回管理员会话 */
async function loginAdmin(seed: string, role: "super" | "ops" | "auditor"): Promise<Agent> {
  const { api, id } = await login(`admin-${seed}`, `管理${seed}`);
  execute(
    "INSERT INTO admins (user_id, role, created_by, created_at) VALUES (?, ?, NULL, ?)",
    id,
    role,
    new Date().toISOString(),
  );
  return api;
}

function initializeSystem(): void {  const now = new Date().toISOString();
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

describe("交易工单", () => {
  let merchantApi: Agent;
  let payerApi: Agent;
  let outsiderApi: Agent;

  /** 商家建收款单 → 付款人付款得到 pending_payment 订单 */
  async function createOrder(): Promise<string> {
    const created = await merchantApi
      .post("/api/merchant/collections")
      .send({ amountCents: 990, reservedNote: "工单测试" })
      .expect(201);
    const paid = await payerApi
      .post(`/api/collections/id/${created.body.collection.id}/pay`)
      .send({ paymentPassword: "123456" })
      .expect(201);
    return paid.body.order.id as string;
  }

  /** 建单后由付款人上传截图并标记已支付，得到 paid 订单 */
  async function createPaidOrder(): Promise<string> {
    const orderId = await createOrder();
    const proof = await generateQrPngBuffer("https://example.com/gzspay-ticket-proof");
    await payerApi
      .post(`/api/orders/${orderId}/payment-proof`)
      .attach("file", proof, "proof.png")
      .expect(200);
    await payerApi.post(`/api/orders/${orderId}/pay`).send({ channel: "alipay" }).expect(200);
    return orderId;
  }

  beforeAll(async () => {
    resetDatabaseForTests();
    migrate();
    initializeSystem();

    const merchant = await login("merchant", "工单商家");
    merchantApi = merchant.api;
    await completeOnboarding(merchantApi, "TKMM0001", "20239101");
    const qr = await generateQrPngBuffer("https://qr.alipay.com/gzspay-ticket-merchant");
    await merchantApi
      .post("/api/merchant/register")
      .field("name", "工单小卖部")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", qr, "alipay.png")
      .expect(201);

    const payer = await login("payer", "工单同学");
    payerApi = payer.api;
    await completeOnboarding(payerApi, "TKPP0001", "20239102");

    const outsider = await login("outsider", "围观同学");
    outsiderApi = outsider.api;
    await completeOnboarding(outsiderApi, "TKOO0001", "20239103");
  });

  afterAll(() => {
    // 测试库留在 data 目录便于排查
  });

  it("未登录不能查看工单", async () => {
    const response = await request(app).get("/api/tickets");
    expect(response.status).toBe(401);
  });

  it("待付款订单不能发起工单", async () => {
    const orderId = await createOrder();
    const response = await payerApi
      .post("/api/tickets")
      .send({ orderId, category: "amount", description: "金额好像不对，想和商家确认一下" })
      .expect(400);
    expect(response.body.error.message).toContain("已支付或已完成");
  });

  it("已支付订单可以发起工单，对方收到未读消息", async () => {
    const orderId = await createPaidOrder();
    const created = await payerApi
      .post("/api/tickets")
      .send({ orderId, category: "amount", description: "实际支付金额和订单金额不一致，麻烦核对一下" })
      .expect(201);
    expect(created.body.existing).toBe(false);
    expect(created.body.ticket.status).toBe("open");
    expect(created.body.ticket.messages).toHaveLength(1);
    expect(created.body.ticket.messages[0].body).toContain("实际支付金额");

    const merchantList = await merchantApi.get("/api/tickets?status=open").expect(200);
    const mine = merchantList.body.items.find((item: { orderId: string }) => item.orderId === orderId);
    expect(mine).toBeTruthy();
    expect(mine.unreadCount).toBe(1);
    expect(mine.counterparty.displayName).toBeTruthy();

    const unread = await merchantApi.get("/api/tickets/unread-count").expect(200);
    expect(unread.body.count).toBeGreaterThanOrEqual(1);

    // 读掉之后未读清零
    await merchantApi.post(`/api/tickets/${created.body.ticket.id}/read`).expect(200);
    const afterRead = await merchantApi.get(`/api/tickets/${created.body.ticket.id}`).expect(200);
    expect(afterRead.body.unreadCount).toBe(0);
  });

  it("双方可以在同一工单里对话，非参与方看不到", async () => {
    const orderId = await createPaidOrder();
    const created = await payerApi
      .post("/api/tickets")
      .send({ orderId, category: "not_received", description: "付款后一直没拿到东西，想联系商家" })
      .expect(201);
    const ticketId = created.body.ticket.id;
    const messageCount = (created.body.ticket.messageCount as number) ?? 1;

    const replied = await merchantApi
      .post(`/api/tickets/${ticketId}/messages`)
      .send({ body: "同学你好，今天下午给你送过去，请稍等" })
      .expect(201);
    expect(replied.body.messageCount).toBe(messageCount + 1);
    expect(replied.body.messages.at(-1).body).toContain("下午给你送过去");

    const payerView = await payerApi.get(`/api/tickets/${ticketId}`).expect(200);
    expect(payerView.body.messages).toHaveLength(messageCount + 1);
    expect(payerView.body.messages.at(-1).senderRole).toBe("merchant");

    const outsider = await outsiderApi.get(`/api/tickets/${ticketId}`);
    expect(outsider.status).toBe(404);
    const outsiderList = await outsiderApi.get("/api/tickets").expect(200);
    expect(outsiderList.body.items).toHaveLength(0);

    const repeated = await payerApi
      .post("/api/tickets")
      .send({ orderId, category: "refund", description: "再咨询一下退款进度" })
      .expect(201);
    expect(repeated.body.existing).toBe(true);
    expect(repeated.body.ticket.id).toBe(ticketId);
  });

  it("任一方关闭工单后不能再发消息，可以重新发起", async () => {
    const orderId = await createPaidOrder();
    const created = await payerApi
      .post("/api/tickets")
      .send({ orderId, category: "other", description: "测试关闭工单的流程" })
      .expect(201);
    const ticketId = created.body.ticket.id;

    const closed = await merchantApi.post(`/api/tickets/${ticketId}/close`).expect(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.closedReason).toBe("user");

    const rejected = await payerApi
      .post(`/api/tickets/${ticketId}/messages`)
      .send({ body: "还能说话吗" })
      .expect(400);
    expect(rejected.body.error.message).toContain("工单已关闭");

    const reopened = await payerApi
      .post("/api/tickets")
      .send({ orderId, category: "other", description: "关掉之后还有问题，再开一个" })
      .expect(201);
    expect(reopened.body.existing).toBe(false);
    expect(reopened.body.ticket.id).not.toBe(ticketId);
  });

  it("普通用户不能访问管理端工单列表", async () => {
    const response = await payerApi.get("/api/admin/tickets");
    // 管理后台使用独立的管理员会话，普通用户既可能被判定未登录（401），也可能被判定无权限（403）
    expect([401, 403]).toContain(response.status);
  });

  it("工单详情展示双方资料，平台客服可以介入发言并结束工单", async () => {
    const orderId = await createPaidOrder();
    const created = await payerApi
      .post("/api/tickets")
      .send({ orderId, category: "not_as_described", description: "收到的商品和描述不太一样，希望平台帮忙看一下" })
      .expect(201);
    const ticketId = created.body.ticket.id as string;

    const detail = await payerApi.get(`/api/tickets/${ticketId}`).expect(200);
    expect(detail.body.parties.payer.displayName).toBeTruthy();
    expect(detail.body.parties.payer.studentNo).toBe("20239102");
    expect(detail.body.parties.merchant.studentNo).toBe("20239101");
    expect(detail.body.parties.payer.qq).toBeTruthy();
    expect(detail.body.parties.payer.email).toContain("@qq.com");

    const auditor = await loginAdmin("auditor", "auditor");
    const auditorTry = await auditor
      .post(`/api/admin/tickets/${ticketId}/messages`)
      .send({ body: "审计员不应该能发言" });
    expect(auditorTry.status).toBe(403);

    const ops = await loginAdmin("ops", "ops");
    const replied = await ops
      .post(`/api/admin/tickets/${ticketId}/messages`)
      .send({ body: "平台客服已介入，请双方核对付款截图后在这里回复" })
      .expect(201);
    const adminMessage = replied.body.messages.at(-1);
    expect(adminMessage.senderRole).toBe("admin");
    expect(adminMessage.senderName).toBe("平台客服");
    expect(adminMessage.senderAvatarUrl).toBeNull();
    expect(replied.body.parties.payer.studentNo).toBe("20239102");

    const payerView = await payerApi.get(`/api/tickets/${ticketId}`).expect(200);
    expect(payerView.body.messages.at(-1).senderRole).toBe("admin");
    expect(payerView.body.messages.at(-1).body).toContain("平台客服已介入");

    const closed = await ops
      .post(`/api/admin/tickets/${ticketId}/close`)
      .send({ note: "双方已协商一致，金额差额由商家补退" })
      .expect(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.closedReason).toBe("admin");
    expect(closed.body.resolutionNote).toContain("协商一致");

    const replyAfterClose = await ops
      .post(`/api/admin/tickets/${ticketId}/messages`)
      .send({ body: "已经结束了还能说话吗" });
    expect(replyAfterClose.status).toBe(400);
  });

  it("管理员作为订单一方从交易页发言算本人，只有后台介入才算平台客服", async () => {
    // 让付款人同时拥有 ops 权限，模拟「管理员自己就是订单当事人」
    const dual = await login("dual-admin", "双重身份管理员");
    await completeOnboarding(dual.api, "TKDA0002", "20239998");
    execute(
      "INSERT INTO admins (user_id, role, created_by, created_at) VALUES (?, 'ops', NULL, ?)",
      dual.id,
      new Date().toISOString(),
    );

    const created = await merchantApi
      .post("/api/merchant/collections")
      .send({ amountCents: 1280, reservedNote: "管理员双重身份测试" })
      .expect(201);
    const paid = await dual.api
      .post(`/api/collections/id/${created.body.collection.id}/pay`)
      .send({ paymentPassword: "123456" })
      .expect(201);
    const orderId = paid.body.order.id as string;
    const proof = await generateQrPngBuffer("https://example.com/gzspay-ticket-dual-proof");
    await dual.api.post(`/api/orders/${orderId}/payment-proof`).attach("file", proof, "proof.png").expect(200);
    await dual.api.post(`/api/orders/${orderId}/pay`).send({ channel: "alipay" }).expect(200);

    const ticket = await dual.api
      .post("/api/tickets")
      .send({ orderId, category: "other", description: "想确认一下订单备注和金额" })
      .expect(201);
    const ticketId = ticket.body.ticket.id as string;

    // 从交易页（用户端）发言：即使是管理员账号，也显示成订单本人
    const selfReply = await dual.api
      .post(`/api/tickets/${ticketId}/messages`)
      .send({ body: "我是付款人，这条消息是我本人发的" })
      .expect(201);
    const selfMessage = selfReply.body.messages.at(-1);
    expect(selfMessage.senderRole).toBe("payer");
    expect(selfMessage.senderName).not.toBe("平台客服");

    // 从后台介入发言：同样的账号，要显示成平台客服
    const platformReply = await dual.api
      .post(`/api/admin/tickets/${ticketId}/messages`)
      .send({ body: "平台客服说明：请商家按约定核对这笔金额" })
      .expect(201);
    const platformMessage = platformReply.body.messages.at(-1);
    expect(platformMessage.senderRole).toBe("admin");
    expect(platformMessage.senderName).toBe("平台客服");
    expect(platformMessage.senderAvatarUrl).toBeNull();
    expect(platformMessage.senderId).toBe(dual.id);

    // 对方视角与工单列表预览也按来源区分
    const merchantView = await merchantApi.get(`/api/tickets/${ticketId}`).expect(200);
    const roles = merchantView.body.messages.map((message: { senderRole: string }) => message.senderRole);
    expect(roles).toContain("payer");
    expect(roles.at(-1)).toBe("admin");
    const list = await merchantApi.get("/api/tickets?status=open").expect(200);
    const summary = list.body.items.find((item: { id: string }) => item.id === ticketId);
    // 列表预览不展示平台客服的消息，只看双方自己的最后一条
    expect(summary?.lastMessage.body).toContain("我是付款人");
    expect(summary?.lastMessage.senderRole).toBe("payer");
  });

  it("工单消息与平台公告按通知设置发送邮件", async () => {
    const orderId = await createPaidOrder();
    const created = await payerApi
      .post("/api/tickets")
      .send({ orderId, category: "amount", description: "这笔金额想请商家确认一下，方便的话回复我" })
      .expect(201);
    const ticketId = created.body.ticket.id as string;

    // 建单后商家收到工单邮件
    const firstMail = await waitForMail("ticket", "20239101@qq.com");
    expect(firstMail).toBeTruthy();
    expect(firstMail?.subject).toContain("工单");
    expect(firstMail?.subject).toContain(created.body.ticket.orderNo);

    // 关掉工单通知后不再发信
    const off = await merchantApi.patch("/api/me/settings").send({ ticket: false }).expect(200);
    expect(off.body.notificationSettings.ticket).toBe(false);
    await payerApi
      .post(`/api/tickets/${ticketId}/messages`)
      .send({ body: "补充一下，付款截图已经上传过了" })
      .expect(201);
    const suppressed = await waitForMail("ticket", "20239101@qq.com", firstMail?.id);
    expect(suppressed).toBeNull();
    await merchantApi.patch("/api/me/settings").send({ ticket: true }).expect(200);

    // 公告发布时，开启了公告通知的用户会收到邮件
    const superAdmin = await loginAdmin("notice-super", "super");
    const published = await superAdmin
      .post("/api/admin/announcements")
      .send({ title: "对账服务维护通知", content: "本周日凌晨对账服务会短暂维护，请提前上传账单。", level: "info", pinned: false })
      .expect(200);
    expect(published.body.id).toBeTruthy();
    const announcementMail = await waitForMail("announcement", "20239102@qq.com");
    expect(announcementMail?.subject).toContain("平台公告");

    // 公告开关也能关闭
    const announcementOff = await payerApi
      .patch("/api/me/settings")
      .send({ announcement: false })
      .expect(200);
    expect(announcementOff.body.notificationSettings.announcement).toBe(false);
  });
});

/** 等邮件写进 mail_outbox（发信在后台异步进行），返回最新一条 */
async function waitForMail(
  kind: string,
  toEmail: string,
  afterId?: string,
): Promise<{ id: string; subject: string } | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = queryAll<{ id: string; subject: string }>(
      "SELECT id, subject FROM mail_outbox WHERE kind = ? AND to_email = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      kind,
      toEmail,
    );
    const row = rows[0] ?? null;
    if (row && row.id !== afterId) return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}
