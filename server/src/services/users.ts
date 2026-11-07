import { config } from "../config.js";
import { execute, isoAfter, nowIso, queryOne, transaction } from "../db/index.js";
import { writeAudit, writeRiskLog } from "../lib/audit.js";
import { avatarPathOf, qqAvatarUrl } from "../lib/avatar.js";
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
import { describeUserAgent } from "./devices.js";

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
    avatarUrl: avatarPathOf(user),
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
    `INSERT INTO notification_settings
       (user_id, new_order, paid, settled, ticket, announcement, profile, password, login)
     VALUES (?, 1, 1, 1, 1, 1, 1, 1, 1)`,
    userId,
  );
  return {
    user_id: userId,
    new_order: 1,
    paid: 1,
    settled: 1,
    ticket: 1,
    announcement: 1,
    profile: 1,
    password: 1,
    login: 1,
  };
}

export type NotificationSettingKey =
  | "new_order"
  | "paid"
  | "settled"
  | "ticket"
  | "announcement"
  | "profile"
  | "password"
  | "login";

/**
 * 按用户的通知开关发邮件：没有邮箱、或对应开关关闭时直接跳过。
 * 邮件在后台发送，失败只写系统错误日志，不影响主流程。
 */
export function mailUserWithSetting(
  userId: string,
  message: Parameters<typeof sendMailInBackground>[0],
  setting: NotificationSettingKey,
): void {
  const user = findUserById(userId);
  if (!user?.email) return;
  const settings = ensureNotificationSettings(userId);
  if (settings[setting] !== 1) return;
  sendMailInBackground({ ...message, to: user.email });
}

/** 「个人信息修改」邮件里列出的字段，顺序即邮件中的展示顺序 */
export type ProfileChangeField = "name" | "studentNo" | "email" | "card";

const PROFILE_CHANGE_LABELS: Record<ProfileChangeField, string> = {
  name: "姓名",
  studentNo: "学号",
  email: "邮箱",
  card: "校园卡号",
};

/**
 * 个人信息修改成功后发提醒邮件（受「个人信息修改」开关控制）。
 * 字段值没有真正变化时（changed 为空）不发信，避免重复提交也收到提醒。
 */
export function notifyProfileChanged(
  user: UserRow,
  changed: ProfileChangeField[],
  ip: string,
): void {
  if (changed.length === 0) return;
  const fields = changed.map((field) => PROFILE_CHANGE_LABELS[field]);
  mailUserWithSetting(
    user.id,
    templates.profileChanged({ fields, ip, at: nowIso() }),
    "profile",
  );
}

/** 登录成功后发登录提醒邮件（受「登录通知」开关控制），含时间、IP 与设备简述。 */
export function notifyLogin(user: UserRow, params: { ip: string; userAgent: string | null }): void {
  const device = describeUserAgent(params.userAgent);
  mailUserWithSetting(
    user.id,
    templates.login({
      at: nowIso(),
      ip: params.ip,
      device: `${device.deviceName} · ${device.os} · ${device.browser}`,
    }),
    "login",
  );
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
    cardNo: user.card_no,
    cardNoMasked: maskCardNo(user.card_no),
    avatarUrl: avatarPathOf(user),
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
      ticket: notification.ticket === 1,
      announcement: notification.announcement === 1,
      profile: notification.profile === 1,
      password: notification.password === 1,
      login: notification.login === 1,
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
    const nextQq = identity.qq ?? existing.qq;
    execute(
      "UPDATE users SET qq = ?, campux_username = ?, avatar_url = ?, last_login_at = ?, updated_at = ? WHERE id = ?",
      nextQq,
      identity.username ?? existing.campux_username,
      qqAvatarUrl(nextQq) ?? existing.avatar_url,
      nowIso(),
      nowIso(),
      existing.id,
    );
    ensureNotificationSettings(existing.id);
    const updated = findUserById(existing.id) as UserRow;
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
  const avatarUrl = qqAvatarUrl(identity.qq);
  transaction(() => {
    execute(
      `INSERT INTO users (id, campux_sub, qq, campux_username, avatar_url, onboard_step, onboarded, status, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, 'name', 0, 'active', ?, ?, ?)`,
      userId,
      identity.sub,
      identity.qq,
      identity.username,
      avatarUrl,
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
  if (!cardNo) throw errors.validation("未能识别校园卡号，卡号应为 8 位数字或字母");
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
  if (!cardNo) throw errors.validation("校园卡无法识别，卡号应为 8 位数字或字母");
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
  options: {
    /**
     * 是否把错误计入账号的锁定计数。
     *
     * 代输场景（商家在自己的手机上让客户输入密码、商家扫码代客户创建订单）必须
     * 传 false：否则商家可以反复试错把客户账号锁死 30 分钟（Do S）。
     */
    countFailure?: boolean;
  } = {},
): UserRow {
  const countFailure = options.countFailure ?? true;
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

  if (!countFailure) {
    // 代输：只记风险日志，不累计到客户账号的锁定计数
    writeRiskLog({
      userId: user.id,
      type: "payment_password_wrong_proxy",
      detail: "他人代输支付密码错误（不计入锁定次数）",
      ip,
    });
    throw errors.paymentPasswordWrong(config.security.paymentMaxAttempts);
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

/**
 * 绑定邮箱只支持 QQ 邮箱，且 QQ 号必须是纯数字（如 123456789@qq.com）。
 * 校园场景里同学基本都用 QQ 邮箱，统一后缀也能避免把验证码发到不常用的邮箱。
 */
export function isQqEmailValue(value: string): boolean {
  return /^\d{5,12}@qq\.com$/i.test(value.trim());
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

