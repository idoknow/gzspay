import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { REPO_ROOT, config, isCampuxConfigured } from "../config.js";
import { execute, isoAfter, nowIso, queryOne } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { createAuthorizationRequest, OAUTH_STATE_COOKIE, oauthStateCookieOptions } from "../lib/campux.js";
import { buildCardQrContent, maskCardNo, randomToken, sha256 } from "../lib/crypto.js";
import { issueEmailCode, consumeEmailCode, latestCodeEmail } from "../lib/email.js";
import { AppError, errors } from "../lib/errors.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { rateLimit, userKey } from "../lib/rate-limit.js";
import { templates } from "../lib/mail.js";
import { clearSessionCookie } from "../lib/session.js";
import { requestIp } from "../lib/types.js";
import { parse } from "../lib/validate.js";
import {
  ONLINE_WINDOW_MINUTES,
  listUserDevices,
  revokeOtherUserDevices,
  revokeUserDevice,
} from "../services/devices.js";
import {
  bindCampusCard,
  findUserByEmail,  isQqEmailValue,
  mailUserWithSetting,
  notifyProfileChanged,
  setPaymentPassword,
  setRealName,
  setStudentNo,
  setVerifiedEmail,
  toMe,
  verifyPaymentPassword,
} from "../services/users.js";
import type { ProfileChangeField } from "../services/users.js";
import { disableNfcCard, nfcCardState, rotateNfcToken } from "../services/nfc.js";
import { registerPushToken, removePushToken } from "../services/push.js";

export const meRouter: Router = Router();

meRouter.use(requireUser());

meRouter.get("/", (req, res) => {
  res.json(toMe(req.auth!.user));
});

// ---- NFC 卡片：开启 / 更换令牌 / 关闭（令牌就是别人贴一贴读到的公开链接） ----
meRouter.get("/nfc-card", (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(nfcCardState(req.auth!.user));
});

