/** 统一的 HTTP 客户端：Cookie 会话、错误码、JSON 序列化 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** multipart 上传：传入 FormData 时忽略 body，不设置 JSON Content-Type */
  form?: FormData;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  raw?: boolean;
}

function buildQuery(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** 发起 API 请求，失败统一抛 ApiError */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, form, query, signal, headers } = options;
  const isForm = form !== undefined;
  const response = await fetch(`/api${path}${buildQuery(query)}`, {
    method,
    credentials: "same-origin",
    headers: {
      // 后端 CSRF 校验要求的自定义请求头（跨站表单无法伪造）
      "X-Requested-With": "gzspay",
      ...(!isForm && body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: isForm ? form : body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const payload: unknown = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const parsed = payload as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    throw new ApiError(
      response.status,
      parsed.error?.code ?? "REQUEST_FAILED",
      parsed.error?.message ?? `请求失败（${response.status}）`,
      parsed.error?.details,
    );
  }

  return payload as T;
}

export const api = {
  get<T>(path: string, query?: RequestOptions["query"]): Promise<T> {
    return request<T>(path, { query });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "PUT", body });
  },
  del<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
  /** multipart 上传（文件 + 普通字段混填） */
  upload<T>(path: string, form: FormData): Promise<T> {
    return request<T>(path, { method: "POST", form });
  },
  /** 拉取二进制（二维码 PNG / CSV 等） */
  async blob(path: string, query?: RequestOptions["query"]): Promise<Blob> {
    const response = await fetch(`/api${path}${buildQuery(query)}`, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "gzspay" },
    });
    if (!response.ok) {
      let code = "REQUEST_FAILED";
      let message = `请求失败（${response.status}）`;
      try {
        const parsed = (await response.json()) as { error?: { code?: string; message?: string } };
        code = parsed.error?.code ?? code;
        message = parsed.error?.message ?? message;
      } catch {
        // 非 JSON 错误响应，使用默认文案
      }
      throw new ApiError(response.status, code, message);
    }
    return response.blob();
  },
};

/** 打开 SSE 连接（用于收款请求实时推送） */
export function openEventStream(path: string): EventSource {
  return new EventSource(`/api${path}`, { withCredentials: true });
}

/** 通用兜底文案：调用方需要更贴合场景的提示时用 errorText */
export const GENERIC_ERROR_TEXT = "操作失败，请稍后重试";

/** 常见错误码的兜底文案（服务端返回了可读的中文说明时优先用服务端的） */
const CODE_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: "提交的内容有误，请检查后重试",
  UNAUTHENTICATED: "登录状态已失效，请重新登录",
  NOT_ADMIN: "你的账号不在管理员名单内",
  FORBIDDEN: "没有权限执行该操作",
  NOT_FOUND: "请求的内容不存在",
  CONFLICT: "当前状态已变化，请刷新后重试",
  ORDER_STATUS_INVALID: "订单状态已变化，请刷新后重试",
  LIMIT_EXCEEDED: "金额超出限制，请调整后重试",
  RATE_LIMITED: "操作太频繁，请稍后再试",
  LOCKED: "账号已被冻结，请联系管理员",
  PAYMENT_PASSWORD_WRONG: "支付密码错误",
  PAYMENT_PASSWORD_LOCKED: "支付密码已锁定，请稍后再试",
  PAYMENT_PASSWORD_NOT_SET: "请先设置支付密码",
  SYSTEM_NOT_INITIALIZED: "系统尚未初始化，请稍后再试",
  CAMPUX_NOT_CONFIGURED: "管理员尚未配置校园墙登录，暂时无法登录",
  ALREADY_INITIALIZED: "系统已完成初始化",
  TOO_MANY_STREAMS: "实时连接过多，请关闭其他页面后再试",
  REQUEST_FAILED: "请求失败，请稍后重试",
  INTERNAL_ERROR: "服务暂时不可用，请稍后再试",
};

/** 只有错误码没有可读文案时，按 HTTP 状态兜底 */
const STATUS_MESSAGES: Record<number, string> = {
  400: "提交的内容有误，请检查后重试",
  401: "登录状态已失效，请重新登录",
  403: "没有权限执行该操作",
  404: "请求的内容不存在",
  409: "当前状态已变化，请刷新后重试",
  413: "上传的内容过大",
  423: "账号已被冻结，请联系管理员",
  429: "操作太频繁，请稍后再试",
  500: "服务暂时不可用，请稍后再试",
  502: "服务暂时不可用，请稍后再试",
  503: "服务暂时不可用，请稍后再试",
  504: "服务暂时不可用，请稍后再试",
};

/** 看起来像内部实现细节（堆栈、类型名、英文校验文案、地址等）的文案禁止直接展示 */
const TECHNICAL_TEXT =
  /(?:TypeError|SyntaxError|ReferenceError|RangeError|DOMException|undefined|null|NaN|Cannot read|is not a|Failed to fetch|fetch failed|NetworkError|Unexpected token|JSON|stack|node_modules|localhost|127\.0\.0\.1|https?:\/\/|<[a-z!]|\[object|Required|Expected|received|invalid)/i;

/** 服务端/浏览器文案可以展示时返回中文原文，否则返回 null 交给兜底文案 */
function readableMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const text = message.trim();
  if (!text || text.length > 80) return null;
  if (TECHNICAL_TEXT.test(text)) return null;
  // 纯英文（如 Zod 的 Required）一律不展示
  if (!/[\u4e00-\u9fa5]/.test(text)) return null;
  return text;
}

/**
 * 把任意异常转成可以直接展示给用户的中文提示。
 * 原则：优先用已知错误码；服务端文案必须是可读中文才使用；
 * 其余情况按 HTTP 状态或场景兜底，绝不把堆栈、字段名、英文校验文案暴露给用户。
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const readable = readableMessage(error.message);
    if (readable) return readable;
    const byCode = CODE_MESSAGES[error.code];
    if (byCode) return byCode;
    const byStatus = STATUS_MESSAGES[error.status];
    if (byStatus) return byStatus;
    return error.status >= 500 ? "服务暂时不可用，请稍后再试" : GENERIC_ERROR_TEXT;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "操作已取消";
  }
  if (error instanceof TypeError) {
    // fetch 网络失败、被拦截等都会抛 TypeError
    return "网络连接失败，请检查网络后重试";
  }
  if (error instanceof SyntaxError) {
    return "服务返回的数据异常，请稍后重试";
  }
  if (error instanceof Error) {
    return readableMessage(error.message) ?? GENERIC_ERROR_TEXT;
  }
  return GENERIC_ERROR_TEXT;
}

/** 场景化兜底：拿不到可读文案时使用调用方给出的提示 */
export function errorText(error: unknown, fallback: string): string {
  const message = errorMessage(error);
  return message === GENERIC_ERROR_TEXT ? fallback : message;
}
