import { Router } from "express";
import { z } from "zod";
import { asyncHandler, attachAdmin, requireAdmin } from "../lib/http.js";
import { isSystemReady } from "../lib/runtime-config.js";
import {
  clearSessionCookie,
  revokeSessionByToken,
  sessionTokenFromRequest,
} from "../lib/session.js";
import type { AdminRole } from "../lib/types.js";
import { requestIp } from "../lib/types.js";
import { pagination, parse, toInt } from "../lib/validate.js";
import {
  addAdmin,
  adminAppeals,
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
  forceUserLogout,
  handleAppeal,
  removeAdmin,
  resetUserCard,
  saveAdminConfig,
  setUserFrozen,
  type AdminLogType,
} from "../services/admin.js";
import {
  adminAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
  updateAnnouncement,
} from "../services/announcements.js";

export const adminRouter: Router = Router();

adminRouter.use(attachAdmin);

/* -------------------------------------------------------------- 认证 */
// 管理后台与主站共用同一套校园墙登录会话（HttpOnly cookie），不再单独走 OAuth 与邮箱二次验证。

/** 跳转到主站登录：登录成功后回到 /admin */
adminRouter.get("/auth/login", (_req, res) => {
  res.redirect(302, "/api/auth/login?redirect=%2Fadmin");
});

adminRouter.get("/auth/session", (req, res) => {
  if (!isSystemReady()) {
    res.status(401).json({
      error: { code: "SYSTEM_NOT_INITIALIZED", message: "系统尚未初始化" },
    });
    return;
  }
  if (!req.auth) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } });
    return;
  }
  if (!req.admin) {
    res.status(401).json({
      error: { code: "NOT_ADMIN", message: "你的账号不在管理员名单内" },
    });
    return;
  }
  res.json({
    authenticated: true,
    initialized: true,
    admin: adminIdentity(req.admin.user, req.admin.admin),
  });
});

adminRouter.post("/auth/logout", (req, res) => {
  const token = sessionTokenFromRequest(req);
  if (token) revokeSessionByToken(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

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

const announcementLevelSchema = z.enum(["info", "important", "warning"]);

const announcementSchema = z.object({
  title: z.string().trim().min(1, "请填写公告标题").max(80),
  content: z.string().trim().min(1, "请填写公告正文").max(8000),
  level: announcementLevelSchema.optional(),
  pinned: z.boolean().optional(),
  publishedAt: z.string().nullable().optional(),
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
          level: body.level ?? "info",
          pinned: body.pinned ?? false,
          publishedAt: body.publishedAt ?? null,
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
          level: body.level ?? "info",
          pinned: body.pinned ?? false,
          publishedAt: body.publishedAt ?? null,
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

