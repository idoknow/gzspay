import nodemailer, { type Transporter } from "nodemailer";
import { config, isSmtpConfigured } from "../config.js";
import { reportSystemError } from "./alerts.js";
import { writeMailOutbox, writeSystemError } from "./audit.js";
import { readSystemConfig } from "./runtime-config.js";

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

// ---------------------------------------------------------------------------
// 邮件模板：纯文本 + HTML 双版本
// 说明：邮件客户端对 CSS 支持有限，这里只用 table 布局 + 行内样式，
// 不引用外部样式表、不使用 flex/grid，保证在 QQ 邮箱、微信、Gmail、Outlook
// 与手机端都能正常显示；深色模式用 color-scheme 声明，不强制反色。
// ---------------------------------------------------------------------------

/** 邮件强调色：brand=主色，success=成功，warning=提醒，danger=风险 */
export type EmailTone = "brand" | "success" | "warning" | "danger";

export interface EmailRow {
  label: string;
  value: string;
  /** 金额等需要强调的值 */
  strong?: boolean;
}

export interface EmailContent {
  /** 标题右侧的小标签，如「新订单」「安全提醒」 */
  badge?: string;
  tone?: EmailTone;
  title: string;
  /** 收件箱列表里显示的预览文字 */
  preheader?: string;
  intro?: string;
  rows?: EmailRow[];
  /** 验证码：居中大字显示 */
  code?: { value: string; hint?: string };
  paragraphs?: string[];
  /** 等宽文本块，如堆栈 */
  block?: { title?: string; text: string };
  note?: string;
  action?: { label: string; url: string };
}