meRouter.post("/nfc-card", (req, res) => {
  const state = rotateNfcToken(req.auth!.user);
  writeAudit({
    actorId: req.auth!.user.id,
    actorRole: "user",
    action: "nfc.card_enabled",
    detail: "开启或更换了 NFC 卡片链接",
    ip: requestIp(req),
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json(state);
});

meRouter.delete("/nfc-card", (req, res) => {
  const state = disableNfcCard(req.auth!.user);
  writeAudit({
    actorId: req.auth!.user.id,
    actorRole: "user",
    action: "nfc.card_disabled",
    detail: "关闭了 NFC 卡片链接",
    ip: requestIp(req),
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json(state);
});

// ---- FCM 设备令牌：客户端拿到 token 后注册，退出登录时注销 ----
const pushTokenSchema = z.object({
  token: z.string().trim().min(20, "推送令牌格式不正确").max(4096),
  platform: z.enum(["android"]).optional(),
});

meRouter.post(
  "/push-token",
  rateLimit({ scope: "me.push_token", limit: 30, windowSeconds: 60, keyBy: userKey }),
  asyncHandler((req, res) => {
    const body = parse(pushTokenSchema, req.body);
    registerPushToken(req.auth!.user.id, body.token, body.platform ?? "android");
    res.status(201).json({ ok: true });
  }),
);

meRouter.delete(
  "/push-token",
  asyncHandler((req, res) => {
    const body = parse(z.object({ token: z.string().trim().min(1).max(4096) }), req.body);
    removePushToken(req.auth!.user.id, body.token);
    res.json({ ok: true });
  }),
);

const profileSchema = z.object({
  surname: z.string().trim().min(1).max(20).optional(),
  givenName: z.string().trim().min(1).max(20).optional(),
  studentNo: z.string().trim().min(1).optional(),
  paymentPassword: z.string().trim().min(1, "请输入支付密码"),
});

meRouter.patch(
  "/profile",
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(profileSchema, req.body);
    if (!body.surname && !body.givenName && !body.studentNo) {
      throw errors.validation("没有需要修改的内容");
    }
    verifyPaymentPassword(user, body.paymentPassword, requestIp(req));
    const changed: ProfileChangeField[] = [];
    let updated = user;
    if (body.surname || body.givenName) {
      updated = setRealName(
        updated,
        body.surname ?? updated.surname ?? "",
        body.givenName ?? updated.given_name ?? "",
        requestIp(req),
      );
      if (updated.surname !== user.surname || updated.given_name !== user.given_name) {
        changed.push("name");
      }
    }
    if (body.studentNo) {
      updated = setStudentNo(updated, body.studentNo, requestIp(req));
      if (updated.student_no !== user.student_no) changed.push("studentNo");
    }
    // 只改动了真实变化的字段才发提醒邮件
    notifyProfileChanged(updated, changed, requestIp(req));
    res.json(toMe(updated));
  }),
);

const emailStartSchema = z.object({
  email: z.string().trim().min(1, "请填写邮箱"),
  paymentPassword: z.string().trim().min(1, "请输入支付密码"),
});

meRouter.post(
  "/email/start",
  rateLimit({
    scope: "me.email.start",
    limit: config.security.rateLimitEmailPerMinute,
    windowSeconds: 60,
    keyBy: userKey,
    message: "验证码发送过于频繁，请稍后再试",
  }),
  asyncHandler(async (req, res) => {
    const user = req.auth!.user;
    const body = parse(emailStartSchema, req.body);
    verifyPaymentPassword(user, body.paymentPassword, requestIp(req));
    if (!isQqEmailValue(body.email)) {
      throw errors.validation("只能绑定 QQ 邮箱，格式为「QQ号@qq.com」，且 QQ 号必须为纯数字");
    }
    const taken = findUserByEmail(body.email);
    if (taken && taken.id !== user.id) throw errors.conflict("该邮箱已被其他账号使用");
    const issued = await issueEmailCode({
      user,
      purpose: "email_change",
      email: body.email,
      scene: "更换邮箱",
    });
    res.json(issued);
  }),
);

const emailVerifySchema = z.object({
  email: z.string().trim().min(1),
  code: z.string().trim().min(4),
  paymentPassword: z.string().trim().min(1),
});

meRouter.post(
  "/email/verify",
  rateLimit({
    scope: "me.email_verify",
    limit: 10,
    windowSeconds: 60,
    keyBy: userKey,
    message: "验证太频繁了，请稍后再试",
  }),
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(emailVerifySchema, req.body);
    verifyPaymentPassword(user, body.paymentPassword, requestIp(req));
    const pending = latestCodeEmail(user.id, "email_change");
    if (!pending || pending.toLowerCase() !== body.email.toLowerCase()) {
      throw errors.validation("验证码与邮箱不匹配，请重新获取验证码");
    }
    consumeEmailCode({
      userId: user.id,
      purpose: "email_change",
      code: body.code,
      ip: requestIp(req),
    });
    const updated = setVerifiedEmail(user, body.email, requestIp(req));
    if (updated.email !== user.email) {
      notifyProfileChanged(updated, ["email"], requestIp(req));
    }
    res.json(toMe(updated));
  }),
);

const cardSchema = z.object({
  cardContent: z.string().trim().min(1, "请扫描校园卡二维码"),
  paymentPassword: z.string().trim().min(1, "请输入支付密码"),
});

meRouter.post(
  "/card",
  rateLimit({
    scope: "me.card_bind",
    limit: 5,
    windowSeconds: 60,
    keyBy: userKey,
    message: "绑定校园卡太频繁了，请稍后再试",
  }),
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(cardSchema, req.body);
    verifyPaymentPassword(user, body.paymentPassword, requestIp(req));
    const updated = bindCampusCard(user, body.cardContent, requestIp(req));
    if (updated.card_no !== user.card_no) {
      notifyProfileChanged(updated, ["card"], requestIp(req));
    }
    res.json(toMe(updated));
  }),
);

