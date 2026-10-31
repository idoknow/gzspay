import { config } from "../config.js";
import { execute, isoAfter, nowIso, queryOne, transaction } from "../db/index.js";
import { writeAudit, writeRiskLog } from "../lib/audit.js";
import { syncQqAvatar } from "../lib/avatar.js";
import {
  displayFullName,
  isValidEmail,
  isValidPaymentPassword,
  isValidStudentNo,
  maskCardNo,
  maskEmail,
  maskStudentNo,
  nameInitial,
  hashPaymentPassword,
  parseCardQrContent,
  verifyPaymentPasswordHash,
} from "../lib/crypto.js";
import { errors } from "../lib/errors.js";
import { sendMailInBackground, templates } from "../lib/mail.js";
import type {
  AuthContext,
  Me,
  MerchantRow,
  NotificationSettingsRow,
  OnboardStep,
  PublicUser,
  UserRow,
} from "../lib/types.js";

export function displayNameOf(user: UserRow): string {
  return (
    displayFullName(user.surname, user.given_name) ??
    user.campux_username ??
    "校园墙用户"
  );
}

export function findUserById(id: string): UserRow | undefined {
  return queryOne<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

export function findUserBySub(sub: string): UserRow | undefined {
  return queryOne<UserRow>("SELECT * FROM users WHERE campux_sub = ?", sub);
}

export function findUserByCard(cardNo: string): UserRow | undefined {
  return queryOne<UserRow>("SELECT * FROM users WHERE card_no = ?", cardNo);
}

export function findUserByStudentNo(studentNo: string): UserRow | undefined {
  return queryOne<UserRow>("SELECT * FROM users WHERE student_no = ?", studentNo);
}

export function findUserByEmail(email: string): UserRow | undefined {
  return queryOne<UserRow>("SELECT * FROM users WHERE lower(email) = lower(?)", email);
}

export function getMerchant(userId: string): MerchantRow | undefined {
  return queryOne<MerchantRow>("SELECT * FROM merchants WHERE user_id = ?", userId);
}

export function isMerchant(userId: string): boolean {
  return getMerchant(userId) !== undefined;
}

export function publicUserOf(user: UserRow): PublicUser {
  return {
    id: user.id,
    displayName: displayNameOf(user),
    avatarUrl: user.avatar_url,
    studentNoMasked: maskStudentNo(user.student_no),
    isMerchant: isMerchant(user.id),
  };
}

export function ensureNotificationSettings(userId: string): NotificationSettingsRow {
  const existing = queryOne<NotificationSettingsRow>(
    "SELECT * FROM notification_settings WHERE user_id = ?",
    userId,
  );
  if (existing) return existing;
  execute(
    "INSERT INTO notification_settings (user_id, new_order, paid, settled) VALUES (?, 1, 1, 1)",
    userId,
  );
  return {
    user_id: userId,
    new_order: 1,
    paid: 1,
    settled: 1,
  };
}

export function toMe(user: UserRow): Me {
  const notification = ensureNotificationSettings(user.id);
  return {
    id: user.id,
    displayName: displayNameOf(user),
    surname: user.surname,
    givenName: user.given_name,
    fullName: displayFullName(user.surname, user.given_name),
    studentNo: user.student_no,
    email: user.email,
    emailMasked: maskEmail(user.email),
    cardNoMasked: maskCardNo(user.card_no),
    avatarUrl: user.avatar_url,
    onboarded: user.onboarded === 1,
    onboardStep: user.onboard_step,
    isMerchant: isMerchant(user.id),
    isAdmin: queryOne<{ role: string }>("SELECT role FROM admins WHERE user_id = ?", user.id) !== undefined,
    paymentPasswordSet: Boolean(user.payment_pwd_hash),
    frozen: user.status === "frozen",
    notificationSettings: {
      newOrder: notification.new_order === 1,
      paid: notification.paid === 1,
      settled: notification.settled === 1,
    },
    createdAt: user.created_at,
  };
}

/** 默认头像：姓名首字 */
export function defaultAvatarText(user: UserRow): string {
  return nameInitial(displayNameOf(user));
}

export interface CampuxIdentity {
  sub: string;
  qq: string | null;
  username: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
}

export interface LoginResult {
  user: UserRow;
  isNew: boolean;
  onboardingComplete: boolean;
}

/** 以 sub 匹配账号；不存在则创建（新用户进入引导流程） */
export function loginOrRegister(identity: CampuxIdentity, ip: string): LoginResult {
  const existing = findUserBySub(identity.sub);
  if (existing) {
    if (existing.status === "frozen") {
      writeAudit({
        actorId: existing.id,
        actorRole: "user",
        action: "login.rejected_frozen",
        targetType: "user",
        targetId: existing.id,
        ip,
      });
      throw errors.locked("账号已被冻结，请联系管理员");
    }
    execute(
      "UPDATE users SET qq = ?, campux_username = ?, last_login_at = ?, updated_at = ? WHERE id = ?",
      identity.qq ?? existing.qq,
      identity.username ?? existing.campux_username,
      nowIso(),
      nowIso(),
      existing.id,
    );
    ensureNotificationSettings(existing.id);
    const updated = findUserById(existing.id) as UserRow;
    // 每次登录尝试刷新头像（失败保留旧头像）
    if (!updated.avatar_url) {
      void syncQqAvatar(updated);
    }
    writeAudit({
      actorId: updated.id,
      actorRole: "user",
      action: "login.success",
      targetType: "user",
      targetId: updated.id,
      ip,
    });
    return {
      user: updated,
      isNew: false,
      onboardingComplete: updated.onboarded === 1,
    };
  }

  const userId = crypto.randomUUID();
  const now = nowIso();
  transaction(() => {
    execute(
      `INSERT INTO users (id, campux_sub, qq, campux_username, onboard_step, onboarded, status, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, 'name', 0, 'active', ?, ?, ?)`,
      userId,
      identity.sub,
      identity.qq,
      identity.username,
      now,
      now,
      now,
    );
    execute(
      "INSERT INTO notification_settings (user_id, new_order, paid, settled) VALUES (?, 1, 1, 1)",
      userId,
    );
  });
  const created = findUserById(userId) as UserRow;
  writeAudit({
    actorId: created.id,
    actorRole: "user",
    action: "user.registered",
    targetType: "user",
    targetId: created.id,
    ip,
  });
  void syncQqAvatar(created);
  return { user: created, isNew: true, onboardingComplete: false };
}

// ---------------- 引导流程 ----------------

const ONBOARD_ORDER: OnboardStep[] = ["name", "studentNo", "email", "card", "password", "done"];

export function nextOnboardStep(step: OnboardStep): OnboardStep {
  const index = ONBOARD_ORDER.indexOf(step);
  return ONBOARD_ORDER[Math.min(index + 1, ONBOARD_ORDER.length - 1)] ?? "done";
}

export function updateOnboardStep(userId: string, step: OnboardStep): void {
  execute("UPDATE users SET onboard_step = ?, updated_at = ? WHERE id = ?", step, nowIso(), userId);
}

export function completeOnboarding(userId: string): void {
  execute(
    "UPDATE users SET onboard_step = 'done', onboarded = 1, updated_at = ? WHERE id = ?",
    nowIso(),
    userId,
  );
}

export function setRealName(user: UserRow, surname: string, givenName: string, ip: string): UserRow {
  const s = surname.trim();
  const g = givenName.trim();
  if (s.length === 0 || g.length === 0) throw errors.validation("请填写真实的姓和名");
  if (s.length > 20 || g.length > 20) throw errors.validation("姓名过长");
  execute(
    "UPDATE users SET surname = ?, given_name = ?, updated_at = ? WHERE id = ?",
    s,
    g,
    nowIso(),
    user.id,
  );
  writeAudit({
    actorId: user.id,
    actorRole: "user",
    action: "profile.name_updated",
    targetType: "user",
    targetId: user.id,
    ip,
  });
  if (user.onboard_step === "name") updateOnboardStep(user.id, "studentNo");
  return findUserById(user.id) as UserRow;
}

export function setStudentNo(user: UserRow, studentNo: string, ip: string): UserRow {
  const value = studentNo.trim();
  if (!isValidStudentNo(value)) throw errors.validation("学号格式不正确，应为 6~20 位数字");
  const taken = findUserByStudentNo(value);
  if (taken && taken.id !== user.id) throw errors.conflict("该学号已被其他账号绑定");
  execute("UPDATE users SET student_no = ?, updated_at = ? WHERE id = ?", value, nowIso(), user.id);
  writeAudit({
    actorId: user.id,
    actorRole: "user",
    action: "profile.student_no_updated",
    targetType: "user",
    targetId: user.id,
    ip,
  });
  if (user.onboard_step === "studentNo") updateOnboardStep(user.id, "email");
  return findUserById(user.id) as UserRow;
}

export function setVerifiedEmail(user: UserRow, email: string, ip: string): UserRow {
  execute(
    "UPDATE users SET email = ?, email_verified = 1, updated_at = ? WHERE id = ?",
    email,
    nowIso(),
    user.id,
  );
  writeAudit({
    actorId: user.id,
    actorRole: "user",
    action: "profile.email_updated",
    targetType: "user",
    targetId: user.id,
    ip,
  });
  if (user.onboard_step === "email") updateOnboardStep(user.id, "card");
  return findUserById(user.id) as UserRow;
}

/** 绑定/换绑校园卡；一张卡只能绑定一个账号 */
export function bindCampusCard(user: UserRow, rawQrContent: string, ip: string): UserRow {
  const cardNo = parseCardQrContent(rawQrContent);
  if (!cardNo) throw errors.validation("未能识别校园卡二维码，请重新扫描");
  const owner = findUserByCard(cardNo);
  if (owner && owner.id !== user.id) throw errors.conflict("该校园卡已绑定其他账号");
  execute("UPDATE users SET card_no = ?, updated_at = ? WHERE id = ?", cardNo, nowIso(), user.id);
  writeAudit({
    actorId: user.id,
    actorRole: "user",
    action: user.card_no ? "profile.card_rebound" : "profile.card_bound",
    targetType: "user",
    targetId: user.id,
    detail: maskCardNo(cardNo),
    ip,
  });
  // 换绑后旧卡自动解绑（同一字段覆盖即完成），引导流程推进
  if (user.onboard_step === "card") updateOnboardStep(user.id, "password");
  return findUserById(user.id) as UserRow;
}

/** 根据卡号解析对方，用于扫码付款/收款 */
export function resolveCardOwner(rawQrContent: string): UserRow {
  const cardNo = parseCardQrContent(rawQrContent);
  if (!cardNo) throw errors.validation("校园卡二维码无法识别，请重新扫描");
  const owner = findUserByCard(cardNo);
  if (!owner) throw errors.notFound("该校园卡尚未绑定账号，请对方先注册 gzspay");
  if (owner.status === "frozen") throw errors.locked("对方账号已被冻结，暂时无法交易");
  return owner;
}

// ---------------- 支付密码 ----------------

export interface PaymentPasswordCheck {
  user: UserRow;
}

/** 校验支付密码（含错误次数与锁定），所有敏感操作都走这里 */
export function verifyPaymentPassword(
  user: UserRow,
  password: string,
  ip: string,
): UserRow {
  if (!user.payment_pwd_hash) throw errors.paymentPasswordNotSet();
  if (user.payment_locked_until && user.payment_locked_until > nowIso()) {
    throw errors.paymentPasswordLocked(user.payment_locked_until);
  }
  if (!isValidPaymentPassword(password)) {
    throw errors.validation("支付密码为 6 位数字");
  }

  if (verifyPaymentPasswordHash(password, user.payment_pwd_hash)) {
    if (user.payment_fail_count !== 0 || user.payment_locked_until) {
      execute(
        "UPDATE users SET payment_fail_count = 0, payment_fail_window_start = NULL, payment_locked_until = NULL, updated_at = ? WHERE id = ?",
        nowIso(),
        user.id,
      );
    }
    return findUserById(user.id) as UserRow;
  }

  const failCount = user.payment_fail_count + 1;
  writeRiskLog({
    userId: user.id,
    type: "payment_password_wrong",
    detail: `支付密码错误（第 ${failCount} 次）`,
    ip,
  });
  if (failCount >= config.security.paymentMaxAttempts) {
    const lockedUntil = isoAfter(config.security.paymentLockMinutes * 60);
    execute(
      `UPDATE users SET payment_fail_count = 0, payment_fail_window_start = NULL,
       payment_locked_until = ?, updated_at = ? WHERE id = ?`,
      lockedUntil,
      nowIso(),
      user.id,
    );
    if (user.email) {
      sendMailInBackground({ ...templates.paymentLocked(user.email) });
    }
    writeAudit({
      actorId: user.id,
      actorRole: "user",
      action: "payment_password.locked",
      targetType: "user",
      targetId: user.id,
      ip,
    });
    throw errors.paymentPasswordLocked(lockedUntil);
  }

  execute(
    "UPDATE users SET payment_fail_count = ?, payment_fail_window_start = COALESCE(payment_fail_window_start, ?), updated_at = ? WHERE id = ?",
    failCount,
    nowIso(),
    nowIso(),
    user.id,
  );
  throw errors.paymentPasswordWrong(config.security.paymentMaxAttempts - failCount);
}

export function setPaymentPassword(user: UserRow, password: string, ip: string): UserRow {
  if (!isValidPaymentPassword(password)) throw errors.validation("支付密码必须为 6 位数字");
  execute(
    `UPDATE users SET payment_pwd_hash = ?, payment_fail_count = 0, payment_fail_window_start = NULL,
     payment_locked_until = NULL, updated_at = ? WHERE id = ?`,
    hashPaymentPassword(password),
    nowIso(),
    user.id,
  );
  writeAudit({
    actorId: user.id,
    actorRole: "user",
    action: user.payment_pwd_hash ? "payment_password.changed" : "payment_password.created",
    targetType: "user",
    targetId: user.id,
    ip,
  });
  // 修改支付密码后所有动态码立即作废
  execute("DELETE FROM dynamic_codes WHERE user_id = ?", user.id);
  return findUserById(user.id) as UserRow;
}

export function requireUserFromContext(auth: AuthContext | undefined): UserRow {
  if (!auth) throw errors.unauthenticated();
  return auth.user;
}

// ---------------- 校验与展示辅助 ----------------

export function isValidEmailValue(value: string): boolean {
  return isValidEmail(value.trim());
}

export const ONBOARD_STEP_LABELS: Record<OnboardStep, string> = {
  name: "填写姓名",
  studentNo: "填写校学号",
  email: "验证邮箱",
  card: "绑定校园卡",
  password: "设置支付密码",
  done: "已完成注册",
};

/** 当前待完成步骤的提示文案（用于引导页标题） */
export function onboardStepLabel(step: OnboardStep): string {
  return ONBOARD_STEP_LABELS[step];
}

