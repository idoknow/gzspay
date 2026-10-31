import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { queryOne } from "../db/index.js";
import {
  completeAuthorization,
  createAuthorizationRequest,
} from "../lib/campux.js";
import { AppError, errors } from "../lib/errors.js";
import { asyncHandler, attachAdmin, requireAdmin } from "../lib/http.js";
import { consumeEmailCode, issueEmailCode } from "../lib/email.js";
import { maskEmail } from "../lib/crypto.js";
import { templates } from "../lib/mail.js";
import { writeLoginLog } from "../lib/audit.js";
import {
  clearSessionCookie,
  issueSession,
  readSession,
  revokeSessionByToken,
  sessionTokenFromRequest,
  setSessionCookie,
  upgradeToAdminSession,
} from "../lib/session.js";
import type { AdminRole, AdminRow } from "../lib/types.js";
import { requestIp } from "../lib/types.js";
import { pagination, parse, toInt } from "../lib/validate.js";
import { findUserBySub, requireUserFromContext } from "../services/users.js";
import {
  addAdmin,
  adminAppeals,
  adminAnnouncements,
  adminCloseOrder,
  adminConfigView,
  adminFlagOrder,
  adminIdentity,
  adminLogs,
  adminLogsCsv,
  adminMembers,
  adminMonthly,
  adminOrderDetail,
  adminOrders,
  adminOrdersCsv,
  adminOverview,
  adminStats,
  adminSystemStatus,
  adminUserDetail,
  adminUsers,
  adminUsersGrowth,
  createAnnouncement,
  deleteAnnouncement,
  forceUserLogout,
  handleAppeal,
  recordAdminLoginLog,
  removeAdmin,
  resetUserCard,
  saveAdminConfig,
  setUserFrozen,
  updateAnnouncement,
  type AdminLogType,
} from "../services/admin.js";

export const adminRouter: Router = Router();

adminRouter.use(attachAdmin);

