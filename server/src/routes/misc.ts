import { Router } from "express";
import { config } from "../config.js";
import { nowIso, queryOne } from "../db/index.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { LEGAL_EFFECTIVE_AT, LEGAL_UPDATED_AT, PRIVACY_POLICY, TERMS_OF_SERVICE } from "../content/legal.js";
import { markAnnouncementRead, userAnnouncements } from "../services/announcements.js";
import { readChangelog } from "./me.js";
import { readSystemConfig } from "../lib/runtime-config.js";
import { eventStreamHandler } from "../services/events.js";

export const miscRouter: Router = Router();

miscRouter.get("/health", (_req, res) => {
  const dbOk = queryOne<{ ok: number }>("SELECT 1 AS ok")?.ok === 1;
  res.json({
    status: dbOk ? "ok" : "degraded",
    version: config.version,
    time: nowIso(),
    uptimeSeconds: Math.round(process.uptime()),
    database: dbOk ? "up" : "down",
  });
});

miscRouter.get("/about", (_req, res) => {
  const system = readSystemConfig();
  res.json({
    version: config.version,
    changelog: readChangelog(),
    privacy: PRIVACY_POLICY,
    terms: TERMS_OF_SERVICE,
    privacyUpdatedAt: LEGAL_UPDATED_AT,
    termsUpdatedAt: LEGAL_UPDATED_AT,
    legalEffectiveAt: LEGAL_EFFECTIVE_AT,
    site: { name: system.siteName, icp: system.icp },
  });
});

/** 主站公告列表：置顶优先、发布时间倒序，附带未读数与逐条已读状态 */
miscRouter.get(
  "/announcements",
  requireUser(),
  asyncHandler((req, res) => {
    res.json(userAnnouncements(req.auth!.user.id));
  }),
);

/** 标记公告已读（幂等），返回剩余未读数 */
miscRouter.post(
  "/announcements/:id/read",
  requireUser(),
  asyncHandler((req, res) => {
    res.json(markAnnouncementRead(req.auth!.user.id, String(req.params.id)));
  }),
);

/** 实时事件流（SSE）：payment_request、order_update */
miscRouter.get(
  "/events/stream",
  requireUser({ allowFrozen: true }),
  asyncHandler((req, res) => {
    eventStreamHandler(req, res);
  }),
);
