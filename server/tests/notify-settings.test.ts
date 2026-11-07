import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { config } from "../src/config.js";
import { execute, migrate, queryAll, resetDatabaseForTests } from "../src/db/index.js";
import { buildCardQrContent, hashToken, randomToken } from "../src/lib/crypto.js";
import { applyRuntimeConfig } from "../src/lib/runtime-config.js";
import { findUserById, loginOrRegister, notifyLogin } from "../src/services/users.js";

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

/** 直接建账号并写入会话（与 api.test.ts 一致：登录一律走校园墙，测试不再依赖开发登录） */
async function login(seed: string, username: string): Promise<{ api: Agent; id: string }> {
  const { user } = loginOrRegister({ sub: `test-notify-${seed}`, qq: "13800000000", username }, "127.0.0.1");
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
  await api
    .post("/api/onboarding/payment-password")
    .send({ password: "123456", confirm: "123456" })
    .expect(200);
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

interface MailRow {
  id: string;
  subject: string;
  body: string;
}

/** 等邮件写进 mail_outbox（发信在后台异步进行），返回最新一条；afterId 用于判断「没有新邮件」 */
async function waitForMail(kind: string, toEmail: string, afterId?: string): Promise<MailRow | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = queryAll<MailRow>(
      `SELECT id, subject, body FROM mail_outbox
        WHERE kind = ? AND to_email = ?
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      kind,
      toEmail,
    );
    const row = rows[0] ?? null;
    if (row && row.id !== afterId) return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

describe("邮件通知：个人信息修改 / 密码修改 / 登录", () => {
  let api: Agent;
  let userId: string;

  const email = "20239201@qq.com";
  /** 最近一封 profile 邮件的 id，用来判断「本次没有新邮件」 */
  let profileMailId: string | null = null;

  beforeAll(async () => {
    resetDatabaseForTests();
    migrate();
    initializeSystem();
    const session = await login("main", "通知测试用户");
    api = session.api;
    userId = session.id;
    await completeOnboarding(api, "NTFY0001", "20239201");
  });

  it("GET /api/me 回显八个通知开关，新增三项默认开启", async () => {
    const me = await api.get("/api/me").expect(200);
    expect(me.body.notificationSettings).toMatchObject({
      newOrder: true,
      paid: true,
      settled: true,
      ticket: true,
      announcement: true,
      profile: true,
      password: true,
      login: true,
    });
  });

  it("个人信息修改成功后发 profile 邮件，字段没变不发", async () => {
    await api
      .patch("/api/me/profile")
      .send({ surname: "李", givenName: "四", paymentPassword: "123456" })
      .expect(200);
    const first = await waitForMail("profile", email);
    expect(first).toBeTruthy();
    expect(first?.subject).toContain("个人信息已修改");
    expect(first?.body).toContain("姓名");
    expect(first?.body).toContain("如果不是你本人操作");
    profileMailId = first?.id ?? null;

    // 再次提交相同内容：值没有变化，不应重复发信
    await api
      .patch("/api/me/profile")
      .send({ surname: "李", givenName: "四", paymentPassword: "123456" })
      .expect(200);
    expect(await waitForMail("profile", email, profileMailId ?? undefined)).toBeNull();

    // 修改学号会单独发一封，正文里写明变更的是「学号」
    await api
      .patch("/api/me/profile")
      .send({ studentNo: "20239299", paymentPassword: "123456" })
      .expect(200);
    const second = await waitForMail("profile", email, profileMailId ?? undefined);
    expect(second).toBeTruthy();
    expect(second?.body).toContain("学号");
    profileMailId = second?.id ?? profileMailId;
  });

  it("关闭个人信息修改通知后不再发信", async () => {
    const off = await api.patch("/api/me/settings").send({ profile: false }).expect(200);
    expect(off.body.notificationSettings.profile).toBe(false);
    // 未传的字段保留原值
    expect(off.body.notificationSettings.login).toBe(true);

    await api
      .patch("/api/me/profile")
      .send({ surname: "王", paymentPassword: "123456" })
      .expect(200);
    expect(await waitForMail("profile", email, profileMailId ?? undefined)).toBeNull();

    await api.patch("/api/me/settings").send({ profile: true }).expect(200);
  });

  /** 走一遍「邮箱验证码 → 重置支付密码」流程（重置成与原来相同的密码，后续用例继续用 123456） */
  async function resetPaymentPassword(): Promise<void> {
    // 清掉上一轮的验证码记录，绕过「同用途 60 秒内只能发一次」的限制
    execute("DELETE FROM email_codes WHERE user_id = ? AND purpose = 'password_reset'", userId);
    const started = await api.post("/api/me/payment-password/reset/start").send({}).expect(200);
    expect(started.body.devCode).toMatch(/^\d{6}$/);
    const verified = await api
      .post("/api/me/payment-password/reset/verify")
      .send({ code: started.body.devCode })
      .expect(200);
    await api
      .post("/api/me/payment-password/reset/confirm")
      .send({ resetToken: verified.body.resetToken, password: "123456", confirm: "123456" })
      .expect(200);
  }

  it("支付密码修改成功后发 password 邮件，关闭后不再发信", async () => {
    await resetPaymentPassword();
    const first = await waitForMail("password", email);
    expect(first).toBeTruthy();
    expect(first?.subject).toContain("支付密码已修改");

    const off = await api.patch("/api/me/settings").send({ password: false }).expect(200);
    expect(off.body.notificationSettings.password).toBe(false);

    await resetPaymentPassword();
    expect(await waitForMail("password", email, first?.id)).toBeNull();

    await api.patch("/api/me/settings").send({ password: true }).expect(200);
  });

  it("登录成功后发 login 邮件（含时间、IP 与设备），关闭后不再发信", async () => {
    const user = findUserById(userId);
    expect(user).toBeTruthy();
    if (!user) return;

    // /api/auth/callback 需要真实的校园墙授权，这里直接验证回调里调用的同一个服务函数
    notifyLogin(user, {
      ip: "10.1.2.3",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.43",
    });
    const first = await waitForMail("login", email);
    expect(first).toBeTruthy();
    expect(first?.subject).toContain("登录提醒");
    expect(first?.body).toContain("10.1.2.3");
    expect(first?.body).toContain("iPhone");
    expect(first?.body).toContain("如果不是你本人登录");

    const off = await api.patch("/api/me/settings").send({ login: false }).expect(200);
    expect(off.body.notificationSettings.login).toBe(false);

    notifyLogin(user, { ip: "10.1.2.4", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    expect(await waitForMail("login", email, first?.id)).toBeNull();

    await api.patch("/api/me/settings").send({ login: true }).expect(200);
  });
});
