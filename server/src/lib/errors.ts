/** 业务错误：由全局错误中间件转成统一 JSON */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  unauthenticated(message = "请先登录"): AppError {
    return new AppError(401, "UNAUTHENTICATED", message);
  },
  forbidden(message = "没有权限执行该操作"): AppError {
    return new AppError(403, "FORBIDDEN", message);
  },
  validation(message = "参数不合法", details?: unknown): AppError {
    return new AppError(400, "VALIDATION_FAILED", message, details);
  },
  notFound(message = "内容不存在"): AppError {
    return new AppError(404, "NOT_FOUND", message);
  },
  conflict(message: string): AppError {
    return new AppError(409, "CONFLICT", message);
  },
  rateLimited(message = "请求过于频繁，请稍后再试"): AppError {
    return new AppError(429, "RATE_LIMITED", message);
  },
  locked(message = "账号已被冻结，请联系管理员"): AppError {
    return new AppError(423, "LOCKED", message);
  },
  limitExceeded(message: string): AppError {
    return new AppError(400, "LIMIT_EXCEEDED", message);
  },
  orderStatusInvalid(message = "订单当前状态不能执行该操作"): AppError {
    return new AppError(409, "ORDER_STATUS_INVALID", message);
  },
  paymentPasswordWrong(remaining: number): AppError {
    return new AppError(400, "PAYMENT_PASSWORD_WRONG", "支付密码错误", { remaining });
  },
  paymentPasswordLocked(lockedUntil: string): AppError {
    return new AppError(423, "PAYMENT_PASSWORD_LOCKED", "支付密码已锁定，请稍后再试", {
      lockedUntil,
    });
  },
  paymentPasswordNotSet(): AppError {
    return new AppError(400, "PAYMENT_PASSWORD_NOT_SET", "请先设置支付密码");
  },
};
