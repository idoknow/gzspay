import { Router } from "express";
import { config, isCampuxConfigured } from "../config.js";
import { queryOne } from "../db/index.js";
import { writeLoginLog } from "../lib/audit.js";
import { completeAuthorization, createAuthorizationRequest } from "../lib/campux.js";
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
import { ensureFirstAdmin } from "../services/setup.js";
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

/** 发起校园墙登录（未配置时返回明确的 503，前端据此提示管理员） */
authRouter.get("/login", (req, res, next) => {
  try {
    if (!isCampuxConfigured()) {
      throw new AppError(
        503,
        "CAMPUX_NOT_CONFIGURED",
        "管理员尚未配置校园墙登录，暂时无法登录",
      );
    }
    const redirectTo = typeof req.query.redirect === "string" ? req.query.redirect : null;
    const url = createAuthorizationRequest(redirectTo);
    res.redirect(302, url);
  } catch (error) {
    next(error);
  }
});

function errorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f5f2;color:#171a20;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
.card{max-width:420px;background:#fff;border-radius:20px;padding:28px;box-shadow:0 12px 30px rgba(23,26,32,.12)}
h1{font-size:20px;margin:0 0 12px}p{line-height:1.7;color:#4a4f5a}
a.btn{display:inline-block;margin-top:16px;background:#171a20;color:#fff;text-decoration:none;padding:10px 20px;border-radius:12px}</style>
</head><body><div class="card"><h1>${title}</h1><p>${message}</p><a class="btn" href="/login">重新登录</a></div></body></html>`;
}

authRouter.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const ip = requestIp(req);
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    try {
      const { profile, redirectTo } = await completeAuthorization(code, state);
      const result = loginOrRegister(
        { sub: profile.sub, qq: profile.qq, username: profile.username, tenantId: profile.tenantId },
        ip,
      );
      // 系统里还没有管理员时，第一个登录的账号自动成为超级管理员
      ensureFirstAdmin(result.user, ip);
      const issued = issueSession(result.user.id, req);
      setSessionCookie(res, issued.token);
      writeLoginLog({
        userId: result.user.id,
        campuxSub: profile.sub,
        method: "campux",
        success: true,
        ip,
        userAgent: req.headers["user-agent"],
      });
      const adminTarget = redirectTo === "/admin" || Boolean(redirectTo?.startsWith("/admin/"));
      if (!result.onboardingComplete && !adminTarget) {
        res.redirect(302, `${config.appBaseUrl}/onboarding`);
        return;
      }
      res.redirect(302, `${config.appBaseUrl}${adminTarget ? "/admin" : (redirectTo ?? "/")}`);
    } catch (error) {
      const message = error instanceof AppError ? error.message : "登录失败，请稍后再试";
      writeLoginLog({
        userId: null,
        campuxSub: null,
        method: "campux",
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
  const token = sessionTokenFromRequest(req);
  if (token) revokeSessionByToken(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** 退出登录的写请求走这里时也允许（保持与其他写接口一致的 CSRF 要求） */
authRouter.use((_req, _res, next) => {
  next(errors.notFound("接口不存在"));
});
