import { Router, type Request } from "express";
import { z } from "zod";
import { errors } from "../lib/errors.js";
import { avatarPathOf } from "../lib/avatar.js";
import { asyncHandler } from "../lib/http.js";
import { clientIp, rateLimit } from "../lib/rate-limit.js";
import { setupTokenRequired, verifySetupToken } from "../lib/setup-token.js";
import { requestIp } from "../lib/types.js";
import { finishSetup, saveSetupConfig, setupStatus } from "../services/setup.js";
import { displayNameOf } from "../services/users.js";

export const setupRouter: Router = Router();

function currentUserOf(req: Request): { id: string; displayName: string; avatarUrl: string | null } | null {
  const user = req.auth?.user;
  if (!user) return null;
  return { id: user.id, displayName: displayNameOf(user), avatarUrl: avatarPathOf(user) };
}

function statusPayload(req: Request) {
  return {
    ...setupStatus(),
    currentUser: currentUserOf(req),
    /** true 表示页面需要填写服务端日志里打印的一次性初始化令牌 */
    setupTokenRequired: setupTokenRequired(),
  };
}

/**
 * 校验初始化令牌。
 *
 * 首次部署时攻击者可能抢在管理员前面调用初始化接口，因此写配置与
 * 「首个账号成为超级管理员」都要求先通过令牌校验。
 */
setupRouter.post(
  "/token",
  rateLimit({ scope: "setup.token", limit: 10, windowSeconds: 60, keyBy: clientIp }),
  asyncHandler((req, res) => {
    const body = z.object({ token: z.string().trim().min(1, "请填写初始化令牌").max(64) }).parse(req.body ?? {});
    if (!verifySetupToken(body.token)) {
      throw errors.forbidden("初始化令牌不正确，请查看服务端启动日志里的「初始化令牌」");
    }
    res.json({ ok: true, status: statusPayload(req) });
  }),
);

/** 初始化状态：无需登录即可读取 */
setupRouter.get("/status", (req, res) => {
  res.json(statusPayload(req));
});

const urlField = z
  .string()
  .trim()
  .min(1, "请填写地址")
  .max(300)
  .refine((value) => /^https?:\/\/[^\s]+$/i.test(value), "地址必须以 http:// 或 https:// 开头");

const setupConfigSchema = z.object({
  campux: z
    .object({
      baseUrl: urlField,
      clientId: z.string().trim().min(1, "请填写 Client ID").max(200),
      clientSecret: z.string().max(300).optional(),
      scope: z.string().trim().max(100).optional(),
    })
    .optional(),
  mail: z
    .object({
      host: z.string().trim().max(200),
      port: z.coerce.number().int().min(1).max(65535),
      secure: z.boolean(),
      username: z.string().trim().max(200),
      password: z.string().max(300).optional(),
      fromName: z.string().trim().max(100),
      fromAddress: z.string().trim().max(200),
    })
    .optional(),
  system: z
    .object({
      siteName: z.string().trim().min(1, "请填写站点名称").max(100),
      /** 校名（学校简称），可留空 */
      schoolName: z.string().trim().max(20).optional(),
      publicBaseUrl: urlField.optional(),
      /** ICP 备案号，可留空 */
      icp: z.string().trim().max(60).optional(),
    })
    .optional(),
});

/** 保存初始化配置（可分步提交；密钥/密码留空表示不修改） */
setupRouter.post(
  "/config",
  rateLimit({ scope: "setup.config", limit: 20, windowSeconds: 60, keyBy: clientIp }),
  asyncHandler((req, res) => {
    const payload = setupConfigSchema.parse(req.body ?? {});
    if (!payload.campux && !payload.mail && !payload.system) {
      throw errors.validation("没有需要保存的配置");
    }
    // 未初始化阶段任何人都能访问这个接口，必须要求一次性初始化令牌，
    // 否则攻击者可以抢先写入自己的 campux.baseUrl（伪造 IdP）并接管管理员账号。
    const token = req.header("x-setup-token") ?? "";
    if (!verifySetupToken(token)) {
      throw errors.forbidden(
        "请先填写初始化令牌（服务端启动日志里的「初始化令牌」），再保存初始化配置",
      );
    }
    saveSetupConfig(payload, requestIp(req));
    res.json({ ok: true, status: statusPayload(req) });
  }),
);

/** 完成初始化：当前登录账号成为超级管理员 */
setupRouter.post(
  "/finish",
  asyncHandler((req, res) => {
    if (!req.auth) throw errors.unauthenticated("请先用校园墙账号登录");
    const admin = finishSetup(req.auth.user, requestIp(req));
    res.json({
      ok: true,
      admin: { id: req.auth.user.id, displayName: displayNameOf(req.auth.user), role: admin.role },
    });
  }),
);
