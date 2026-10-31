import type { ZodType } from "zod";
import { AppError } from "./errors.js";

/** 校验请求体/查询参数，失败抛出统一格式的 VALIDATION_FAILED */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new AppError(400, "VALIDATION_FAILED", issues[0]?.message ?? "参数不合法", { issues });
  }
  return result.data;
}

/** 分页参数 */
export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export function pagination(page = 1, pageSize = 20): Pagination {
  const safePage = Math.max(1, Math.min(10_000, Math.floor(page)));
  const safeSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

/** 解析页码类查询参数 */
export function toInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
