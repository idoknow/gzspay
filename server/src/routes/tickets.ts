/** 工单：订单双方在工单内联系沟通（争议时使用，取代原先单向的申诉入口）。 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireUser } from "../lib/http.js";
import { rateLimit, userKey } from "../lib/rate-limit.js";
import { parse } from "../lib/validate.js";
import { requestIp } from "../lib/types.js";
import {
  TICKET_CATEGORIES,
  closeTicket,
  createTicket,
  getTicket,
  listTickets,
  markTicketRead,
  sendTicketMessage,
  unreadCountTotal,
} from "../services/tickets.js";

export const ticketsRouter: Router = Router();

ticketsRouter.use(requireUser());

const createSchema = z.object({
  orderId: z.string().trim().min(1, "请选择订单"),
  category: z.enum(TICKET_CATEGORIES as [string, ...string[]]),
  description: z.string().trim().min(5, "请简单描述一下争议情况（至少 5 个字）").max(500, "争议描述不能超过 500 个字"),
});

const messageSchema = z.object({
  body: z.string().trim().min(1, "消息内容不能为空").max(1000, "单条消息不能超过 1000 个字"),
});

const createRateLimit = rateLimit({
  scope: "tickets.create",
  limit: 10,
  windowSeconds: 3600,
  keyBy: userKey,
  message: "发起工单太频繁了，请稍后再试",
});

const messageRateLimit = rateLimit({
  scope: "tickets.message",
  limit: 30,
  windowSeconds: 60,
  keyBy: userKey,
  message: "发消息太快了，请稍后再试",
});

/** 我的工单列表（进行中优先，按最后消息时间倒序） */
ticketsRouter.get(
  "/",
  asyncHandler((req, res) => {
    const statusRaw = typeof req.query.status === "string" ? req.query.status : "";
    const status = statusRaw === "open" || statusRaw === "closed" ? statusRaw : undefined;
    const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    res.json({ items: listTickets(req.auth!.user, { status, limit: Number.isFinite(limit) ? limit : 50 }) });
  }),
);

/** 未读消息总数（红点用） */
ticketsRouter.get(
  "/unread-count",
  asyncHandler((req, res) => {
    res.json({ count: unreadCountTotal(req.auth!.user) });
  }),
);

/** 发起工单：同一订单已有进行中的工单时直接返回那一条 */
ticketsRouter.post(
  "/",
  createRateLimit,
  asyncHandler((req, res) => {
    const body = parse(createSchema, req.body);
    const result = createTicket(
      req.auth!.user,
      {
        orderId: body.orderId,
        category: body.category as (typeof TICKET_CATEGORIES)[number],
        description: body.description,
      },
      requestIp(req),
    );
    res.status(201).json(result);
  }),
);

ticketsRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    res.json(getTicket(String(req.params.id), req.auth!.user));
  }),
);

ticketsRouter.post(
  "/:id/messages",
  messageRateLimit,
  asyncHandler((req, res) => {
    const body = parse(messageSchema, req.body);
    res.status(201).json(
      sendTicketMessage(String(req.params.id), req.auth!.user, body.body, requestIp(req)),
    );
  }),
);

ticketsRouter.post(
  "/:id/read",
  asyncHandler((req, res) => {
    res.json(markTicketRead(String(req.params.id), req.auth!.user));
  }),
);

ticketsRouter.post(
  "/:id/close",
  asyncHandler((req, res) => {
    res.json(closeTicket(String(req.params.id), req.auth!.user, requestIp(req)));
  }),
);
