/**
 * 公开的 NFC 卡片接口：别人用手机贴一贴读到的链接就是这里。
 * 不需要登录，只返回姓名、头像与打码后的卡号，令牌可由用户在客户端随时更换。
 */
import { Router } from "express";
import { rateLimit } from "../lib/rate-limit.js";
import { publicCardByToken } from "../services/nfc.js";

export const nfcRouter: Router = Router();

const cardLimit = rateLimit({
  scope: "nfc.card",
  limit: 60,
  windowSeconds: 60,
  message: "读取太频繁了，请稍后再试",
});

nfcRouter.get("/:token", cardLimit, (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json(publicCardByToken(String(req.params.token ?? "")));
});
