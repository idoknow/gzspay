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

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "网络异常，请稍后再试";
}
