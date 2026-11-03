/** 付款人视角：打开商家收款单并确认付款（支持收款链接令牌，或扫商家校园卡后按 id）。 */

import { Router } from "express";
import { z } from "zod";
import { errors } from "../lib/errors.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { rateLimit, userKey } from "../lib/rate-limit.js";
import { parse } from "../lib/validate.js";
import { requestIp } from "../lib/types.js";
import {
  payPaymentCollection,
  payPaymentCollectionById,
  previewPaymentCollection,
  previewPaymentCollectionById,
} from "../services/collections.js";

export const collectionsRouter: Router = Router();

collectionsRouter.use(requireUser());

const paySchema = z.object({
  paymentPassword: z.string().trim().min(1, "请输入支付密码"),
});

const payRateLimit = rateLimit({
  scope: "collections.pay",
  limit: 10,
  windowSeconds: 60,
  keyBy: userKey,
  message: "付款操作太频繁了，请稍后再试",
});

/** 扫商家校园卡后按 id 预览收款单（收款单令牌只存哈希，扫卡拿不到令牌） */
collectionsRouter.get(
  "/id/:id",
  asyncHandler((req, res) => {
    res.json(previewPaymentCollectionById(String(req.params.id), req.auth!.user));
  }),
);

/** 扫商家校园卡后按 id 确认付款 */
collectionsRouter.post(
  "/id/:id/pay",
  payRateLimit,
  asyncHandler((req, res) => {
    const body = parse(paySchema, req.body);
    const result = payPaymentCollectionById(
      String(req.params.id),
      req.auth!.user,
      body.paymentPassword,
      requestIp(req),
    );
    res.status(201).json(result);
  }),
);

/** 打开收款链接后的预览：返回商家、金额、商品与状态 */
collectionsRouter.get(
  "/:token",
  asyncHandler((req, res) => {
    res.json(previewPaymentCollection(String(req.params.token), req.auth!.user));
  }),
);

/** 通过收款链接确认付款：校验支付密码后按收款单金额创建订单 */
collectionsRouter.post(
  "/:token/pay",
  payRateLimit,
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