const TONE_STYLES: Record<EmailTone, { fg: string; bg: string; border: string }> = {
  brand: { fg: "#1552d6", bg: "#e8f0ff", border: "#c9dcff" },
  success: { fg: "#0f7a54", bg: "#e6f7f0", border: "#bfe8d7" },
  warning: { fg: "#a5520b", bg: "#fff3e0", border: "#f5ddb7" },
  danger: { fg: "#b42318", bg: "#fdeceb", border: "#f6cfcc" },
};

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const MONO_STACK = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRows(rows: EmailRow[]): string {
  const cells = rows
    .map((row, index) => {
      const last = index === rows.length - 1;
      const border = last ? "" : "border-bottom:1px solid #eceee9;";
      const valueStyle = row.strong
        ? `font-size:16px;font-weight:700;color:#171a20;`
        : `font-size:14px;color:#171a20;`;
      return [
        `<tr>`,
        `<td width="38%" valign="top" style="padding:12px 14px;${border}background-color:#fafaf7;font-size:12px;line-height:1.6;color:#8a9085;font-family:${FONT_STACK};">${escapeHtml(row.label)}</td>`,
        `<td valign="top" style="padding:12px 14px;${border}background-color:#ffffff;${valueStyle}line-height:1.6;font-family:${FONT_STACK};word-break:break-all;">${escapeHtml(row.value)}</td>`,
        `</tr>`,
      ].join("");
    })
    .join("");
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`,
    ` style="margin:16px 0 6px;border:1px solid #eceee9;border-radius:14px;border-collapse:separate;overflow:hidden;">`,
    `<tbody>${cells}</tbody>`,
    `</table>`,
  ].join("");
}

/** 生成 HTML 版邮件正文（table 布局 + 行内样式） */
/** 站点品牌名：有校名时「XX校园服务」，否则「校园服务」 */
function siteBrandName(): string {
  try {
    const { schoolName } = readSystemConfig();
    return schoolName ? `${schoolName}校园服务` : "校园服务";
  } catch {
    return "校园服务";
  }
}

export function renderEmailHtml(content: EmailContent): string {
  const tone = TONE_STYLES[content.tone ?? "brand"];
  const baseUrl = escapeHtml(config.publicBaseUrl);
  const brandName = siteBrandName();
  const preheader = escapeHtml(content.preheader ?? content.intro ?? content.title);

  const blocks: string[] = [];
  if (content.intro) {
    blocks.push(
      `<p style="margin:0 0 4px;font-size:14px;line-height:1.8;color:#5c6357;">${escapeHtml(content.intro)}</p>`,
    );
  }
  if (content.rows && content.rows.length > 0) {
    blocks.push(renderRows(content.rows));
  }
  if (content.code) {
    const hint = content.code.hint
      ? `<div style="margin-top:10px;font-size:12px;line-height:1.6;color:#8a7a45;">${escapeHtml(content.code.hint)}</div>`
      : "";
    blocks.push(
      [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`,
        ` style="margin:18px 0 6px;border:1px solid #f3e3b4;border-radius:14px;background-color:#fff8e4;border-collapse:separate;">`,
        `<tr><td align="center" style="padding:20px 16px;">`,
        `<div style="font-family:${MONO_STACK};font-size:30px;line-height:1.2;font-weight:700;letter-spacing:8px;color:#171a20;">${escapeHtml(content.code.value)}</div>`,
        hint,
        `</td></tr></table>`,
      ].join(""),
    );
  }
  for (const paragraph of content.paragraphs ?? []) {
    blocks.push(
      `<p style="margin:12px 0 0;font-size:14px;line-height:1.8;color:#5c6357;">${escapeHtml(paragraph)}</p>`,
    );
  }
  if (content.block) {
    const title = content.block.title
      ? `<div style="margin-bottom:8px;font-size:12px;line-height:1.6;color:#8a9085;">${escapeHtml(content.block.title)}</div>`
      : "";
    blocks.push(
      [
        `<div style="margin:16px 0 6px;padding:14px;border:1px solid #eceee9;border-radius:12px;background-color:#f7f8f5;">`,
        title,
        `<pre style="margin:0;font-family:${MONO_STACK};font-size:12px;line-height:1.6;color:#3f463c;white-space:pre-wrap;word-break:break-word;">${escapeHtml(content.block.text)}</pre>`,
        `</div>`,
      ].join(""),
    );
  }
  if (content.action) {
    blocks.push(
      [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;">`,
        `<tr><td align="center" style="border-radius:12px;background-color:#1e6bff;">`,
        `<a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:13px 24px;font-size:14px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:12px;font-family:${FONT_STACK};">${escapeHtml(content.action.label)}</a>`,
        `</td></tr></table>`,
      ].join(""),
    );
  }
  if (content.note) {
    blocks.push(
      `<p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#8a9085;">${escapeHtml(content.note)}</p>`,
    );
  }

  const badge = content.badge
    ? `<td align="right" style="font-family:${FONT_STACK};"><span style="display:inline-block;padding:5px 11px;border-radius:999px;background-color:${tone.bg};border:1px solid ${tone.border};font-size:12px;line-height:1.4;font-weight:600;color:${tone.fg};">${escapeHtml(content.badge)}</span></td>`
    : `<td></td>`;

  return [
    `<!doctype html>`,
    `<html lang="zh-CN">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="x-apple-disable-message-reformatting">`,
    `<meta name="color-scheme" content="light">`,
    `<meta name="supported-color-schemes" content="light">`,
    `<title>${escapeHtml(content.title)}</title>`,
    `</head>`,
    `<body style="margin:0;padding:0;background-color:#f2f3f0;">`,
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f3f0;">`,
    `<tr><td align="center" style="padding:28px 12px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;border-collapse:separate;background-color:#ffffff;border:1px solid #e6e7e2;border-radius:20px;overflow:hidden;">`,
    `<tr><td style="padding:22px 26px 0 26px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td align="left" style="font-family:${FONT_STACK};font-size:18px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;color:#171a20;">`,
    `gzspay<span style="color:#1e6bff;">.</span>`,
    `<span style="margin-left:8px;font-size:12px;font-weight:500;color:#8a9085;">${escapeHtml(brandName)}</span>`,
    `</td>`,
    badge,
    `</tr></table>`,
    `</td></tr>`,
    `<tr><td style="padding:20px 26px 10px 26px;font-family:${FONT_STACK};">`,
    `<h1 style="margin:0 0 12px;font-size:21px;line-height:1.4;font-weight:700;color:#171a20;">${escapeHtml(content.title)}</h1>`,
    blocks.join("\n"),
    `</td></tr>`,
    `<tr><td style="padding:20px 26px 22px 26px;font-family:${FONT_STACK};">`,
    `<div style="border-top:1px solid #eceee9;padding-top:14px;font-size:12px;line-height:1.8;color:#8a9085;">`,
    `本邮件由系统自动发送，请勿直接回复。<br>`,
    `<a href="${baseUrl}" style="color:#5c6357;text-decoration:none;">${baseUrl}</a> · ${escapeHtml(brandName)}`,
    `</div>`,
    `</td></tr>`,
    `</table>`,
    `<div style="width:100%;max-width:560px;padding:14px 8px 0;font-family:${FONT_STACK};font-size:11px;line-height:1.7;color:#a3a89c;text-align:center;">`,
    `资金通过第三方收款码流转，gzspay 不代收代付。`,
    `</div>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ].join("\n");
}

/** 生成纯文本版邮件正文（不支持 HTML 的客户端与 mail_outbox 使用） */
export function renderEmailText(content: EmailContent): string {
  const lines: string[] = [content.title, ""];
  if (content.intro) lines.push(content.intro, "");
  for (const row of content.rows ?? []) lines.push(`${row.label}：${row.value}`);
  if (content.rows && content.rows.length > 0) lines.push("");
  if (content.code) {
    lines.push(`验证码：${content.code.value}`);
    if (content.code.hint) lines.push(content.code.hint);
    lines.push("");
  }
  for (const paragraph of content.paragraphs ?? []) lines.push(paragraph, "");
  if (content.block) {
    if (content.block.title) lines.push(content.block.title);
    lines.push(content.block.text, "");
  }
  if (content.action) lines.push(`${content.action.label}：${content.action.url}`, "");
  if (content.note) lines.push(content.note, "");
  lines.push("—— 本邮件由系统自动发送，请勿直接回复。", `访问地址：${config.publicBaseUrl}`);
  return lines.join("\n");
}

function buildMessage(params: {
  subject: string;
  kind: string;
  content: EmailContent;
  to?: string;
}): MailMessage {
  return {
    to: params.to ?? "",
    subject: params.subject,
    kind: params.kind,
    text: renderEmailText(params.content),
    html: renderEmailHtml(params.content),
  };
}

const templates = {
  verificationCode(code: string, scene: string): MailMessage {
    return buildMessage({
      subject: `【gzspay】${scene}验证码`,
      kind: "verification",
      content: {
        badge: "身份验证",
        tone: "brand",
        title: `${scene}验证码`,
        preheader: `${scene}验证码：${code}（10 分钟内有效）`,
        intro: `你正在${scene}，请在页面中输入下面的验证码完成验证。`,
        code: { value: code, hint: "10 分钟内有效，请勿泄露给他人" },
        note: "如非本人操作，请忽略本邮件，你的账号不会发生变化。",
      },
    });
  },
  newOrder(params: {
    to: string;
    orderNo: string;
    merchantName: string;
    payerName: string;
    amountCents: number;
    title: string;
  }): MailMessage {
    const amount = `￥${formatAmountYuan(params.amountCents)}`;
    return buildMessage({
      to: params.to,
      subject: `【gzspay】新订单 ${params.orderNo}`,
      kind: "new_order",
      content: {
        badge: "新订单",
        tone: "brand",
        title: "收到一笔新订单",
        preheader: `新订单 ${params.orderNo} · ${amount}`,
        intro: `${params.payerName} 提交了订单，请及时处理。`,
        rows: [
          { label: "订单号", value: params.orderNo },
          { label: "商家", value: params.merchantName },
          { label: "付款人", value: params.payerName },
          { label: "金额", value: amount, strong: true },
          { label: "付款内容", value: params.title },
        ],
        action: { label: "打开 gzspay 查看", url: config.publicBaseUrl },
        note: "资金通过第三方收款码流转，gzspay 不代收代付。",
      },
    });
  },
  paid(params: {
    to: string;
    orderNo: string;
    merchantName: string;
    payerName: string;
    amountCents: number;
  }): MailMessage {
    const amount = `￥${formatAmountYuan(params.amountCents)}`;
    return buildMessage({
      to: params.to,
      subject: `【gzspay】付款人已支付 ${params.orderNo}`,
      kind: "paid",
      content: {
        badge: "已标记支付",
        tone: "success",
        title: "付款人已标记支付",
        preheader: `订单 ${params.orderNo} 待确认收款`,
        intro: "付款人表示已完成付款，请核对第三方收款记录后确认收款。",
        rows: [
          { label: "订单号", value: params.orderNo },
          { label: "商家", value: params.merchantName },
          { label: "付款人", value: params.payerName },
          { label: "金额", value: amount, strong: true },
        ],
        action: { label: "打开 gzspay 确认收款", url: config.publicBaseUrl },
        note: "请以支付宝 / 微信 / QQ 的实际到账记录为准。",
      },
    });
  },
  settled(params: {
    to: string;
    orderNo: string;
    statusText: string;
    amountCents: number;
    merchantName: string;
  }): MailMessage {
    const amount = `￥${formatAmountYuan(params.amountCents)}`;
    const cancelled = params.statusText.includes("取消");
    return buildMessage({
      to: params.to,
      subject: `【gzspay】订单${params.statusText} ${params.orderNo}`,
      kind: "settled",
      content: {
        badge: params.statusText,
        tone: cancelled ? "warning" : "success",
        title: `订单${params.statusText}`,
        preheader: `订单 ${params.orderNo} ${params.statusText}`,
        intro: `订单 ${params.orderNo} 的结果是「${params.statusText}」。`,
        rows: [
          { label: "订单号", value: params.orderNo },
          { label: "商家", value: params.merchantName },
          { label: "金额", value: amount, strong: true },
          { label: "结果", value: params.statusText },
        ],
        action: { label: "打开 gzspay 查看详情", url: config.publicBaseUrl },
        note: "如有疑问，可在交易列表里找到这笔订单查看完整记录。",
      },
    });
  },
  passwordChanged(to: string): MailMessage {
    return buildMessage({
      to,
      subject: "【gzspay】支付密码已修改",
      kind: "security",
      content: {
        badge: "安全提醒",
        tone: "warning",
        title: "支付密码已修改",
        preheader: "你的支付密码刚刚被修改，动态收付款码已失效",
        intro: "你的支付密码刚刚被修改，所有动态收付款码已失效。",
        paragraphs: ["如果不是你本人操作，请立即用邮箱验证码重置密码，并联系管理员。"],
        action: { label: "打开账号安全", url: `${config.publicBaseUrl}/me/password` },
        note: "本邮件只做安全提醒，不会包含任何密码或验证码。",
      },
    });
  },
  paymentLocked(to: string): MailMessage {
    return buildMessage({
      to,
      subject: "【gzspay】支付密码连续错误提醒",
      kind: "security",
      content: {
        badge: "安全提醒",
        tone: "danger",
        title: "支付密码连续输入错误",
        preheader: "账户的支付功能已被临时锁定",
        intro: "你的支付密码连续输入错误，账户的支付功能已被临时锁定。",
        paragraphs: ["锁定会在 30 分钟后自动解除；如果不是你本人操作，请尽快重置支付密码。"],
        action: { label: "重置支付密码", url: `${config.publicBaseUrl}/me/password` },
        note: "如持续出现陌生尝试，请联系管理员检查账号安全。",
      },
    });
  },
  adminCode(to: string, code: string): MailMessage {
    return buildMessage({
      to,
      subject: "【gzspay 管理后台】登录验证码",
      kind: "security",
      content: {
        badge: "管理后台",
        tone: "brand",
        title: "管理后台登录验证码",
        preheader: `管理后台登录验证码：${code}（10 分钟内有效）`,
        intro: "请在管理后台登录页输入下面的验证码。",
        code: { value: code, hint: "10 分钟内有效" },
        note: "如非本人操作，请忽略本邮件，并联系超级管理员检查后台账号。",
      },
    });
  },
  accountFrozen(to: string, frozen: boolean): MailMessage {
    return buildMessage({
      to,
      subject: frozen ? "【gzspay】账号已被冻结" : "【gzspay】账号已恢复",
      kind: "security",
      content: {
        badge: "账号状态",
        tone: frozen ? "danger" : "success",
        title: frozen ? "账号已被冻结" : "账号已恢复",
        preheader: frozen ? "你的账号已被管理员冻结" : "你的账号已恢复正常",
        intro: frozen
          ? "你的 gzspay 账号已被管理员冻结，暂时无法登录或交易。"
          : "你的 gzspay 账号已恢复正常，可以继续使用。",
        note: "如有疑问，请联系管理员。",
      },
    });
  },
};

export { templates };
