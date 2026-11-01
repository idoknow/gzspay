import { nowIso, queryAll, queryOne } from "../db/index.js";
import { toCsv } from "../lib/audit.js";
import { errors } from "../lib/errors.js";
import type { Channel, OrderRow, UserRow } from "../lib/types.js";
import { CHANNELS, CHANNEL_LABELS } from "../lib/types.js";

export interface DateRange {
  from: string;
  to: string;
}

function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function parseRange(fromValue?: string, toValue?: string): DateRange {
  const fallback = defaultRange();
  const from = fromValue ? new Date(fromValue) : new Date(fallback.from);
  const to = toValue ? new Date(toValue) : new Date(fallback.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw errors.validation("时间范围格式不正确");
  }
  if (from.getTime() > to.getTime()) throw errors.validation("开始时间不能晚于结束时间");
  return { from: from.toISOString(), to: to.toISOString() };
}

/** 与给定区间等长的上一个相邻区间（用于环比） */
export function previousRange(range: DateRange): DateRange {
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  const span = Math.max(to - from, 0);
  const previousTo = from - 1;
  const previousFrom = Math.max(0, previousTo - span);
  if (previousTo <= 0) return { from: new Date(0).toISOString(), to: new Date(0).toISOString() };
  return { from: new Date(previousFrom).toISOString(), to: new Date(previousTo).toISOString() };
}

function statusesFor(includePending: boolean): string[] {
  return includePending ? ["completed", "paid"] : ["completed"];
}

interface AmountTotals {
  total: number;
  count: number;
  max: number;
}

function amountTotals(
  userId: string,
  range: DateRange,
  statuses: string[],
  role: "payer" | "merchant",
): AmountTotals {
  const placeholders = statuses.map(() => "?").join(",");
  const column = role === "payer" ? "payer_id" : "merchant_id";
  const row = queryOne<{ total: number | null; count: number; max: number | null }>(
    `SELECT SUM(amount_cents) AS total, COUNT(*) AS count, MAX(amount_cents) AS max FROM orders
     WHERE ${column} = ? AND created_at >= ? AND created_at <= ? AND status IN (${placeholders})`,
    userId,
    range.from,
    range.to,
    ...(statuses as never[]),
  );
  return {
    total: row?.total ?? 0,
    count: row?.count ?? 0,
    max: row?.max ?? 0,
  };
}

export interface PreviousStats {
  expenseCents: number;
  incomeCents: number;
  orderCount: number;
}

export interface ChannelStat {
  channel: Channel;
  label: string;
  count: number;
  amountCents: number;
}

export interface HourStat {
  hour: number;
  count: number;
  amountCents: number;
}

export interface StatsSummary {
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  orderCount: number;
  /** 支出 / 收入笔数 */
  expenseCount: number;
  incomeCount: number;
  /** 平均每笔金额（支出 + 收入合计） */
  avgOrderCents: number;
  /** 区间内最大单笔金额 */
  maxOrderCents: number;
  /** 上一个等长区间的汇总，用于环比 */
  previous: PreviousStats;
  /** 已支付订单的收款方式分布 */
  channels: ChannelStat[];
  /** 0–23 时（服务器本地时间）的交易分布 */
  hours: HourStat[];
}

/** 已支付订单按收款方式聚合 */
function channelDistribution(
  userId: string,
  range: DateRange,
  statuses: string[],
): ChannelStat[] {
  const placeholders = statuses.map(() => "?").join(",");
  const rows = queryAll<{ channel: string | null; count: number; amount: number | null }>(
    `SELECT pay_channel AS channel, COUNT(*) AS count, SUM(amount_cents) AS amount FROM orders
     WHERE created_at >= ? AND created_at <= ? AND status IN (${placeholders})
       AND pay_channel IS NOT NULL AND (payer_id = ? OR merchant_id = ?)
     GROUP BY pay_channel`,
    range.from,
    range.to,
    ...(statuses as never[]),
    userId,
    userId,
  );
  const map = new Map(rows.map((row) => [row.channel ?? "", row]));
  return CHANNELS.map((channel) => {
    const row = map.get(channel);
    return {
      channel,
      label: CHANNEL_LABELS[channel],
      count: row?.count ?? 0,
      amountCents: row?.amount ?? 0,
    };
  });
}

/** 按小时聚合（服务器本地时区） */
function hourDistribution(
  userId: string,
  range: DateRange,
  statuses: string[],
): HourStat[] {
  const placeholders = statuses.map(() => "?").join(",");
  const hours: HourStat[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: 0,
    amountCents: 0,
  }));
  const rows = queryAll<{ created_at: string; amount_cents: number }>(
    `SELECT created_at, amount_cents FROM orders
     WHERE created_at >= ? AND created_at <= ? AND status IN (${placeholders})
       AND (payer_id = ? OR merchant_id = ?)`,
    range.from,
    range.to,
    ...(statuses as never[]),
    userId,
    userId,
  );
  for (const row of rows) {
    const hour = new Date(row.created_at).getHours();
    const bucket = hours[hour];
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amountCents += row.amount_cents;
  }
  return hours;
}