const settingsSchema = z.object({
  newOrder: z.boolean().optional(),
  paid: z.boolean().optional(),
  settled: z.boolean().optional(),
  ticket: z.boolean().optional(),
  announcement: z.boolean().optional(),
  profile: z.boolean().optional(),
  password: z.boolean().optional(),
  login: z.boolean().optional(),
});

meRouter.patch(
  "/settings",
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(settingsSchema, req.body);
    const current = queryOne<{
      new_order: number;
      paid: number;
      settled: number;
      ticket: number;
      announcement: number;
      profile: number;
      password: number;
      login: number;
    }>("SELECT * FROM notification_settings WHERE user_id = ?", user.id);
    if (!current) throw errors.notFound("通知设置不存在");
    execute(
      `UPDATE notification_settings
          SET new_order = ?, paid = ?, settled = ?, ticket = ?, announcement = ?,
              profile = ?, password = ?, login = ?
        WHERE user_id = ?`,
      body.newOrder === undefined ? current.new_order : body.newOrder ? 1 : 0,
      body.paid === undefined ? current.paid : body.paid ? 1 : 0,
      body.settled === undefined ? current.settled : body.settled ? 1 : 0,
      body.ticket === undefined ? current.ticket : body.ticket ? 1 : 0,
      body.announcement === undefined ? current.announcement : body.announcement ? 1 : 0,
      body.profile === undefined ? current.profile : body.profile ? 1 : 0,
      body.password === undefined ? current.password : body.password ? 1 : 0,
      body.login === undefined ? current.login : body.login ? 1 : 0,
      user.id,
    );
    res.json(toMe(req.auth!.user));
  }),
);

// ---------------- 登录设备 ----------------

meRouter.get(
  "/devices",
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    res.json({
      items: await listUserDevices(auth.user.id, auth.session.id),
      onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
    });
  }),
);

meRouter.post(
  "/devices/logout-others",
  asyncHandler((req, res) => {
    const auth = req.auth!;
    const revoked = revokeOtherUserDevices(auth.user.id, auth.session.id);
    writeAudit({
      actorId: auth.user.id,
      actorRole: "user",
      action: "user.devices.logout_others",
      targetType: "user",
      targetId: auth.user.id,
      detail: `退出其它登录设备 ${revoked} 台`,
      ip: requestIp(req),
    });
    res.json({ ok: true, revoked });
  }),
);

meRouter.post(
  "/devices/:id/logout",
  asyncHandler((req, res) => {
    const auth = req.auth!;
    const sessionId = String(req.params.id);
    if (!revokeUserDevice(auth.user.id, sessionId, auth.session.id)) {
      throw errors.notFound("设备不存在或已退出登录");
    }
    const current = sessionId === auth.session.id;
    if (current) clearSessionCookie(res);
    writeAudit({
      actorId: auth.user.id,
      actorRole: "user",
      action: "user.devices.logout",
      targetType: "user",
      targetId: auth.user.id,
      detail: current ? "退出当前设备" : "强制退出其它登录设备",
      ip: requestIp(req),
    });
    res.json({ ok: true, current });
  }),
);

meRouter.get("/card-qr", (req, res) => {
  const user = req.auth!.user;
  if (!user.card_no) throw errors.notFound("尚未绑定校园卡");
  res.json({ content: buildCardQrContent(user.card_no), cardNoMasked: maskCardNo(user.card_no) });
});

// ---------------- 支付密码 ----------------

meRouter.post(
  "/payment-password/verify",
  rateLimit({
    scope: "me.pwd_verify",
    limit: 10,
    windowSeconds: 60,
    keyBy: userKey,
    message: "验证太频繁了，请稍后再试",
  }),
  asyncHandler((req, res) => {
    const body = parse(z.object({ password: z.string().trim().min(1) }), req.body);
    verifyPaymentPassword(req.auth!.user, body.password, requestIp(req));
    res.json({ ok: true });
  }),
);

