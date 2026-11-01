import { Router } from "express";
import { asyncHandler, requireUser } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { z } from "zod";
import {
  parseRange,
  statsCsv,
  statsSummary,
  statsTimeseries,
} from "../services/stats.js";

export const statsRouter: Router = Router();

statsRouter.use(requireUser());

function rangeQuery(query: Record<string, unknown>): { from: string; to: string; includePending: boolean } {
  const parsed = parse(
    z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      includePending: z.union([z.boolean(), z.string()]).optional(),
    }),
    query,
  );
  const range = parseRange(parsed.from, parsed.to);
  const includePending =
    parsed.includePending === true || parsed.includePending === "true" || parsed.includePending === "1";
  return { ...range, includePending };
}

statsRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    const { from, to, includePending } = rangeQuery(req.query as Record<string, unknown>);
    res.json({
      ...statsSummary(req.auth!.user, { from, to }, includePending),
      from,
      to,
      includePending,
    });
  }),
);

statsRouter.get(
  "/timeseries",
  asyncHandler((req, res) => {
    const { from, to, includePending } = rangeQuery(req.query as Record<string, unknown>);
    const granularity = req.query.granularity === "month" ? "month" : "day";
    res.json({
      granularity,
      from,
      to,
      includePending,
      buckets: statsTimeseries(req.auth!.user, { from, to }, granularity, includePending),
    });
  }),
);

statsRouter.get(
  "/export",
  asyncHandler((req, res) => {
    const { from, to, includePending } = rangeQuery(req.query as Record<string, unknown>);
    const csv = statsCsv(req.auth!.user, { from, to }, includePending);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="gzspay-stats-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }),
);
