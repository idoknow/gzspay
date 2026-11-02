import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { errors } from "../lib/errors.js";
import { asyncHandler, requireUser } from "../lib/http.js";
import { maskCardNo } from "../lib/crypto.js";
import { rateLimit, userKey } from "../lib/rate-limit.js";
import { recordTraffic } from "../lib/traffic.js";
import { parse } from "../lib/validate.js";
import { isMerchant, publicUserOf, resolveCardOwner } from "../services/users.js";

export const scanRouter: Router = Router();

/**
 * 扫描校园卡二维码解析身份（静态码只用于认人，不能授权支付）。
 * 付款人扫商家卡 → 拿 merchantUserId 进商家主页；
 * 商家扫客户卡 → 拿 customerId 创建收款订单。
 */
scanRouter.post(
  "/card",
  requireUser(),
  // 扫卡接口按学号 / 卡号反查身份，限制频率以降低枚举风险
  rateLimit({
    scope: "scan.card",
    limit: config.security.rateLimitScanPerMinute,
    windowSeconds: 60,
    keyBy: userKey,
    message: "扫码太频繁了，请稍后再试",
  }),
  asyncHandler((req, res) => {
    const body = parse(z.object({ cardContent: z.string().trim().min(1, "请扫描校园卡二维码") }), req.body);
    const owner = resolveCardOwner(body.cardContent);
    if (!owner) {
      throw errors.notFound("该校园卡尚未绑定 gzspay 账号，请提醒对方先注册");
    }
    if (owner.status === "frozen") throw errors.locked("该账号已被冻结");
    // 统计：校园卡被扫（只记次数，不记卡号 / 身份）
    recordTraffic("scan", "campus_card");
    res.json({
      user: publicUserOf(owner),
      isMerchant: isMerchant(owner.id),
      isSelf: owner.id === req.auth!.user.id,
      cardNoMasked: owner.card_no ? maskCardNo(owner.card_no) : null,
    });
  }),
);
