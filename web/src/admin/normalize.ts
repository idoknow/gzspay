/**
 * 接口响应容错解析工具。
 * 后端字段命名可能与约定略有差异，这里统一做宽松读取，避免页面因单个字段缺失而崩溃。
 */

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把任意值收敛为对象，非对象返回空对象 */
export function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

/** 把任意值收敛为数组 */
export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 取字符串（数字/布尔会转字符串），空串返回 null */
export function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

export function textOr(value: unknown, fallback: string): string {
  return text(value) ?? fallback;
}

/** 取数字（支持数字字符串），非数字返回 null */
export function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function numberOr(value: unknown, fallback: number): number {
  return number(value) ?? fallback;
}

export function boolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

/** 从对象中按候选键依次取字符串 */
export function firstText(
  source: UnknownRecord,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = text(source[key]);
    if (value !== null) return value;
  }
  return null;
}

/** 从对象中按候选键依次取数字 */
export function firstNumber(
  source: UnknownRecord,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = number(source[key]);
    if (value !== null) return value;
  }
  return null;
}

/** 从对象中按候选键依次取布尔 */
export function firstBoolean(
  source: UnknownRecord,
  keys: readonly string[],
): boolean | null {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return boolean(source[key]);
    }
  }
  return null;
}

/** 从对象中按候选键依次取数组 */
export function firstArray(
  source: UnknownRecord,
  keys: readonly string[],
): unknown[] {
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key] as unknown[];
  }
  return [];
}

/** 取 ISO 时间字符串，非法返回 null */
export function isoOrNull(value: unknown): string | null {
  return text(value);
}

/** 解析「人」字段：可能是字符串，也可能是 {displayName|name} 对象 */
export function nameOf(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (isRecord(value)) {
    return firstText(value, ["displayName", "name", "fullName", "merchantName"]);
  }
  return null;
}

/** 分页响应解析：兼容 items/list/data/rows 与数组直出 */
export interface RawPage {
  rows: unknown[];
  total: number;
  page: number;
  pageSize: number;
}

export function pickPage(payload: unknown): RawPage {
  if (Array.isArray(payload)) {
    return {
      rows: payload,
      total: payload.length,
      page: 1,
      pageSize: payload.length,
    };
  }
  const source = record(payload);
  const rows = firstArray(source, ["items", "list", "data", "rows", "records"]);
  const wrapped = record(source.data);
  const resolvedRows =
    rows.length > 0
      ? rows
      : firstArray(wrapped, ["items", "list", "rows", "records"]);
  const total =
    firstNumber(source, ["total", "count", "totalCount"]) ??
    firstNumber(wrapped, ["total", "count", "totalCount"]) ??
    resolvedRows.length;
  const page =
    firstNumber(source, ["page", "current", "pageNo"]) ??
    firstNumber(wrapped, ["page", "current"]) ??
    1;
  const pageSize =
    firstNumber(source, ["pageSize", "perPage", "size", "limit"]) ??
    firstNumber(wrapped, ["pageSize", "perPage", "size"]) ??
    resolvedRows.length;
  return {
    rows: resolvedRows,
    total: Math.max(total, 0),
    page: Math.max(page, 1),
    pageSize: Math.max(pageSize, 1),
  };
}

/** 比例转百分比：0.98 → 98；已是 98 → 98 */
export function ratioToPercent(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 0 && value <= 1) return value * 100;
  return value;
}

/** 百分比归一化到 0-100 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