/** 签发一次性的支付密码重置凭证（邮箱验证与校园墙验证共用） */
function issueResetToken(userId: string): { resetToken: string; expiresAt: string } {
  const token = randomToken(32);
  const expiresAt = isoAfter(config.security.passwordResetTokenTtlMinutes * 60);
  execute(
    "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
    nowIso(),
    userId,
  );
  execute(
    "INSERT INTO password_reset_tokens (id, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)",
    sha256(token),
    userId,
    expiresAt,
    nowIso(),
  );
  return { resetToken: token, expiresAt };
}

meRouter.post(
  "/payment-password/reset/start",
  rateLimit({
    scope: "me.pwd_reset_start",
    limit: 5,
    windowSeconds: 60,
    keyBy: userKey,
    message: "操作太频繁了，请稍后再试",
  }),
  asyncHandler(async (req, res) => {
    const user = req.auth!.user;
    if (!user.email) throw errors.validation("请先绑定邮箱，再修改支付密码");
    const issued = await issueEmailCode({
      user,
      purpose: "password_reset",
      email: user.email,
      scene: "修改支付密码",
    });
    res.json({ ...issued, emailMasked: toMe(user).emailMasked });
  }),
);

/**
 * 校园墙再验证：跳转到校园墙授权页。
 * 回调（/api/auth/callback）确认授权账号与当前登录账号一致后写入验证凭证，
 * 前端再回本页领取重置凭证，因此不需要把 token 放进 URL。
 */
meRouter.get(
  "/payment-password/reset/campux/start",
  rateLimit({
    scope: "me.password.campux",
    limit: 10,
    windowSeconds: 60,
    keyBy: userKey,
    message: "验证请求过于频繁，请稍后再试",
  }),
  (req, res) => {
    if (!isCampuxConfigured()) {
      throw new AppError(
        503,
        "CAMPUX_NOT_CONFIGURED",
        "管理员尚未配置校园墙登录，暂时无法用校园墙验证",
      );
    }
    const { url, state } = createAuthorizationRequest("/me/password", "password_verify");
    res.cookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions());
    res.redirect(302, url);
  },
);