function adminPageError(message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>管理后台登录失败</title>
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#0b1220;color:#e7eefc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
.card{max-width:440px;background:#131c30;border-radius:20px;padding:28px;box-shadow:0 12px 30px rgba(0,0,0,.35)}
h1{font-size:20px;margin:0 0 12px;color:#ffd166}p{line-height:1.7;color:#b9c6e0}
a.btn{display:inline-block;margin-top:16px;background:#2f6fed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:12px}</style>
</head><body><div class="card"><h1>管理后台登录失败</h1><p>${message}</p><a class="btn" href="/admin">返回管理后台</a></div></body></html>`;
}

function findAdminRow(userId: string): AdminRow | undefined {
  return queryOne<AdminRow>("SELECT * FROM admins WHERE user_id = ?", userId);
}

/* -------------------------------------------------------------- 认证 */

adminRouter.get("/auth/login", (req, res, next) => {
  try {
    const url = createAuthorizationRequest("admin", null);
    res.redirect(302, url);
  } catch (error) {
    next(error);
  }
});

adminRouter.get(
  "/auth/callback",
  asyncHandler(async (req, res) => {
    const ip = requestIp(req);
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    try {
      const { profile } = await completeAuthorization("admin", code, state);
      const user = findUserBySub(profile.sub);
      const admin = user ? findAdminRow(user.id) : undefined;
      if (!user || !admin) {
        recordAdminLoginLog({
          userId: user?.id ?? null,
          campuxSub: profile.sub,
          success: false,
          reason: "该账号不在管理员名单内",
          ip,
          userAgent: req.headers["user-agent"] ?? null,
        });
        res.status(403).type("html").send(adminPageError("该校园墙账号不在管理员名单内。"));
        return;
      }
      if (user.status === "frozen") {
        recordAdminLoginLog({
          userId: user.id,
          campuxSub: profile.sub,
          success: false,
          reason: "账号已被冻结",
          ip,
          userAgent: req.headers["user-agent"] ?? null,
        });
        res.status(403).type("html").send(adminPageError("该账号已被冻结。"));
        return;
      }
      // 建议管理员再加一次邮箱验证码二次验证；没有可用邮箱时直接签发管理员会话
      if (user.email && user.email_verified === 1) {
        const issued = issueSession(user.id, "admin_pending", req);
        setSessionCookie(res, issued.token, "admin_pending");
        try {
          issueEmailCode({ user, purpose: "admin_2fa", email: user.email, scene: "管理后台登录" });
        } catch {
          // 验证码发送失败不阻塞登录流程，页面可重新发送
        }
        recordAdminLoginLog({
          userId: user.id,
          campuxSub: profile.sub,
          success: true,
          reason: "等待邮箱验证码",
          ip,
          userAgent: req.headers["user-agent"] ?? null,
        });
        res.redirect(302, `${config.appBaseUrl}/admin`);
        return;
      }
      const issued = issueSession(user.id, "admin", req);
      setSessionCookie(res, issued.token, "admin");
      recordAdminLoginLog({
        userId: user.id,
        campuxSub: profile.sub,
        success: true,
        ip,
        userAgent: req.headers["user-agent"] ?? null,
      });
      res.redirect(302, `${config.appBaseUrl}/admin`);
    } catch (error) {
      const message = error instanceof AppError ? error.message : "登录失败，请稍后再试";
      recordAdminLoginLog({
        userId: null,
        campuxSub: null,
        success: false,
        reason: message,
        ip,
        userAgent: req.headers["user-agent"] ?? null,
      });
      res.status(400).type("html").send(adminPageError(message));
    }
  }),
);

adminRouter.get(
  "/auth/session",
  asyncHandler((req, res) => {
    const adminSession = readSession(req, "admin") ?? readSession(req, "admin_pending");
    const user = adminSession?.user ?? null;
    const admin = user ? findAdminRow(user.id) : undefined;
    if (!adminSession || !user || !admin) {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "请先登录管理后台" } });
      return;
    }
    if (adminSession.session.kind === "admin_pending") {
      res.status(401).json({
        error: {
          code: "ADMIN_2FA_REQUIRED",
          message: "请先完成邮箱二次验证",
          details: { emailMasked: user.email ? maskEmail(user.email) : null },
        },
      });
      return;
    }
    res.json({
      authenticated: true,
      pending2fa: false,
      admin: adminIdentity(user, admin),
      emailMasked: user.email ? maskEmail(user.email) : null,
    });
  }),
);

adminRouter.post(
  "/auth/verify",
  asyncHandler((req, res) => {
    const body = parse(z.object({ code: z.string().trim().min(4, "请输入验证码").max(12) }), req.body);
    const pending = readSession(req, "admin_pending");
    const user = pending?.user ?? null;
    const admin = user ? findAdminRow(user.id) : undefined;
    if (!pending || !user || !admin) {
      throw errors.unauthenticated("登录状态已失效，请重新使用校园墙登录");
    }
    consumeEmailCode({ userId: user.id, purpose: "admin_2fa", code: body.code, ip: requestIp(req) });
    upgradeToAdminSession(req, res, user.id);
    recordAdminLoginLog({
      userId: user.id,
      campuxSub: user.campux_sub,
      success: true,
      reason: "邮箱二次验证通过",
      ip: requestIp(req),
      userAgent: req.headers["user-agent"] ?? null,
    });
    res.json({ ok: true, admin: adminIdentity(user, admin) });
  }),
);

adminRouter.post("/auth/logout", (req, res) => {
  const token = sessionTokenFromRequest(req, "admin") ?? sessionTokenFromRequest(req, "admin_pending");
  if (token) revokeSessionByToken(token);
  clearSessionCookie(res, "admin");
  clearSessionCookie(res, "admin_pending");
  res.json({ ok: true });
});

adminRouter.post(
  "/auth/resend",
  asyncHandler((req, res) => {
    const pending = readSession(req, "admin_pending");
    const user = pending?.user ?? null;
    if (!pending || !user || !user.email) throw errors.unauthenticated("登录状态已失效，请重新登录");
    const result = issueEmailCode({ user, purpose: "admin_2fa", email: user.email, scene: "管理后台登录" });
    res.json({ ok: true, ...result });
  }),
);

/* -------------------------------------------------------------- 总览 */

adminRouter.get("/overview", requireAdmin(), (_req, res) => {
  res.json(adminOverview());
});

adminRouter.get(
  "/monthly",
  requireAdmin(),
  asyncHandler((req, res) => {
    const query = parse(
      z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), month: z.string().optional() }),
      req.query,
    );
    const year = query.year ?? new Date().getFullYear();
    res.json(adminMonthly(year, query.month));
  }),
);

/* -------------------------------------------------------------- 用户 */

adminRouter.get(
  "/users",
  requireAdmin(),
  asyncHandler((req, res) => {
    const query = req.query as Record<string, unknown>;
    const { page, pageSize } = pagination(toInt(query.page, 1), toInt(query.pageSize, 20));
    res.json(adminUsers(typeof query.query === "string" ? query.query : "", page, pageSize));
  }),
);

adminRouter.get(
  "/users/growth",
  requireAdmin(),
  asyncHandler((req, res) => {
    const months = Number.parseInt(String(req.query.months ?? "12"), 10);
    res.json(adminUsersGrowth(Number.isFinite(months) ? months : 12));
  }),
);

adminRouter.get(
  "/users/:id",
  requireAdmin(),
  asyncHandler((req, res) => {
    res.json(adminUserDetail(String(req.params.id)));
  }),
);

adminRouter.post(
  "/users/:id/freeze",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    res.json(setUserFrozen(req.admin!.user.id, String(req.params.id), true, requestIp(req)));
  }),
);

adminRouter.post(
  "/users/:id/unfreeze",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    res.json(setUserFrozen(req.admin!.user.id, String(req.params.id), false, requestIp(req)));
  }),
);

adminRouter.post(
  "/users/:id/reset-card",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    res.json(resetUserCard(req.admin!.user.id, String(req.params.id), requestIp(req)));
  }),
);

adminRouter.post(
  "/users/:id/force-logout",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    res.json(forceUserLogout(req.admin!.user.id, String(req.params.id), requestIp(req)));
  }),
);

/* -------------------------------------------------------------- 管理员 */

adminRouter.get("/admins", requireAdmin(), (_req, res) => {
  res.json(adminMembers());
});

adminRouter.post(
  "/admins",
  requireAdmin(["super"]),
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        userId: z.string().trim().min(1, "请选择用户"),
        role: z.enum(["super", "ops", "auditor"]),
      }),
      req.body,
    );
    res.json(addAdmin(req.admin!.user.id, body.userId, body.role as AdminRole, requestIp(req)));
  }),
);

adminRouter.delete(
  "/admins/:userId",
  requireAdmin(["super"]),
  asyncHandler((req, res) => {
    res.json(removeAdmin(req.admin!.user.id, String(req.params.userId), requestIp(req)));
  }),
);

/* -------------------------------------------------------------- 交易明细 */

function orderFilters(req: {
  query: Record<string, unknown>;
}): Parameters<typeof adminOrders>[0] {
  const query = req.query;
  const numberOrUndefined = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  return {
    from: text(query.from),
    to: text(query.to),
    status: text(query.status),
    merchantId: text(query.merchantId),
    payerId: text(query.payerId),
    minAmount: numberOrUndefined(query.minAmount),
    maxAmount: numberOrUndefined(query.maxAmount),
    query: text(query.query),
  };
}

adminRouter.get(
  "/orders",
  requireAdmin(),
  asyncHandler((req, res) => {
    const query = req.query as Record<string, unknown>;
    const { page, pageSize } = pagination(toInt(query.page, 1), toInt(query.pageSize, 20));
    res.json(adminOrders(orderFilters(req), page, pageSize));
  }),
);

adminRouter.get(
  "/orders/export",
  requireAdmin(),
  asyncHandler((req, res) => {
    const csv = adminOrdersCsv(orderFilters(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="gzspay-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }),
);

adminRouter.get(
  "/orders/:id",
  requireAdmin(),
  asyncHandler((req, res) => {
    res.json(adminOrderDetail(String(req.params.id)));
  }),
);

adminRouter.post(
  "/orders/:id/close",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    const body = parse(z.object({ note: z.string().max(300).nullable().optional() }), req.body);
    res.json(adminCloseOrder(req.admin!.user.id, String(req.params.id), body.note ?? null, requestIp(req)));
  }),
);

adminRouter.post(
  "/orders/:id/flag",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    const body = parse(z.object({ note: z.string().max(300).nullable().optional() }), req.body);
    res.json(adminFlagOrder(req.admin!.user.id, String(req.params.id), body.note ?? null, requestIp(req)));
  }),
);

/* -------------------------------------------------------------- 申诉 */

adminRouter.get(
  "/appeals",
  requireAdmin(),
  asyncHandler((req, res) => {
    const query = req.query as Record<string, unknown>;
    const { page, pageSize } = pagination(toInt(query.page, 1), toInt(query.pageSize, 20));
    res.json(adminAppeals(typeof query.status === "string" ? query.status : undefined, page, pageSize));
  }),
);

adminRouter.post(
  "/appeals/:id/handle",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        status: z.enum(["resolved", "rejected"]),
        note: z.string().max(300).nullable().optional(),
      }),
      req.body,
    );
    res.json(
      handleAppeal(req.admin!.user.id, String(req.params.id), body.status, body.note ?? null, requestIp(req)),
    );
  }),
);

/* -------------------------------------------------------------- 统计与系统 */

adminRouter.get("/stats", requireAdmin(), (_req, res) => {
  res.json(adminStats());
});

adminRouter.get("/system/status", requireAdmin(), (_req, res) => {
  res.json(adminSystemStatus());
});

/* -------------------------------------------------------------- 公告 */

const announcementSchema = z.object({
  title: z.string().trim().min(1, "请填写公告标题").max(80),
  content: z.string().trim().min(1, "请填写公告正文").max(4000),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
});

adminRouter.get("/announcements", requireAdmin(), (_req, res) => {
  res.json(adminAnnouncements());
});

adminRouter.post(
  "/announcements",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    const body = parse(announcementSchema, req.body);
    res.json(
      createAnnouncement(
        req.admin!.user.id,
        {
          title: body.title,
          content: body.content,
          startsAt: body.startsAt ?? null,
          endsAt: body.endsAt ?? null,
          pinned: body.pinned ?? false,
        },
        requestIp(req),
      ),
    );
  }),
);

adminRouter.patch(
  "/announcements/:id",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    const body = parse(announcementSchema, req.body);
    res.json(
      updateAnnouncement(
        req.admin!.user.id,
        String(req.params.id),
        {
          title: body.title,
          content: body.content,
          startsAt: body.startsAt ?? null,
          endsAt: body.endsAt ?? null,
          pinned: body.pinned ?? false,
        },
        requestIp(req),
      ),
    );
  }),
);

adminRouter.delete(
  "/announcements/:id",
  requireAdmin(["super", "ops"]),
  asyncHandler((req, res) => {
    res.json(deleteAnnouncement(req.admin!.user.id, String(req.params.id), requestIp(req)));
  }),
);

/* -------------------------------------------------------------- 日志 */

const LOG_TYPES: AdminLogType[] = ["audit", "login", "risk", "error"];

function logOptions(req: { query: Record<string, unknown> }) {
  const query = req.query;
  return {
    from: typeof query.from === "string" && query.from ? query.from : undefined,
    to: typeof query.to === "string" && query.to ? query.to : undefined,
    query: typeof query.query === "string" && query.query ? query.query : undefined,
  };
}

adminRouter.get(
  "/logs",
  requireAdmin(),
  asyncHandler((req, res) => {
    const query = req.query as Record<string, unknown>;
    const type = LOG_TYPES.includes(query.type as AdminLogType)
      ? (query.type as AdminLogType)
      : "audit";
    const { page, pageSize } = pagination(toInt(query.page, 1), toInt(query.pageSize, 20));
    res.json(adminLogs(type, { ...logOptions(req), page, pageSize }));
  }),
);

adminRouter.get(
  "/logs/export",
  requireAdmin(),
  asyncHandler((req, res) => {
    const query = req.query as Record<string, unknown>;
    const type = LOG_TYPES.includes(query.type as AdminLogType)
      ? (query.type as AdminLogType)
      : "audit";
    const csv = adminLogsCsv(type, logOptions(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="gzspay-logs-${type}.csv"`);
    res.send(csv);
  }),
);

