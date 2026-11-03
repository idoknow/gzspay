/** 格式化与校验工具：金额（分↔元）、时间、脱敏、日期区间。 */

import { PAY_CHANNEL_LABELS, type OrderStatus, type PayChannel } from "./types";

/** 合并 className，过滤假值 */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}

/** 分 → 元字符串，保留两位小数 */
export function centsToYuan(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}${yuan}.${rest.toString().padStart(2, "0")}`;
}

/** 分 → 带千分位的元字符串 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (abs % 100).toString().padStart(2, "0");
  return `${sign}${yuan}.${rest}`;
}

/** 分 → 「¥12.34」 */
export function formatMoney(cents: number): string {
  return `¥${formatCents(cents)}`;
}

/** 元字符串 → 分；非法输入返回 null */
export function yuanToCents(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) return null;
  const [yuanPart, decimalPart = ""] = text.split(".");
  const yuan = Number(yuanPart ?? "0");
  const decimal = Number((decimalPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(yuan)) return null;
  const cents = yuan * 100 + decimal;
  if (cents <= 0) return null;
  return cents;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function asDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** 2026-10-31 */
export function formatDate(value: string | number | Date): string {
  const date = asDate(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 10-31 */
export function formatMonthDay(value: string | number | Date): string {
  const date = asDate(value);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 23:32 */
export function formatTime(value: string | number | Date): string {
  const date = asDate(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 2026-10-31 23:32 */
export function formatDateTime(value: string | number | Date): string {
  return `${formatDate(value)} ${formatTime(value)}`;
}

/** 2026年10月 */
export function formatYearMonth(value: string | number | Date): string {
  const date = asDate(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

/** 友好的相对时间：刚刚 / 12 分钟前 / 昨天 23:32 / 10-31 23:32 */
export function formatFriendlyTime(value: string | number | Date): string {
  const date = asDate(value);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return "";
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return `今天 ${formatTime(date)}`;
  if (date.getTime() >= startOfToday - 24 * hour) return `昨天 ${formatTime(date)}`;
  if (date.getFullYear() === now.getFullYear()) return `${formatMonthDay(date)} ${formatTime(date)}`;
  return formatDateTime(date);
}

/** 秒 → mm:ss */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

/** 姓名首字（默认头像） */
export function initialsOf(name: string | null | undefined): string {
  const text = (name ?? "").trim();
  if (!text) return "?";
  return Array.from(text)[0] ?? "?";
}

/** 学号脱敏：2023****01 */
export function maskStudentNo(studentNo: string | null | undefined): string {
  if (!studentNo) return "";
  const text = studentNo.trim();
  if (text.length <= 6) return text.replace(/.(?=.{2})/g, "*");
  return `${text.slice(0, 4)}${"*".repeat(Math.max(4, text.length - 6))}${text.slice(-2)}`;
}

/** 姓名脱敏：保留姓氏首字，其余用 ** 代替（如「陈**」） */
export function maskPersonName(name: string | null | undefined): string {
  const text = (name ?? "").trim();
  if (!text) return "";
  const head = Array.from(text)[0] ?? "";
  return `${head}**`;
}

/** 卡号脱敏：****1234 */
export function maskCardNo(cardNo: string | null | undefined): string {
  if (!cardNo) return "";
  const text = cardNo.trim();
  return text.length <= 4 ? text : `****${text.slice(-4)}`;
}

/** 校园卡号规则：8 位数字或字母，统一转大写 */
export function normalizeCardNo(value: string): string {
  return value.replace(/\s+/g, "").replace(/^gzspay:card:/i, "").toUpperCase();
}

export function isCardNo(value: string): boolean {
  return /^[A-Z0-9]{8}$/.test(normalizeCardNo(value));
}

/** 支付方式中文名 */
export function payChannelLabel(channel: PayChannel | null | undefined): string {
  return channel ? PAY_CHANNEL_LABELS[channel] : "";
}

/** 订单状态中文名 */
export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending_payment":
      return "待处理";
    case "paid":
      return "待确认";
    case "completed":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

/** 订单状态色调 */
export function orderStatusTone(status: OrderStatus): "warning" | "brand" | "success" | "muted" {
  switch (status) {
    case "pending_payment":
      return "warning";
    case "paid":
      return "brand";
    case "completed":
      return "success";
    default:
      return "muted";
  }
}

/** 订单状态筛选的中文名 */
export function orderFilterLabel(filter: "pending" | "paid" | "closed" | "all"): string {
  switch (filter) {
    case "pending":
      return "进行中";
    case "paid":
      return "待确认";
    case "closed":
      return "已结束";
    default:
      return "全部";
  }
}

/** 2026-10-31 */
export function toDateKey(date: Date): string {
  return formatDate(date);
}

/** 本地当天 00:00 */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 周一为一周开始 */
export function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  const day = start.getDay();
  const offset = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - offset);
  return start;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** 生成随机幂等键（下单防重复提交） */
export function randomIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // 降级到随机字符串
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 邮箱格式校验 */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** QQ 邮箱校验：只接受「纯数字 QQ 号@qq.com」，系统用它发验证码与通知 */
export function isQqEmail(value: string): boolean {
  return /^\d{5,12}@qq\.com$/i.test(value.trim());
}

/** 从输入中提取 QQ 号：允许只填数字，也兼容粘贴完整 QQ 邮箱 */
export function normalizeQqNumber(value: string): string {
  return value
    .trim()
    .replace(/@qq\.com$/i, "")
    .replace(/\D/g, "");
}

/** 纯 QQ 号校验（5–12 位数字），界面只让用户填这一段 */
export function isQqNumber(value: string): boolean {
  return /^\d{5,12}$/.test(normalizeQqNumber(value));
}

/** QQ 号 → QQ 邮箱 */
export function qqEmailOf(qq: string): string {
  return `${normalizeQqNumber(qq)}@qq.com`;
}

/** 站点品牌文案：配置了校名时显示「{校名}校园服务」，否则只显示「校园服务」 */
export function campusServiceLabel(schoolName?: string | null): string {
  const name = (schoolName ?? "").trim();
  return name ? `${name}校园服务` : "校园服务";
}

/** 站点品牌文案：配置了校名时显示「{校名}校园收付款」，否则只显示「校园收付款」 */
export function campusPaymentLabel(schoolName?: string | null): string {
  const name = (schoolName ?? "").trim();
  return name ? `${name}校园收付款` : "校园收付款";
}

/** 校学号格式校验（字母数字，4-20 位） */
export function isStudentNo(value: string): boolean {
  return /^[A-Za-z0-9]{4,20}$/.test(value.trim());
}

/** 6 位数字支付密码 */
export function isSixDigitPassword(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/** 6 位数字验证码 */
export function isSixDigitCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/** 简易金额输入过滤：只留数字与一个小数点，最多两位小数 */
export function sanitizeAmountInput(raw: string): string {
  let text = raw.replace(/[^\d.]/g, "");
  const dot = text.indexOf(".");
  if (dot >= 0) {
    text = `${text.slice(0, dot + 1)}${text.slice(dot + 1).replace(/\./g, "")}`;
    const [intPart = "", decimalPart = ""] = text.split(".");
    text = `${intPart.slice(0, 7)}.${decimalPart.slice(0, 2)}`;
  } else {
    text = text.slice(0, 7);
  }
  return text;
}
