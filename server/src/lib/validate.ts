import type { ZodIssue, ZodType } from "zod";
import { config } from "../config.js";
import { AppError } from "./errors.js";

/**
 * 把 Zod 的校验问题转成可以直接给用户看的中文提示。
 * Zod 默认文案是英文（例如 Required / Expected number, received string），
 * 而且描述的是字段与类型，不适合直接展示给用户，所以这里统一兜底。
 */
export function friendlyIssueMessage(issue: ZodIssue): string {
  // 路由里手写的中文提示优先保留（例如「请填写对方学号」）
  if (/[\u4e00-\u9fa5]/.test(issue.message)) return issue.message;
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined ? "请填写必填项" : "填写的内容格式不正确";
    case "invalid_value":
      return "选项不在允许范围内";
    case "too_small":
      return "填写的内容过短";
    case "too_big":
      return "填写的内容过长";
    case "invalid_format":
      return "填写的内容格式不正确";
    case "unrecognized_keys":
      return "提交了多余的字段，请刷新后重试";
    case "not_multiple_of":
      return "填写的内容不是有效数字";
    case "custom":
    default:
      return "填写的内容有误，请检查后重试";
  }
}

/** 统一的校验失败错误：生产环境不把字段名、字段路径等内部细节返回给客户端 */
export function validationError(issues: ZodIssue[]): AppError {
  const first = issues[0];
  const message = first ? friendlyIssueMessage(first) : "提交的内容有误，请检查后重试";
  const details = config.isProduction
    ? undefined
    : {
        issues: issues.map((issue) => ({
          path: issue.path.join("."),
          message: friendlyIssueMessage(issue),
        })),
      };
  return new AppError(400, "VALIDATION_FAILED", message, details);
}

/** 校验请求体/查询参数，失败抛出统一格式的 VALIDATION_FAILED */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationError(result.error.issues);
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