/* -------------------------------------------------------------- 配置 */

adminRouter.get("/config", requireAdmin(), (_req, res) => {
  res.json(adminConfigView());
});

const configSchema = z.object({
  mail: z.object({
    host: z.string().max(200),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().max(200),
    fromName: z.string().max(80),
    fromAddress: z.string().max(200),
    password: z.string().max(200).optional(),
  }),
  security: z.object({
    paymentPasswordMaxAttempts: z.number().int().min(1).max(20),
    paymentPasswordLockMinutes: z.number().int().min(1).max(1440),
    singlePaymentLimitCents: z.number().int().min(1).max(100_000_000),
    dailyPaymentLimitCents: z.number().int().min(1).max(1_000_000_000),
    dynamicCodeTtlSeconds: z.number().int().min(10).max(3600),
    emailCodeTtlSeconds: z.number().int().min(60).max(86_400),
    sessionTtlDays: z.number().int().min(1).max(365),
  }),
});

adminRouter.put(
  "/config",
  requireAdmin(["super"]),
  asyncHandler((req, res) => {
    const body = parse(configSchema, req.body);
    saveAdminConfig(req.admin!.user.id, body, requestIp(req));
    res.json(adminConfigView());
  }),
);

export { requireUserFromContext, writeLoginLog };
