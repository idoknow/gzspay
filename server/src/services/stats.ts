import { nowIso, queryAll, queryOne } from "../db/index.js";
import { toCsv } from "../lib/audit.js";
import { errors } from "../lib/errors.js";
import type { Channel, OrderRow, UserRow } from "../lib/types.js";
import { CHANNEL_LABELS } from "../lib/types.js";

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

function statusesFor(includePending: boolean): string[] {
  return includePending ? ["completed", "paid"] : ["completed"];
}

export interface StatsSummary {
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  orderCount: number;
}

export function statsSummary(user: UserRow, range: DateRange, includePending: boolean): StatsSummary {
  const statuses = statusesFor(includePending);
  const placeholders = statuses.map(() => "?").join(",");
  const params = [range.from, range.to, ...statuses];
  const expense = queryOne<{ total: number | null; count: number }>(
    `SELECT SUM(amount_cents) AS total, COUNT(*) AS count FROM orders
     WHERE payer_id = ? AND created_at >= ? AND created_at <= ? AND status IN (${placeholders})`,
    user.id,
    ...(params as never[]),
  );
  const income = queryOne<{ total: number | null; count: number }>(
    `SELECT SUM(amount_cents) AS total, COUNT(*) AS count FROM orders
     WHERE merchant_id = ? AND created_at >= ? AND created_at <= ? AND status IN (${placeholders})`,
    user.id,
    ...(params as never[]),
  );
  const expenseCents = expense?.total ?? 0;
  const incomeCents = income?.total ?? 0;
  return {
    expenseCents,
    incomeCents,
    netCents: incomeCents - expenseCents,
    orderCount: (expense?.count ?? 0) + (income?.count ?? 0),
  };
}

export interface TimeseriesBucket {
  key: string;
  expenseCents: number;
  incomeCents: number;
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
    buckets.set(key, { key, expenseCents: 0, incomeCents: 0 });
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
    if (row.payer_id === user.id) bucket.expenseCents += row.amount_cents;
    if (row.merchant_id === user.id) bucket.incomeCents += row.amount_cents;
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