export function statsSummary(user: UserRow, range: DateRange, includePending: boolean): StatsSummary {
  const statuses = statusesFor(includePending);
  const expense = amountTotals(user.id, range, statuses, "payer");
  const income = amountTotals(user.id, range, statuses, "merchant");
  const before = previousRange(range);
  const previousExpense = amountTotals(user.id, before, statuses, "payer");
  const previousIncome = amountTotals(user.id, before, statuses, "merchant");
  const orderCount = expense.count + income.count;
  const totalCents = expense.total + income.total;
  return {
    expenseCents: expense.total,
    incomeCents: income.total,
    netCents: income.total - expense.total,
    orderCount,
    expenseCount: expense.count,
    incomeCount: income.count,
    avgOrderCents: orderCount > 0 ? Math.round(totalCents / orderCount) : 0,
    maxOrderCents: Math.max(expense.max, income.max),
    previous: {
      expenseCents: previousExpense.total,
      incomeCents: previousIncome.total,
      orderCount: previousExpense.count + previousIncome.count,
    },
    channels: channelDistribution(user.id, range, statuses),
    hours: hourDistribution(user.id, range, statuses),
  };
}

export interface TimeseriesBucket {
  key: string;
  expenseCents: number;
  incomeCents: number;
  expenseCount: number;
  incomeCount: number;
}

function bucketKey(date: Date, granularity: "day" | "month"): string {
  const iso = date.toISOString();
  return granularity === "day" ? iso.slice(0, 10) : iso.slice(0, 7);
}

function enumerateKeys(range: DateRange, granularity: "day" | "month"): string[] {
  const keys: string[] = [];
  const cursor = new Date(range.from);
  const end = new Date(range.to);
  if (granularity === "day") {
    cursor.setUTCHours(0, 0, 0, 0);
    while (cursor.getTime() <= end.getTime() + 24 * 60 * 60 * 1000 && keys.length < 400) {
      keys.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return keys;
  }
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime() && keys.length < 120) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

export function statsTimeseries(
  user: UserRow,
  range: DateRange,
  granularity: "day" | "month",
  includePending: boolean,
): TimeseriesBucket[] {
  const statuses = statusesFor(includePending);
  const placeholders = statuses.map(() => "?").join(",");
  const buckets = new Map<string, TimeseriesBucket>();
  for (const key of enumerateKeys(range, granularity)) {
    buckets.set(key, { key, expenseCents: 0, incomeCents: 0, expenseCount: 0, incomeCount: 0 });
  }
  const rows = queryAll<{ created_at: string; amount_cents: number; payer_id: string; merchant_id: string }>(
    `SELECT created_at, amount_cents, payer_id, merchant_id FROM orders
     WHERE created_at >= ? AND created_at <= ? AND status IN (${placeholders})
       AND (payer_id = ? OR merchant_id = ?)`,
    range.from,
    range.to,
    ...(statuses as never[]),
    user.id,
    user.id,
  );
  for (const row of rows) {
    const key = bucketKey(new Date(row.created_at), granularity);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (row.payer_id === user.id) {
      bucket.expenseCents += row.amount_cents;
      bucket.expenseCount += 1;
    }
    if (row.merchant_id === user.id) {
      bucket.incomeCents += row.amount_cents;
      bucket.incomeCount += 1;
    }
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function statsCsv(user: UserRow, range: DateRange, includePending: boolean): string {
  const statuses = statusesFor(includePending);
  const placeholders = statuses.map(() => "?").join(",");
  const orders = queryAll<OrderRow>(
    `SELECT * FROM orders WHERE created_at >= ? AND created_at <= ? AND status IN (${placeholders})
       AND (payer_id = ? OR merchant_id = ?) ORDER BY created_at ASC`,
    range.from,
    range.to,
    ...(statuses as never[]),
    user.id,
    user.id,
  );
  const rows = orders.map((order) => {
    const isExpense = order.payer_id === user.id;
    return [
      order.order_no,
      order.created_at,
      isExpense ? "支出" : "收入",
      isExpense ? order.merchant_name_snapshot : order.payer_name_snapshot,
      order.title,
      (order.amount_cents / 100).toFixed(2),
      order.pay_channel ? CHANNEL_LABELS[order.pay_channel as Channel] : "",
      order.status === "completed" ? "已完成" : order.status === "paid" ? "已支付" : order.status === "cancelled" ? "已取消" : "待付款",
      order.reserved_note ?? "",
      order.actual_note ?? "",
    ];
  });
  return toCsv(
    ["订单号", "时间", "类型", "对方", "内容", "金额(元)", "支付方式", "状态", "预留备注", "实际备注"],
    rows,
  );
}

export function todayRange(): DateRange {
  const now = new Date();
  const start = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  return { from: start.toISOString(), to: now.toISOString() };
}

export function monthRange(month: string): DateRange {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw errors.validation("月份格式不正确，应为 YYYY-MM");
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCMilliseconds(-1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function nowIsoString(): string {
  return nowIso();
}
