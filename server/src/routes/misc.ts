import { Router } from "express";
import { config } from "../config.js";
import { nowIso, queryAll, queryOne } from "../db/index.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import type { AnnouncementRow } from "../lib/types.js";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "../content/legal.js";
import { readChangelog } from "./me.js";
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
  res.json({
    version: config.version,
    changelog: readChangelog(),
    privacy: PRIVACY_POLICY,
    terms: TERMS_OF_SERVICE,
  });
});

miscRouter.get("/announcements/active", (_req, res) => {
  const now = nowIso();
  const rows = queryAll<AnnouncementRow>(
    `SELECT * FROM announcements
     WHERE starts_at <= ? AND ends_at >= ?
     ORDER BY pinned DESC, starts_at DESC LIMIT 10`,
    now,
    now,
  );
  res.json({
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      pinned: row.pinned === 1,
    })),
  });
});

/** 实时事件流（SSE）：payment_request、order_update */
miscRouter.get(
  "/events/stream",
  requireUser({ allowFrozen: true }),
  asyncHandler((req, res) => {
    eventStreamHandler(req, res);
  }),
);
