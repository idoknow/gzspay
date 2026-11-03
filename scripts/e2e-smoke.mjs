#!/usr/bin/env node
/**
 * 端到端主链路冒烟脚本（需要先启动后端，并使用全新数据库：初始化状态、引导步骤、学号与卡号都会占用）。
 *
 * 用法（后端环境变量需与下面一致：DATABASE_PATH / SESSION_SECRET）：
 *   DATABASE_PATH=E:\code\gzspay\server\data\smoke.sqlite SESSION_SECRET=gzspay-smoke-session-secret node server/dist/index.js
 *   E2E_BASE_URL=http://127.0.0.1:3100 E2E_DATABASE_PATH=E:\code\gzspay\server\data\smoke.sqlite \
 *     SESSION_SECRET=gzspay-smoke-session-secret node scripts/e2e-smoke.mjs
 *
 * 覆盖：健康检查 → CSRF 拒绝 → 未初始化闸门 → 初始化配置 → 首个登录者成为超管 →
 * 管理后台复用主站会话 → 五步引导 → 商家注册（multipart 收款码）→ 商品 → 扫码解析 →
 * 下单（幂等）→ 我已支付 → 确认收款 → 统计 → 动态码收款请求/确认 → SSE → 关于页。
 *
 * 说明：校园墙 OAuth 无法在脚本里走完，脚本直接向数据库写入账号与会话（仅冒烟用）。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import QRCode from "qrcode";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const DB_PATH = path.resolve(process.env.E2E_DATABASE_PATH ?? "server/data/smoke.sqlite");
const SESSION_SECRET = process.env.SESSION_SECRET ?? "gzspay-smoke-session-secret";
const SESSION_COOKIE = "gzs_session";
const PASSWORD = "123456";

let passed = 0;
let failed = 0;

function ok(name, detail = "") {
  passed += 1;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
  failed += 1;
  console.log(`  ✗ ${name} — ${detail}`);
  throw new Error(`${name}: ${detail}`);
}

function check(name, condition, detail = "") {
  if (condition) ok(name, detail);
  else fail(name, detail || "断言失败");
}

function hashSessionToken(token) {
  return createHash("sha256").update(`${token}.${SESSION_SECRET}`).digest("hex");
}

/**
 * 直接写入账号与会话（模拟「已经走过校园墙登录」），返回可用的 Cookie。
 * 仅用于本冒烟脚本，生产环境的会话只会由 OAuth 回调建立。
 */
