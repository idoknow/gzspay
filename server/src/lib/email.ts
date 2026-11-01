import { canExposeDevCode, config } from "../config.js";
import { execute, isoAfter, nowIso, queryOne } from "../db/index.js";
import { writeRiskLog } from "./audit.js";
import { generateNumericCode, hashEmailCode, newId, verifyEmailCodeHash } from "./crypto.js";
import { errors } from "./errors.js";
import { sendMail, templates } from "./mail.js";
import type { UserRow } from "./types.js";

export type EmailCodePurpose = "email_verify" | "email_change" | "password_reset";

interface EmailCodeRow {
  id: string;
  user_id: string;
  purpose: EmailCodePurpose;
  email: string;
  code_hash: string;
  attempts: number;
  consumed_at: string | null;
  created_at: string;
  expires_at: string;
}

export interface IssuedEmailCode {
  sent: boolean;
  expiresAt: string;
  resendAfterSeconds: number;
  /** 仅开发环境返回，方便本地联调 */
  devCode?: string;
}

const SCENE_LABELS: Record<EmailCodePurpose, string> = {
  email_verify: "绑定邮箱",
  email_change: "更换邮箱",
  password_reset: "重置支付密码",
};

/** 发送邮箱验证码：同用途 60 秒内只能发一次，旧验证码立即失效 */
export async function issueEmailCode(params: {
  user: UserRow;
  purpose: EmailCodePurpose;
  email: string;
  scene?: string;
}): Promise<IssuedEmailCode> {
  const now = nowIso();
  const latest = queryOne<{ created_at: string }>(
    "SELECT created_at FROM email_codes WHERE user_id = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1",
    params.user.id,
    params.purpose,
  );
  if (latest && Date.now() - Date.parse(latest.created_at) < config.security.emailCodeResendSeconds * 1000) {
    throw errors.rateLimited("验证码发送过于频繁，请稍后再试");
  }

  // 同用途旧验证码全部作废，只保留最新一个
  execute(
    "UPDATE email_codes SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL",
    now,
    params.user.id,
    params.purpose,
  );

  const code = generateNumericCode(6);
  const expiresAt = isoAfter(config.security.emailCodeTtlMinutes * 60);
  execute(
    `INSERT INTO email_codes (id, user_id, purpose, email, code_hash, attempts, consumed_at, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    newId(),
    params.user.id,
    params.purpose,
    params.email,
    hashEmailCode(code),
    now,
    expiresAt,
  );

  const scene = params.scene ?? SCENE_LABELS[params.purpose];
  const mail = templates.verificationCode(code, scene);
  mail.to = params.email;
  const result = await sendMail(mail);

  const issued: IssuedEmailCode = {
    sent: result.delivered,
    expiresAt,
    resendAfterSeconds: config.security.emailCodeResendSeconds,
  };
  if (canExposeDevCode()) issued.devCode = code;
  return issued;
}

/** 校验并消费验证码；失败次数超过阈值后必须重新获取 */
export function consumeEmailCode(params: {
  userId: string;
  purpose: EmailCodePurpose;
  code: string;
  ip?: string;
}): EmailCodeRow {
  const row = queryOne<EmailCodeRow>(
    `SELECT * FROM email_codes
     WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    params.userId,
    params.purpose,
  );
  if (!row) throw errors.validation("验证码不存在或已失效，请重新获取");
  if (row.expires_at <= nowIso()) throw errors.validation("验证码已过期，请重新获取");
  if (row.attempts >= config.security.emailCodeMaxAttempts) {
    throw errors.validation("验证码错误次数过多，请重新获取");
  }
  if (!verifyEmailCodeHash(params.code, row.code_hash)) {
    execute("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?", row.id);
    writeRiskLog({
      userId: params.userId,
      type: "email_code_wrong",
      detail: `验证码校验失败（purpose=${params.purpose}）`,
      ip: params.ip ?? null,
    });
    const remaining = Math.max(0, config.security.emailCodeMaxAttempts - row.attempts - 1);
    throw errors.validation(`验证码错误，还可尝试 ${remaining} 次`);
  }
  execute("UPDATE email_codes SET consumed_at = ? WHERE id = ?", nowIso(), row.id);
  return row;
}

/** 最近一次验证码对应的邮箱（换邮箱时需要知道是发给哪个地址的） */
export function latestCodeEmail(userId: string, purpose: EmailCodePurpose): string | null {
  const row = queryOne<{ email: string }>(
    "SELECT email FROM email_codes WHERE user_id = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1",
    userId,
    purpose,
  );
  return row?.email ?? null;
}
