import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { CARD_QR_PREFIX } from "../lib/crypto.js";
import { errors } from "../lib/errors.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { rateLimit, userKey } from "../lib/rate-limit.js";
import { recordTraffic } from "../lib/traffic.js";
import { requestIp } from "../lib/types.js";
import { parse } from "../lib/validate.js";
import {
  acceptPaymentRequest,
  createPaymentRequest,
  getPaymentRequest,
  issueDynamicCode,
  listPendingPaymentRequests,
  rejectPaymentRequest,
  resolveDynamicCode,
} from "../services/dynamic.js";

export const dynamicRouter: Router = Router();

dynamicRouter.use(requireUser());

/** 开启动态码：30 秒刷新、60 秒过期、一次性令牌 */
dynamicRouter.post(
  "/",
  rateLimit({
    scope: "dynamic.issue",
    limit: config.security.rateLimitDynamicPerMinute,
    windowSeconds: 60,
    keyBy: userKey,
    message: "刷新太频繁了，请稍后再试",
  }),
  asyncHandler((req, res) => {
    const dto = issueDynamicCode(req.auth!.user);
    res.status(201).json({ ...dto, qrContent: `gzspay:dynamic:${dto.token}`, prefix: CARD_QR_PREFIX });
  }),
);

/** 扫码方解析动态码：只读，不消费令牌 */
dynamicRouter.get(
  "/:token/resolve",
  asyncHandler((req, res) => {
    const token = String(req.params.token).replace(/^gzspay:dynamic:/, "");
    const resolution = resolveDynamicCode(token, req.auth!.user, { consume: false });
    // 统计：平台动态码被扫（只记次数）
    recordTraffic("scan", "platform_dynamic");
    res.json(resolution);
  }),
);

const requestSchema = z.object({
  token: z.string().trim().min(6, "缺少动态码令牌"),
  amountCents: z.number().int().positive().optional(),
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(99).default(1) }))
    .max(20)
    .optional(),
  reservedNote: z.string().max(200).nullable().optional(),
});

/** 商家扫客户动态码后发起收款请求（消费令牌，实时推送到客户手机） */
dynamicRouter.post(
  "/request",
  rateLimit({
    scope: "dynamic.request",
    limit: config.security.rateLimitDynamicPerMinute,
    windowSeconds: 60,
    keyBy: userKey,
    message: "发起收款太频繁了，请稍后再试",
  }),
  asyncHandler((req, res) => {
    const body = parse(requestSchema, req.body);
    const token = body.token.replace(/^gzspay:dynamic:/, "");
    const dto = createPaymentRequest(
      req.auth!.user,
      {
        token,
        amountCents: body.amountCents,
        items: body.items?.map((item) => ({ productId: item.productId, quantity: item.quantity ?? 1 })),
        reservedNote: body.reservedNote,
      },
      requestIp(req),
    );
    // 统计：动态码发起收款（只记次数）
    recordTraffic("scan", "platform_dynamic_request");
    res.status(201).json(dto);
  }),
);

dynamicRouter.get(
  "/requests",
  asyncHandler((req, res) => {
    res.json({ items: listPendingPaymentRequests(req.auth!.user) });
  }),
);

dynamicRouter.get(
  "/requests/:id",
  asyncHandler((req, res) => {
    res.json(getPaymentRequest(String(req.params.id), req.auth!.user));
  }),
);

dynamicRouter.post(
  "/requests/:id/accept",
  asyncHandler((req, res) => {
    const body = parse(z.object({ paymentPassword: z.string().trim().min(1, "请输入支付密码") }), req.body);
    const result = acceptPaymentRequest(
      String(req.params.id),
      req.auth!.user,
      body.paymentPassword,
      requestIp(req),
    );
    res.json({ request: result.request, order: result.order, orderId: result.order.id });
  }),
);

dynamicRouter.post(
  "/requests/:id/reject",
  asyncHandler((req, res) => {
    res.json({
      request: rejectPaymentRequest(String(req.params.id), req.auth!.user, requestIp(req)),
    });
  }),
);

export function invalidDynamicToken(): never {
  throw errors.validation("动态码无效");
}
