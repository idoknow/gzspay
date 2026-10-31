/**
 * 管理后台格式化工具：金额分转元、本地时区时间、中文枚举文案等。
 */

const amountFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});

const compactAmountFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 分 → 「¥1,234.56」 */
export function formatCents(cents: number | null | undefined): string {
  const value = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return `¥${amountFormatter.format(value / 100)}`;
}

/** 分 → 「1,234.56」（不带币种，用于输入框/CSV） */
export function formatCentsPlain(cents: number | null | undefined): string {
  const value = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return amountFormatter.format(value / 100);
}

/** 分 → 紧凑金额：「¥12.34万」「¥1,234.56」 */
export function formatCentsCompact(cents: number | null | undefined): string {
  const value = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  const yuan = value / 100;
  if (Math.abs(yuan) >= 100000000) {
    return `¥${compactAmountFormatter.format(yuan / 100000000)}亿`;
  }
  if (Math.abs(yuan) >= 10000) {
    return `¥${compactAmountFormatter.format(yuan / 10000)}万`;
  }
  return formatCents(value);
}

/** 元（字符串/数字）→ 分；非法返回 null */
export function parseYuanToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const yuan = Number(trimmed);
  if (!Number.isFinite(yuan) || yuan < 0) return null;
  return Math.round(yuan * 100);
}

/** 整数千分位 */
export function formatNumber(value: number | null | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return integerFormatter.format(n);
}

/** 百分比展示，传入 0-100 */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ISO → 本地时间「2026-10-31 23:32」 */
export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** ISO → 本地时间「23:32」 */
export function formatTime(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** ISO → 本地日期「2026-10-31」 */
export function formatDate(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 距离现在的相对时间，用于日志/待处理事项 */
export function formatRelative(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "刚刚";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`;
  if (diffMs < 30 * day) return `${Math.floor(diffMs / day)} 天前`;
  return formatDate(value);
}

/** 趋势桶键 → 图上短标签 */
export function trendLabel(key: string): string {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(key);
  if (monthMatch) return `${Number(monthMatch[2])}月`;
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (dayMatch) return `${Number(dayMatch[2])}/${Number(dayMatch[3])}`;
  return key;
}

/** 月键 2026-01 → 「2026年1月」 */
export function formatMonthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  return `${match[1]}年${Number(match[2])}月`;
}

/** 分钟 → 「12 分 30 秒」/「45 秒」 */
export function formatDuration(minutes: number | null | undefined): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) {
    return "—";
  }
  const totalSeconds = Math.round(minutes * 60);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const mins = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (mins < 60) return seconds === 0 ? `${mins} 分钟` : `${mins} 分 ${seconds} 秒`;
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  return restMinutes(hours, restMins);
}

function restMinutes(hours: number, minutes: number): string {
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

/** 字节 → 人类可读大小 */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex] ?? "B"}`;
}

/** 秒 → 「60 秒」/「10 分钟」/「7 天」 */
export function formatTtlSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时`;
  return `${Math.round(seconds / 86400)} 天`;
}

/** ISO → datetime-local 输入框值（本地时区） */
export function toDateTimeInputValue(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** ISO/日期 → date 输入框值（本地时区） */
export function toDateInputValue(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** date 输入框值 → 当天 00:00 的 ISO（本地） */
export function fromDateInputStart(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** date 输入框值 → 当天 23:59:59 的 ISO（本地） */
export function fromDateInputEnd(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** datetime-local 输入框值 → ISO（本地时区） */
export function fromDateTimeInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 订单状态中文文案 */
export function orderStatusLabel(status: string): string {
  switch (status) {
    case "pending_payment":
      return "待付款";
    case "paid":
      return "已支付";
    case "completed":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return "未知状态";
  }
}

export function orderStatusTone(status: string): "warning" | "primary" | "success" | "neutral" {
  switch (status) {
    case "pending_payment":
      return "warning";
    case "paid":
      return "primary";
    case "completed":
      return "success";
    default:
      return "neutral";
  }
}

/** 付款渠道中文文案 */
export function payChannelLabel(channel: string | null): string {
  switch (channel) {
    case "alipay":
      return "支付宝";
    case "wechat":
      return "微信";
    case "qq":
      return "QQ 钱包";
    default:
      return "—";
  }
}

/** 管理员角色文案 */
export function roleLabel(role: string): string {
  switch (role) {
    case "super":
      return "超级管理员";
    case "ops":
      return "运营";
    case "auditor":
      return "只读审计";
    default:
      return "未知角色";
  }
}

export function roleTone(role: string): "danger" | "primary" | "neutral" {
  switch (role) {
    case "super":
      return "danger";
    case "ops":
      return "primary";
    default:
      return "neutral";
  }
}

/** 申诉状态文案 */
export function appealStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "待处理";
    case "resolved":
      return "已处理";
    case "rejected":
      return "已驳回";
    default:
      return "未知";
  }
}

export function appealStatusTone(
  status: string,
): "warning" | "success" | "neutral" | "danger" {
  switch (status) {
    case "pending":
      return "warning";
    case "resolved":
      return "success";
    case "rejected":
      return "danger";
    default:
      return "neutral";
  }
}

/** 日志页签文案 */
export function logTypeLabel(type: string): string {
  switch (type) {
    case "audit":
      return "操作日志";
    case "login":
      return "登录日志";
    case "risk":
      return "风控日志";
    case "error":
      return "系统错误";
    default:
      return "日志";
  }
}

/** 服务健康状态文案 */
export function serviceHealthLabel(status: string): string {
  switch (status) {
    case "up":
      return "正常";
    case "degraded":
      return "降级";
    case "down":
      return "异常";
    default:
      return "未知";
  }
}

export function serviceHealthTone(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "up":
      return "success";
    case "degraded":
      return "warning";
    case "down":
      return "danger";
    default:
      return "neutral";
  }
}

/** 公告展示状态（按生效/失效时间计算） */
export function announcementStatus(
  startsAt: string | null,
  endsAt: string | null,
): { label: string; tone: "warning" | "success" | "neutral" } {
  const now = Date.now();
  const start = startsAt ? new Date(startsAt).getTime() : null;
  const end = endsAt ? new Date(endsAt).getTime() : null;
  if (start !== null && Number.isFinite(start) && now < start) {
    return { label: "未生效", tone: "warning" };
  }
  if (end !== null && Number.isFinite(end) && now > end) {
    return { label: "已失效", tone: "neutral" };
  }
  return { label: "生效中", tone: "success" };
}

/** 日志级别文案与色系 */
export function logLevelMeta(level: string | null): {
  label: string;
  tone: "neutral" | "primary" | "warning" | "danger";
} {
  switch ((level ?? "").toLowerCase()) {
    case "info":
      return { label: "信息", tone: "primary" };
    case "warn":
    case "warning":
      return { label: "警告", tone: "warning" };
    case "error":
    case "fatal":
      return { label: "错误", tone: "danger" };
    default:
      return { label: level ?? "—", tone: "neutral" };
  }
}

/** 今天的日期键（本地时区） */
export function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** 导出文件默认名：orders-2026-10-31.csv */
export function exportFileName(prefix: string): string {
  return `${prefix}-${todayKey()}.csv`;
}
