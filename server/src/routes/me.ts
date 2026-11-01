import { readFileSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { REPO_ROOT, config } from "../config.js";
import { execute, isoAfter, nowIso, queryOne } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { buildCardQrContent, maskCardNo, randomToken, sha256 } from "../lib/crypto.js";
import { issueEmailCode, consumeEmailCode, latestCodeEmail } from "../lib/email.js";
import { errors } from "../lib/errors.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { sendMailInBackground, templates } from "../lib/mail.js";
import { requestIp } from "../lib/types.js";
import { parse } from "../lib/validate.js";
import {
  bindCampusCard,
  findUserByEmail,
  isValidEmailValue,
  setPaymentPassword,
  setRealName,
  setStudentNo,
  setVerifiedEmail,
  toMe,
  verifyPaymentPassword,
} from "../services/users.js";

export const meRouter: Router = Router();

meRouter.use(requireUser());

meRouter.get("/", (req, res) => {
  res.json(toMe(req.auth!.user));
});

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
    let updated = user;
    if (body.surname || body.givenName) {
      updated = setRealName(
        updated,
        body.surname ?? updated.surname ?? "",
        body.givenName ?? updated.given_name ?? "",
        requestIp(req),
      );
    }
    if (body.studentNo) {
      updated = setStudentNo(updated, body.studentNo, requestIp(req));
    }
    res.json(toMe(updated));
  }),
);

const emailStartSchema = z.object({
  email: z.string().trim().min(1, "请填写邮箱"),
  paymentPassword: z.string().trim().min(1, "请输入支付密码"),
});

meRouter.post(
  "/email/start",
  asyncHandler(async (req, res) => {
    const user = req.auth!.user;
    const body = parse(emailStartSchema, req.body);
    verifyPaymentPassword(user, body.paymentPassword, requestIp(req));
    if (!isValidEmailValue(body.email)) throw errors.validation("邮箱格式不正确");
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
    res.json(toMe(updated));
  }),
);

const cardSchema = z.object({
  cardContent: z.string().trim().min(1, "请扫描校园卡二维码"),
  paymentPassword: z.string().trim().min(1, "请输入支付密码"),
});

meRouter.post(
  "/card",
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(cardSchema, req.body);
    verifyPaymentPassword(user, body.paymentPassword, requestIp(req));
    const updated = bindCampusCard(user, body.cardContent, requestIp(req));
    res.json(toMe(updated));
  }),
);

const settingsSchema = z.object({
  newOrder: z.boolean().optional(),
  paid: z.boolean().optional(),
  settled: z.boolean().optional(),
});

meRouter.patch(
  "/settings",
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(settingsSchema, req.body);
    const current = queryOne<{ new_order: number; paid: number; settled: number }>(
      "SELECT * FROM notification_settings WHERE user_id = ?",
      user.id,
    );
    if (!current) throw errors.notFound("通知设置不存在");
    execute(
      "UPDATE notification_settings SET new_order = ?, paid = ?, settled = ? WHERE user_id = ?",
      body.newOrder === undefined ? current.new_order : body.newOrder ? 1 : 0,
      body.paid === undefined ? current.paid : body.paid ? 1 : 0,
      body.settled === undefined ? current.settled : body.settled ? 1 : 0,
      user.id,
    );
    res.json(toMe(req.auth!.user));
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
  asyncHandler((req, res) => {
    const body = parse(z.object({ password: z.string().trim().min(1) }), req.body);
    verifyPaymentPassword(req.auth!.user, body.password, requestIp(req));
    res.json({ ok: true });
  }),
);

meRouter.post(
  "/payment-password/reset/start",
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

meRouter.post(
  "/payment-password/reset/verify",
  asyncHandler((req, res) => {
    const user = req.auth!.user;
    const body = parse(z.object({ code: z.string().trim().min(4) }), req.body);
    consumeEmailCode({
      userId: user.id,
      purpose: "password_reset",
      code: body.code,
      ip: requestIp(req),
    });
    const token = randomToken(32);
    const expiresAt = isoAfter(config.security.passwordResetTokenTtlMinutes * 60);
    execute(
      "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
      nowIso(),
      user.id,
    );
    execute(
      "INSERT INTO password_reset_tokens (id, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)",
      sha256(token),
      user.id,
      expiresAt,
      nowIso(),
    );
    res.json({ resetToken: token, expiresAt });
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
    if (user.email) {
      sendMailInBackground(templates.passwordChanged(user.email));
    }
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

/** 从仓库根目录 CHANGELOG.md 解析版本历史（按版本倒序） */
export function readChangelog(): ChangelogEntry[] {
  try {
    const text = readFileSync(path.join(REPO_ROOT, "CHANGELOG.md"), "utf-8");
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
    // 刚发布版本后「未发布」可能只剩说明文字，没有条目时直接隐藏，不让关于页出现空版本块
    return entries.filter((entry) => entry.groups.length > 0);
  } catch {
    return [];
  }
}
