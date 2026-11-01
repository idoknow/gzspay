import nodemailer, { type Transporter } from "nodemailer";
import { config, isSmtpConfigured } from "../config.js";
import { reportSystemError } from "./alerts.js";
import { writeMailOutbox, writeSystemError } from "./audit.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtp.host ?? "localhost",
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth:
      config.smtp.user && config.smtp.pass
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
  });
  return transporter;
}

/** 配置变更后丢弃缓存的 SMTP 连接 */
export function resetTransporter(): void {
  transporter = null;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  kind?: string;
}

/**
 * 发送邮件：
 * - 未配置 SMTP 时落到 mail_outbox（开发/测试环境可查看内容，不真正发送）
 * - 发送失败不抛出，返回 delivered=false 并记录系统错误
 */
export async function sendMail(message: MailMessage): Promise<{ delivered: boolean }> {
  const kind = message.kind ?? "general";
  if (!isSmtpConfigured()) {
    writeMailOutbox({
      to: message.to,
      subject: message.subject,
      text: message.text,
      kind,
      status: "queued",
    });
    return { delivered: false };
  }
  try {
    await getTransporter().sendMail({
      from: config.smtp.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    writeMailOutbox({
      to: message.to,
      subject: message.subject,
      text: message.text,
      kind,
      status: "sent",
    });
    return { delivered: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeMailOutbox({
      to: message.to,
      subject: message.subject,
      text: message.text,
      kind,
      status: "failed",
      error: reason,
    });
    // 告警邮件自身失败只记录，不再触发新一轮告警，避免递归
    if (kind === "system_alert") {
      writeSystemError({
        scope: "mail",
        message: `告警邮件发送失败：${reason}`,
        context: `kind=${kind}`,
      });
    } else {
      reportSystemError({
        scope: "mail",
        message: `邮件发送失败：${reason}`,
        context: `kind=${kind}`,
      });
    }
    return { delivered: false };
  }
}

/** 后台异步发送，避免阻塞请求 */
export function sendMailInBackground(message: MailMessage): void {
  void sendMail(message).catch(() => undefined);
}

export function formatAmountYuan(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

function wrap(body: string): string {
  return [
    "gzspay 校园支付",
    "",
    body,
    "",
    "—— 本邮件由系统自动发送，请勿直接回复。",
    `访问地址：${config.publicBaseUrl}`,
  ].join("\n");
}

const templates = {
  verificationCode(code: string, scene: string): MailMessage {
    return {
      to: "",
      subject: `【gzspay】${scene}验证码`,
      kind: "verification",
      text: wrap(
        `你正在${scene}，验证码为：${code}。\n验证码 10 分钟内有效，请勿泄露给他人。如非本人操作，请忽略本邮件。`,
      ),
    };
  },
  newOrder(params: {
    to: string;
    orderNo: string;
    merchantName: string;
    payerName: string;
    amountCents: number;
    title: string;
  }): MailMessage {
    return {
      to: params.to,
      subject: `【gzspay】新订单 ${params.orderNo}`,
      kind: "new_order",
      text: wrap(
        [
          `订单号：${params.orderNo}`,
          `商家：${params.merchantName}`,
          `付款人：${params.payerName}`,
          `金额：￥${formatAmountYuan(params.amountCents)}`,
          `内容：${params.title}`,
          "",
          "对方已提交订单，请及时前往 gzspay 查看。",
        ].join("\n"),
      ),
    };
  },
  paid(params: {
    to: string;
    orderNo: string;
    merchantName: string;
    payerName: string;
    amountCents: number;
  }): MailMessage {
    return {
      to: params.to,
      subject: `【gzspay】付款人已支付 ${params.orderNo}`,
      kind: "paid",
      text: wrap(
        [
          `订单号：${params.orderNo}`,
          `商家：${params.merchantName}`,
          `付款人：${params.payerName}`,
          `金额：￥${formatAmountYuan(params.amountCents)}`,
          "",
          "付款人已标记支付，请核对第三方收款记录后确认收款。",
        ].join("\n"),
      ),
    };
  },
  settled(params: {
    to: string;
    orderNo: string;
    statusText: string;
    amountCents: number;
    merchantName: string;
  }): MailMessage {
    return {
      to: params.to,
      subject: `【gzspay】订单${params.statusText} ${params.orderNo}`,
      kind: "settled",
      text: wrap(
        [
          `订单号：${params.orderNo}`,
          `商家：${params.merchantName}`,
          `金额：￥${formatAmountYuan(params.amountCents)}`,
          `结果：${params.statusText}`,
          "",
          "可登录 gzspay 查看订单详情。",
        ].join("\n"),
      ),
    };
  },
  passwordChanged(to: string): MailMessage {
    return {
      to,
      subject: "【gzspay】支付密码已修改",
      kind: "security",
      text: wrap(
        "你的支付密码刚刚被修改，所有动态收付款码已失效。如果不是你本人操作，请立即通过邮箱验证码重置密码并联系管理员。",
      ),
    };
  },
  paymentLocked(to: string): MailMessage {
    return {
      to,
      subject: "【gzspay】支付密码连续错误提醒",
      kind: "security",
      text: wrap(
        "你的支付密码连续输入错误，账户支付功能已被临时锁定。如果不是你本人操作，请尽快重置支付密码。",
      ),
    };
  },
  adminCode(to: string, code: string): MailMessage {
    return {
      to,
      subject: "【gzspay 管理后台】登录验证码",
      kind: "security",
      text: wrap(`管理后台登录验证码为：${code}。10 分钟内有效。如非本人操作，请立即联系超级管理员。`),
    };
  },
  accountFrozen(to: string, frozen: boolean): MailMessage {
    return {
      to,
      subject: frozen ? "【gzspay】账号已被冻结" : "【gzspay】账号已恢复",
      kind: "security",
      text: wrap(
        frozen
          ? "你的 gzspay 账号已被管理员冻结，暂时无法登录或交易。如有疑问，请联系管理员。"
          : "你的 gzspay 账号已恢复正常，可以继续使用。",
      ),
    };
  },
};

export { templates };
