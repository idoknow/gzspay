/** 付款人视角：扫码打开商家收款单并确认付款。 */

import { Router } from "express";
import { z } from "zod";
import { errors } from "../lib/errors.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { rateLimit, userKey } from "../lib/rate-limit.js";
import { parse } from "../lib/validate.js";
import { requestIp } from "../lib/types.js";
import { payPaymentCollection, previewPaymentCollection } from "../services/collections.js";

export const collectionsRouter: Router = Router();

collectionsRouter.use(requireUser());

/** 扫码后的收款单预览：返回商家、金额、商品与状态 */
collectionsRouter.get(
  "/:token",
  asyncHandler((req, res) => {
    res.json(previewPaymentCollection(String(req.params.token), req.auth!.user));
  }),
);

const paySchema = z.object({
  paymentPassword: z.string().trim().min(1, "请输入支付密码"),
});

/** 确认付款：校验支付密码后按收款单金额创建订单 */
collectionsRouter.post(
  "/:token/pay",
  rateLimit({
    scope: "collections.pay",
    limit: 10,
    windowSeconds: 60,
    keyBy: userKey,
    message: "付款操作太频繁了，请稍后再试",
  }),
  asyncHandler((req, res) => {
    const raw = req.params.token;
    if (!raw) throw errors.validation("收款单链接不正确");
    const body = parse(paySchema, req.body);
    const result = payPaymentCollection(
      String(raw),
      req.auth!.user,
      body.paymentPassword,
      requestIp(req),
    );
    res.status(201).json(result);
  }),
);
