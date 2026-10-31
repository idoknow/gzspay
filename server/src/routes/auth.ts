import { Router } from "express";
import { config, canExposeDevCode } from "../config.js";
import { queryOne } from "../db/index.js";
import { writeLoginLog } from "../lib/audit.js";
import {
  completeAuthorization,
  createAuthorizationRequest,
  devProfile,
} from "../lib/campux.js";
import { AppError, errors } from "../lib/errors.js";
import { asyncHandler, attachUser } from "../lib/http.js";
import {
  clearSessionCookie,
  issueSession,
  revokeSessionByToken,
  sessionTokenFromRequest,
  setSessionCookie,
} from "../lib/session.js";
import type { AdminRow } from "../lib/types.js";
import { requestIp } from "../lib/types.js";
import { loginOrRegister, toMe } from "../services/users.js";

export const authRouter: Router = Router();

function adminRoleOf(userId: string): AdminRow | undefined {
  return queryOne<AdminRow>("SELECT * FROM admins WHERE user_id = ?", userId);
}

authRouter.get("/session", attachUser, (req, res) => {
  const auth = req.auth;
  if (!auth) {
    res.json({ authenticated: false, isAdmin: false });
    return;
  }
  res.json({
    authenticated: true,
    onboarded: auth.user.onboarded === 1,
    onboardStep: auth.user.onboard_step,
    isAdmin: adminRoleOf(auth.user.id) !== undefined,
    me: toMe(auth.user),
  });
});

authRouter.get("/login", (req, res, next) => {
  try {
    const redirectTo = typeof req.query.redirect === "string" ? req.query.redirect : null;
    const url = createAuthorizationRequest("user", redirectTo);
    res.redirect(302, url);
  } catch (error) {
    next(error);
  }
});

function errorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f7fb;color:#1d2939;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
.card{max-width:420px;background:#fff;border-radius:20px;padding:28px;box-shadow:0 12px 30px rgba(16,42,99,.12)}
h1{font-size:20px;margin:0 0 12px;color:#0b2a6b}p{line-height:1.7;color:#475467}
a.btn{display:inline-block;margin-top:16px;background:#1a73e8;color:#fff;text-decoration:none;padding:10px 20px;border-radius:12px}</style>
</head><body><div class="card"><h1>${title}</h1><p>${message}</p><a class="btn" href="/login">重新登录</a></div></body></html>`;
}

authRouter.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const ip = requestIp(req);
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    try {
      const { profile, redirectTo } = await completeAuthorization("user", code, state);
      const result = loginOrRegister(
        { sub: profile.sub, qq: profile.qq, username: profile.username, tenantId: profile.tenantId },
        ip,
      );
      const issued = issueSession(result.user.id, "user", req);
      setSessionCookie(res, issued.token, "user");
      writeLoginLog({
        userId: result.user.id,
        campuxSub: profile.sub,
        method: "campux_user",
        success: true,
        ip,
        userAgent: req.headers["user-agent"],
      });
      if (!result.onboardingComplete) {
        res.redirect(302, `${config.appBaseUrl}/onboarding`);
        return;
      }
      res.redirect(302, `${config.appBaseUrl}${redirectTo ?? "/"}`);
    } catch (error) {
      const message = error instanceof AppError ? error.message : "登录失败，请稍后再试";
      writeLoginLog({
        userId: null,
        campuxSub: null,
        method: "campux_user",
        success: false,
        reason: message,
        ip,
        userAgent: req.headers["user-agent"],
      });
      res.status(400).type("html").send(errorPage("登录失败", message));
    }
  }),
);

authRouter.post("/logout", (req, res) => {
  const token = sessionTokenFromRequest(req, "user");
  if (token) revokeSessionByToken(token);
  clearSessionCookie(res, "user");
  res.json({ ok: true });
});

/** 开发环境模拟登录：不需要校园墙即可调试 */
authRouter.post(
  "/dev-login",
  asyncHandler(async (req, res) => {
    if (!canExposeDevCode()) throw errors.notFound("接口不存在");
    const body = req.body as { sub?: string; name?: string; username?: string; seed?: number } | undefined;
    const seed = Number.isInteger(body?.seed) ? (body?.seed as number) : 0;
    const profile = devProfile(seed);
    const identity = {
      sub: body?.sub ?? profile.sub,
      qq: body?.name ?? profile.qq,
      username: body?.username ?? profile.username,
      tenantId: profile.tenantId,
    };
    const result = loginOrRegister(identity, requestIp(req));
    const issued = issueSession(result.user.id, "user", req);
    setSessionCookie(res, issued.token, "user");
    writeLoginLog({
      userId: result.user.id,
      campuxSub: identity.sub,
      method: "dev",
      success: true,
      ip: requestIp(req),
    });
    res.json({ me: toMe(result.user), isNew: result.isNew });
  }),
);