function seedSession({ sub, username, qq = null }) {
  const db = new DatabaseSync(DB_PATH);
  try {
    const now = new Date().toISOString();
    const userId = randomUUID();
    db.prepare(
      "INSERT INTO users (id, campux_sub, qq, campux_username, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(userId, sub, qq, username, now, now, now);
    const token = randomBytes(32).toString("base64url");
    db.prepare(
      "INSERT INTO sessions (id, user_id, kind, ip, user_agent, created_at, expires_at, last_seen_at) VALUES (?, ?, 'user', '127.0.0.1', 'smoke', ?, ?, ?)",
    ).run(
      hashSessionToken(token),
      userId,
      now,
      new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      now,
    );
    return { id: userId, cookie: `${SESSION_COOKIE}=${token}` };
  } finally {
    db.close();
  }
}

function makeClient(label, initialCookie = "") {
  let cookie = initialCookie;
  async function request(path, { method = "GET", body, form, csrf = true } = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (csrf && method !== "GET" && method !== "HEAD") headers["x-requested-with"] = "gzspay";
    let payload;
    if (form) {
      payload = form;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${BASE}${path}`, { method, headers, body: payload, redirect: "manual" });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
    }
    const contentType = response.headers.get("content-type") ?? "";
    let data = null;
    if (contentType.includes("application/json")) data = await response.json();
    else if (contentType.includes("text/")) data = await response.text();
    return { status: response.status, data, contentType, headers: response.headers };
  }
  function expect(path, status, options) {
    return request(path, options).then((response) => {
      if (response.status !== status) {
        fail(`${label} ${options?.method ?? "GET"} ${path}`, `期望 ${status}，实际 ${response.status}：${JSON.stringify(response.data)?.slice(0, 300)}`);
      }
      return response;
    });
  }
  return { label, request, expect, cookie: () => cookie };
}

async function onboard(client, { surname, givenName, studentNo, email, cardNo }) {
  await client.expect("/api/onboarding/name", 200, { method: "POST", body: { surname, givenName } });
  await client.expect("/api/onboarding/student-no", 200, { method: "POST", body: { studentNo } });
  const started = await client.expect("/api/onboarding/email/start", 200, { method: "POST", body: { email } });
  check(`${client.label} 邮箱验证码已发出`, Boolean(started.data.devCode), `devCode=${started.data.devCode}`);
  await client.expect("/api/onboarding/email/verify", 200, {
    method: "POST",
    body: { email, code: started.data.devCode },
  });
  await client.expect("/api/onboarding/card", 200, { method: "POST", body: { cardContent: `gzspay:card:${cardNo}` } });
  await client.expect("/api/onboarding/payment-password", 200, {
    method: "POST",
    body: { password: PASSWORD, confirm: PASSWORD },
  });
  const me = await client.expect("/api/me", 200);
  check(`${client.label} 引导完成`, me.data.onboarded === true);
  return me.data;
}

async function main() {
  console.log(`\n== gzspay 端到端冒烟 @ ${BASE} ==`);

  const anonymous = makeClient("匿名");
  const health = await anonymous.expect("/api/health", 200);
  check("健康检查", health.data.status === "ok" && health.data.database === "up", `version=${health.data.version}`);

  const csrf = await anonymous.request("/api/auth/logout", { method: "POST", csrf: false });
  check("缺少 X-Requested-With 时被拒绝", csrf.status === 403 && csrf.data?.error?.code === "CSRF_REJECTED", `status=${csrf.status}`);

  // 初始化前：业务接口被闸门拦住，管理后台提示尚未初始化
  const beforeInit = await anonymous.request("/api/me");
  check(
    "未初始化时业务接口返回 503",
    beforeInit.status === 503 && beforeInit.data?.error?.code === "SYSTEM_NOT_INITIALIZED",
    `status=${beforeInit.status}`,
  );
  const adminBeforeInit = await anonymous.request("/api/admin/auth/session");
  check(
    "未初始化时管理后台提示未初始化",
    adminBeforeInit.status === 401 && adminBeforeInit.data?.error?.code === "SYSTEM_NOT_INITIALIZED",
    `status=${adminBeforeInit.status}`,
  );

  const setupStatus = await anonymous.expect("/api/setup/status", 200);
  check(
    "初始化状态为未完成",
    setupStatus.data.initialized === false && setupStatus.data.adminCount === 0,
    `initialized=${setupStatus.data.initialized}`,
  );

  // 首位登录账号（真实环境由校园墙回调建立会话）：完成初始化后自动成为超级管理员
  const firstAdmin = seedSession({ sub: "e2e-first-admin", username: "陈老师" });
  const admin = makeClient("首位管理员", firstAdmin.cookie);
  const configured = await admin.expect("/api/setup/config", 200, {
    method: "POST",
    body: {
      campux: { baseUrl: "https://campux.example.com", clientId: "e2e-client", clientSecret: "e2e-secret" },
      system: { siteName: "校园服务" },
    },
  });
  check(
    "保存初始化配置",
    configured.data.status?.campuxConfigured === true &&
      configured.data.status?.system?.siteName === "校园服务",
  );
  const finished = await admin.expect("/api/setup/finish", 200, { method: "POST", body: {} });
  check("第一个登录账号成为超级管理员", finished.data.admin?.role === "super");
  const adminSession = await admin.expect("/api/admin/auth/session", 200);
  check(
    "管理后台复用主站登录会话",
    adminSession.data.initialized === true && adminSession.data.admin?.role === "super",
  );

  // 商家账号
  const merchant = makeClient("商家", seedSession({ sub: "e2e-merchant", username: "王商家" }).cookie);
  const merchantMe = await onboard(merchant, {
    surname: "王",
    givenName: "商家",
    studentNo: "20238001",
    email: "merchant-e2e@example.com",
    cardNo: "CARD-E2E-8001",
  });

  // 商家注册：上传支付宝收款码（服务端解码校验渠道）
  const qrPng = await QRCode.toBuffer("https://qr.alipay.com/e2e-merchant-smoke", { width: 320 });
  const form = new FormData();
  form.set("name", "王商家的小卖部");
  form.set("noteRequirement", "请填写姓名和学号后四位");
  form.set("channels", JSON.stringify(["alipay"]));
  form.set("qr_alipay", new Blob([qrPng], { type: "image/png" }), "alipay.png");
  const registered = await merchant.expect("/api/merchant/register", 201, { method: "POST", form });
  check("商家注册成功", registered.data.merchant?.channels?.[0]?.hasQr === true, `name=${registered.data.merchant?.name}`);

  const product = await merchant.expect("/api/merchant/products", 201, {
    method: "POST",
    body: { name: "矿泉水", priceCents: 200, description: "550ml" },
  });
  check("新增商品", product.data.product?.priceCents === 200);

  const publicMerchant = await merchant.expect(`/api/merchant/public/${merchantMe.id}`, 200);
  check("商家公开主页含在售商品", publicMerchant.data.products?.length >= 1, `products=${publicMerchant.data.products?.length}`);

  // 付款人账号
  const payer = makeClient("付款人", seedSession({ sub: "e2e-payer", username: "李同学" }).cookie);
  const payerMe = await onboard(payer, {
    surname: "李",
    givenName: "同学",
    studentNo: "20238002",
    email: "payer-e2e@example.com",
    cardNo: "CARD-E2E-8002",
  });

  const scanned = await payer.expect("/api/scan/card", 200, { method: "POST", body: { cardContent: "gzspay:card:CARD-E2E-8001" } });
  check("扫码识别商家", scanned.data.isMerchant === true && scanned.data.user?.id === merchantMe.id);

  const scanNotBound = await payer.request("/api/scan/card", { method: "POST", body: { cardContent: "gzspay:card:NOT-BOUND-CARD" } });
  check("未绑定校园卡提示先注册", scanNotBound.status === 404 && scanNotBound.data?.error?.code === "NOT_FOUND");

  // 下单（带幂等键），重复提交应返回同一订单
  const orderBody = {
    merchantUserId: merchantMe.id,
    items: [{ productId: product.data.product.id, quantity: 2 }],
    reservedNote: "李同学 8002",
    paymentPassword: PASSWORD,
    idempotencyKey: "e2e-order-1",
  };
  const created = await payer.expect("/api/orders", 201, { method: "POST", body: orderBody });
  const order = created.data.order;
  check("下单成功", order?.status === "pending_payment" && order.amountCents === 400, `amount=${order?.amountCents}`);
  const duplicated = await payer.request("/api/orders", { method: "POST", body: orderBody });
  check("重复提交返回同一订单", duplicated.status === 200 && duplicated.data?.order?.id === order.id, `status=${duplicated.status}`);

  const receiveList = await merchant.expect("/api/orders?scope=receive&status=pending", 200);
  check("商家待收款列表出现订单", receiveList.data.items?.some((item) => item.id === order.id));
  const payList = await payer.expect("/api/orders?scope=pay&status=all", 200);
  check("付款人待付款列表出现订单", payList.data.items?.some((item) => item.id === order.id));

  const detail = await payer.expect(`/api/orders/${order.id}`, 200);
  check("订单详情含收款方式与预设备注", detail.data.availableChannels?.includes("alipay") && detail.data.reservedNote === "李同学 8002", `channels=${detail.data.availableChannels}`);

  const qr = await payer.request(`/api/orders/${order.id}/qr?channel=alipay`);
  check("订单收款码为 PNG", qr.status === 200 && qr.contentType.includes("image/png"), `type=${qr.contentType}`);

  const wrongPassword = await merchant.request(`/api/orders/merchant-create`, {
    method: "POST",
    body: { cardContent: "gzspay:card:CARD-E2E-8002", amountCents: 100, paymentPassword: "000000", idempotencyKey: "e2e-wrong-pw" },
  });
  check(
    "支付密码错误被拒绝",
    wrongPassword.status === 400 && wrongPassword.data?.error?.code === "PAYMENT_PASSWORD_WRONG",
    `status=${wrongPassword.status} code=${wrongPassword.data?.error?.code} body=${JSON.stringify(wrongPassword.data).slice(0, 200)}`,
  );

  const paid = await payer.expect(`/api/orders/${order.id}/pay`, 200, { method: "POST", body: { channel: "alipay", actualNote: "李同学 8002 已付" } });
  check("我已支付 → 已支付", paid.data.status === "paid");
  const completed = await merchant.expect(`/api/orders/${order.id}/confirm`, 200, { method: "POST", body: {} });
  check("商家确认收款 → 已完成", completed.data.status === "completed");

  const stats = await merchant.expect("/api/stats/summary", 200);
  check("商家收入统计", stats.data.incomeCents === 400, `income=${stats.data.incomeCents}`);
  const csv = await merchant.request("/api/stats/export");
  check("统计 CSV 导出", csv.status === 200 && csv.contentType.includes("text/csv"));

  // 动态码收款：客户出示动态码 → 商家只读解析 → 商家发起收款请求 → 客户在自己手机上确认
  const dynamic = await payer.expect("/api/dynamic-code", 201, { method: "POST", body: {} });
  check("客户签发动态码", dynamic.data.qrContent === `gzspay:dynamic:${dynamic.data.token}`);
  const resolved = await merchant.expect(`/api/dynamic-code/${dynamic.data.token}/resolve`, 200);
  check("商家只读解析不消费", resolved.data.user?.id === payerMe.id && resolved.data.isMerchant === false);

  const selfScan = await merchant.request(`/api/dynamic-code/request`, {
    method: "POST",
    body: { token: (await merchant.expect("/api/dynamic-code", 201, { method: "POST", body: {} })).data.token, amountCents: 100 },
  });
  check("不能扫自己的动态码收款", selfScan.status === 409);

  const request = await merchant.expect("/api/dynamic-code/request", 201, {
    method: "POST",
    body: { token: dynamic.data.token, amountCents: 300, reservedNote: "李同学 8002" },
  });
  check("商家发起收款请求", request.data.status === "pending" && request.data.amountCents === 300);
  const pendingRequests = await payer.expect("/api/dynamic-code/requests", 200);
  check("客户收到待确认请求", pendingRequests.data.items?.some((item) => item.id === request.data.id));
  const accepted = await payer.expect(`/api/dynamic-code/requests/${request.data.id}/accept`, 200, {
    method: "POST",
    body: { paymentPassword: PASSWORD },
  });
  check("客户确认后创建订单", accepted.data.order?.status === "pending_payment" && accepted.data.orderId === accepted.data.order?.id);

  // 商家扫客户卡代下单（单手机场景）：客户在商家手机上输入支付密码
  const merchantCreated = await merchant.expect("/api/orders/merchant-create", 201, {
    method: "POST",
    body: {
      cardContent: "gzspay:card:CARD-E2E-8002",
      amountCents: 150,
      reservedNote: "饮料",
      paymentPassword: PASSWORD,
      idempotencyKey: "e2e-merchant-create-1",
    },
  });
  check("商家扫客户卡代下单", merchantCreated.data.order?.role === "merchant" && merchantCreated.data.order.amountCents === 150);

  // SSE：登录用户可建立事件流（先收到 ready 事件）；匿名被拒
  const anonymousSse = await fetch(`${BASE}/api/events/stream`);
  check("SSE 需要登录会话（匿名被拒）", anonymousSse.status === 401, `status=${anonymousSse.status}`);
  const controller = new AbortController();
  const sse = await fetch(`${BASE}/api/events/stream`, {
    headers: { cookie: payer.cookie() },
    signal: controller.signal,
  });
  check("SSE 事件流已建立", sse.status === 200 && (sse.headers.get("content-type") ?? "").includes("text/event-stream"));
  const reader = sse.body.getReader();
  const first = await reader.read();
  const firstChunk = new TextDecoder().decode(first.value ?? new Uint8Array());
  check("SSE 收到 ready 事件", firstChunk.includes("event: ready"), JSON.stringify(firstChunk.slice(0, 60)));
  await reader.cancel().catch(() => {});
  controller.abort();

  // 商家视角时间线
  const timeline = await merchant.expect(`/api/orders/${order.id}`, 200);
  check("订单时间线完整", timeline.data.events?.length >= 3, `events=${timeline.data.events?.length}`);

  const about = await anonymous.expect("/api/about", 200);
  check(
    "关于页返回 Markdown 文档与改动日期",
    typeof about.data.version === "string" &&
      about.data.privacy?.startsWith("# gzspay 隐私协议") &&
      about.data.terms?.includes("## 修订记录") &&
      typeof about.data.privacyUpdatedAt === "string" &&
      typeof about.data.legalEffectiveAt === "string",
  );

  console.log(`\n结果：${passed} 项通过，${failed} 项失败`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`\n冒烟失败：${error.message}`);
  process.exit(1);
});