/** 领取校园墙验证通过后的重置凭证（5 分钟内有效、一次性） */
meRouter.post(
  "/payment-password/reset/campux/claim",
  rateLimit({
    scope: "me.pwd_claim",
    limit: 10,
    windowSeconds: 60,
    keyBy: userKey,
    message: "操作太频繁了，请稍后再试",
  }),
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const row = queryOne<{ id: string }>(
      `SELECT * FROM password_verifications
       WHERE user_id = ? AND used_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      user.id,
      nowIso(),
    );
    if (!row) throw errors.validation("校园墙验证已过期，请重新验证");
    execute("UPDATE password_verifications SET used_at = ? WHERE id = ?", nowIso(), row.id);
    res.json(issueResetToken(user.id));
  }),
);

meRouter.post(
  "/payment-password/reset/verify",
  rateLimit({
    scope: "me.pwd_reset_verify",
    limit: 10,
    windowSeconds: 60,
    keyBy: userKey,
    message: "验证太频繁了，请稍后再试",
  }),
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(z.object({ code: z.string().trim().min(4) }), req.body);
    consumeEmailCode({
      userId: user.id,
      purpose: "password_reset",
      code: body.code,
      ip: requestIp(req),
    });
    res.json(issueResetToken(user.id));
  }),
);

const resetConfirmSchema = z.object({
  resetToken: z.string().trim().min(10),
  password: z.string().trim().min(1),
  confirm: z.string().trim().min(1),
});

meRouter.post(
  "/payment-password/reset/confirm",
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(resetConfirmSchema, req.body);
    if (body.password !== body.confirm) throw errors.validation("两次输入的支付密码不一致");
    const row = queryOne<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
      "SELECT * FROM password_reset_tokens WHERE id = ?",
      sha256(body.resetToken),
    );
    if (!row || row.user_id !== user.id) throw errors.validation("重置凭证无效，请重新获取验证码");
    if (row.used_at) throw errors.validation("重置凭证已使用，请重新获取验证码");
    if (row.expires_at <= nowIso()) throw errors.validation("重置凭证已过期，请重新获取验证码");
    setPaymentPassword(user, body.password, requestIp(req));
    execute("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", nowIso(), row.id);
    // 密码修改提醒：受「密码修改」开关控制，开关关闭时不发信
    mailUserWithSetting(user.id, templates.passwordChanged(user.email ?? ""), "password");
    writeAudit({
      actorId: user.id,
      actorRole: "user",
      action: "payment_password.reset",
      targetType: "user",
      targetId: user.id,
      ip: requestIp(req),
    });
    res.json({ ok: true });
  }),
);

// ---------------- 关于 ----------------

export interface ChangelogGroup {
  /** 「新增」「变更」「修复」等小标题；没有小标题的条目归到「其他」。 */
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  /** 展平后的全部条目，便于只想要纯文本的客户端使用。 */
  items: string[];
  /** 按「新增 / 变更 / 修复」分组，保留 CHANGELOG.md 的原有结构。 */
  groups: ChangelogGroup[];
}

interface ChangelogCache {
  entries: ChangelogEntry[];
  mtimeMs: number;
  checkedAt: number;
}

let changelogCache: ChangelogCache | null = null;
const CHANGELOG_CACHE_TTL_MS = 60_000;

/**
 * 从仓库根目录 CHANGELOG.md 解析版本历史（按版本倒序）。
 * 关于页会被反复打开，这里按文件 mtime + 60 秒 TTL 缓存，避免每次请求都读盘解析。
 */
export function readChangelog(): ChangelogEntry[] {
  const file = path.join(REPO_ROOT, "CHANGELOG.md");
  try {
    const now = Date.now();
    if (changelogCache && now - changelogCache.checkedAt < CHANGELOG_CACHE_TTL_MS) {
      return changelogCache.entries;
    }
    const stat = statSync(file);
    if (changelogCache && stat.mtimeMs === changelogCache.mtimeMs) {
      changelogCache.checkedAt = now;
      return changelogCache.entries;
    }
    const entries = parseChangelog(readFileSync(file, "utf-8"));
    changelogCache = { entries, mtimeMs: stat.mtimeMs, checkedAt: now };
    return entries;
  } catch {
    return changelogCache?.entries ?? [];
  }
}

function parseChangelog(text: string): ChangelogEntry[] {
  {
    const entries: ChangelogEntry[] = [];
    let current: ChangelogEntry | null = null;
    let group: ChangelogGroup | null = null;
    for (const line of text.split(/\r?\n/)) {
      const heading = /^##\s+\[?([^\]]+?)\]?(?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/.exec(line);
      if (heading) {
        if (current) entries.push(current);
        current = { version: (heading[1] ?? "").trim(), date: heading[2] ?? "", items: [], groups: [] };
        group = null;
        continue;
      }
      if (!current) continue;
      const sub = /^###\s+(.+?)\s*$/.exec(line);
      if (sub) {
        group = { title: (sub[1] ?? "").trim(), items: [] };
        current.groups.push(group);
        continue;
      }
      const item = /^\s*[-*]\s+(.+)$/.exec(line);
      if (!item) continue;
      const value = (item[1] ?? "").trim();
      if (!value) continue;
      current.items.push(value);
      if (group) {
        group.items.push(value);
      } else {
        let other = current.groups.find((entry) => entry.title === "其他");
        if (!other) {
          other = { title: "其他", items: [] };
          current.groups.push(other);
        }
        other.items.push(value);
      }
    }
    if (current) entries.push(current);
    // 去掉没有条目的分组，避免「### 修复」下暂时还没写内容时出现空块
    for (const entry of entries) entry.groups = entry.groups.filter((item) => item.items.length > 0);
    return entries.filter((entry) => entry.groups.length > 0);
  }
}
