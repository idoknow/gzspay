import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { execute, migrate, queryOne, resetDatabaseForTests } from "../src/db/index.js";
import { buildCardQrContent, hashToken, randomToken } from "../src/lib/crypto.js";
import { generateQrPngBuffer } from "../src/lib/qr.js";
import { applyRuntimeConfig } from "../src/lib/runtime-config.js";
import { cleanupUploadRetention } from "../src/lib/retention.js";
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
  const { user } = loginOrRegister({ sub: `test-bill-${seed}`, qq: "13800000000", username }, "127.0.0.1");
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

/** 拼一份支付宝记账本导出的 CSV（说明行 + 表头 + 数据） */
function alipayCsv(rows: { time: string; amount: string; note: string }[]): Buffer {
  const header =
    "记录时间,分类,收支类型,金额,备注,账户,来源,标签,";
  const lines = [
    "支付宝记账本导出",
    "导出说明：仅供本人核对使用",
    "",
    header,
    ...rows.map((row) => `${row.time},生意,收入,${row.amount},${row.note},,账单同步,,`),
  ];
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

describe("商家收款自动对账", () => {
  let merchantApi: Agent;
  let merchantId: string;
  let payerApi: Agent;
  let outsiderApi: Agent;

  async function createPendingOrder(amountCents: number, note: string): Promise<string> {
    const created = await merchantApi
      .post("/api/merchant/collections")
      .send({ amountCents, reservedNote: note })
      .expect(201);
    const paid = await payerApi
      .post(`/api/collections/id/${created.body.collection.id}/pay`)
      .send({ paymentPassword: "123456" })
      .expect(201);
    return paid.body.order.id as string;
  }

  beforeAll(async () => {
    resetDatabaseForTests();
    migrate();
    initializeSystem();

    const merchant = await login("merchant", "对账商家");
    merchantApi = merchant.api;
    merchantId = merchant.id;
    await completeOnboarding(merchantApi, "BLMM0001", "20239201");
    const qr = await generateQrPngBuffer("https://qr.alipay.com/gzspay-bill-merchant");
    await merchantApi
      .post("/api/merchant/register")
      .field("name", "对账小卖部")
      .field("channels", JSON.stringify(["alipay"]))
      .attach("qr_alipay", qr, "alipay.png")
      .expect(201);

    const payer = await login("payer", "对账同学");
    payerApi = payer.api;
    await completeOnboarding(payerApi, "BLPP0001", "20239202");

    const outsider = await login("outsider", "路过同学");
    outsiderApi = outsider.api;
    await completeOnboarding(outsiderApi, "BLOO0001", "20239203");
  });

  afterAll(() => {
    // 测试库留在 data 目录便于排查
  });

  it("上传支付宝账单后，金额与备注都匹配的订单会自动确认收款", async () => {
    const orderId = await createPendingOrder(1200, "对账测试奶茶");

    const uploaded = await merchantApi
      .post("/api/merchant/bills")
      .attach(
        "file",
        alipayCsv([{ time: "2026-11-03 12:00:00", amount: "12.00", note: "对账测试奶茶" }]),
        "cashbook.csv",
      )
      .expect(201);

    expect(uploaded.body.provider).toBe("alipay");
    expect(uploaded.body.transactionCount).toBe(1);
    expect(uploaded.body.matchedCount).toBe(1);
    expect(uploaded.body.transactions).toHaveLength(0);

    const detail = await payerApi.get(`/api/orders/${orderId}`).expect(200);
    expect(detail.body.status).toBe("completed");
    expect(detail.body.payChannel).toBe("alipay");

    // 时间线事件只写中文，不把账单编号之类的十六进制内容带进去
    const autoEvent = (detail.body.events as { type: string; detail: string | null }[]).find(
      (event) => event.type === "auto_confirmed",
    );
    expect(autoEvent?.detail).toBe("账单自动对账确认收款（支付宝）");

    const bills = await merchantApi.get("/api/merchant/bills").expect(200);
    expect(bills.body.items.length).toBeGreaterThanOrEqual(1);
    expect(bills.body.items[0].id).toBe(uploaded.body.id);
  });

  it("金额或备注对不上的流水只展示在未匹配列表里", async () => {
    const uploaded = await merchantApi
      .post("/api/merchant/bills")
      .attach(
        "file",
        alipayCsv([{ time: "2026-11-02 09:00:00", amount: "33.33", note: "这单没在系统里" }]),
        "unmatched.csv",
      )
      .expect(201);

    expect(uploaded.body.transactionCount).toBe(1);
    expect(uploaded.body.matchedCount).toBe(0);

    const detail = await merchantApi.get(`/api/merchant/bills/${uploaded.body.id}`).expect(200);
    expect(detail.body.transactions).toHaveLength(1);
    expect(detail.body.transactions[0].amountCents).toBe(3333);
    expect(detail.body.transactions[0].status).toBe("unmatched");
    expect(detail.body.transactions[0].payerNote).toContain("这单没在系统里");
  });

  it("非商家不能上传账单，非上传者不能查看别人的账单", async () => {
    const response = await payerApi
      .post("/api/merchant/bills")
      .attach("file", alipayCsv([{ time: "2026-11-01 08:00:00", amount: "1.00", note: "x" }]), "x.csv")
      .expect(403);
    expect(response.body.error.message).toContain("商家");

    const outsiderList = await outsiderApi.get("/api/merchant/bills").expect(403);
    expect(outsiderList.status).toBe(403);
  });

  it("无法识别的文件会被拒绝", async () => {
    const response = await merchantApi
      .post("/api/merchant/bills")
      .attach("file", Buffer.from("这不是账单文件", "utf8"), "note.txt")
      .expect(400);
    expect(response.body.error.message).toContain("请上传");
  });

  it("中文文件名按 UTF-8 正确保存，不会变成乱码", async () => {
    const uploaded = await merchantApi
      .post("/api/merchant/bills")
      .attach(
        "file",
        alipayCsv([{ time: "2026-11-03 13:00:00", amount: "0.01", note: "中文文件名测试" }]),
        "支付宝账单（中文）.csv",
      )
      .expect(201);

    expect(uploaded.body.filename).toBe("支付宝账单（中文）.csv");
  });

  it("超出保留期的账单与付款截图会被自动清理", async () => {
    const oldImportId = "bill-old-test";
    const oldAt = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
    execute(
      "INSERT INTO bill_imports (id, merchant_id, provider, filename, stored_name, size_bytes, period_start, period_end, transaction_count, matched_count, created_at) VALUES (?, ?, 'alipay', 'old.csv', ?, 10, NULL, NULL, 1, 0, ?)",
      oldImportId,
      merchantId,
      `${oldImportId}.csv`,
      oldAt,
    );

    const orderId = await createPendingOrder(500, "截图保留测试");
    const proof = await generateQrPngBuffer("https://example.com/gzspay-bill-proof");
    await payerApi
      .post(`/api/orders/${orderId}/payment-proof`)
      .attach("file", proof, "proof.png")
      .expect(200);
    execute(
      "UPDATE orders SET created_at = ? WHERE id = ?",
      new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
      orderId,
    );

    const removed = cleanupUploadRetention();
    expect(removed.bills).toBeGreaterThanOrEqual(1);
    expect(removed.paymentProofs).toBeGreaterThanOrEqual(1);

    const proofRow = queryOne<{ payment_proof: string | null }>(
      "SELECT payment_proof FROM orders WHERE id = ?",
      orderId,
    );
    expect(proofRow?.payment_proof).toBeNull();
  });
});
