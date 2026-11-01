import { Router, type Request } from "express";
import { z } from "zod";
import { errors } from "../lib/errors.js";
import { asyncHandler } from "../lib/http.js";
import { requestIp } from "../lib/types.js";
import { finishSetup, saveSetupConfig, setupStatus } from "../services/setup.js";
import { displayNameOf } from "../services/users.js";

export const setupRouter: Router = Router();

function currentUserOf(req: Request): { id: string; displayName: string; avatarUrl: string | null } | null {
  const user = req.auth?.user;
  if (!user) return null;
  return { id: user.id, displayName: displayNameOf(user), avatarUrl: user.avatar_url };
}

function statusPayload(req: Request) {
  return { ...setupStatus(), currentUser: currentUserOf(req) };
}

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
      adminQq: z.string().trim().max(30).optional().default(""),
      publicBaseUrl: urlField.optional(),
    })
    .optional(),
});

/** 保存初始化配置（可分步提交；密钥/密码留空表示不修改） */
setupRouter.post(
  "/config",
  asyncHandler((req, res) => {
    const payload = setupConfigSchema.parse(req.body ?? {});
    if (!payload.campux && !payload.mail && !payload.system) {
      throw errors.validation("没有需要保存的配置");
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
