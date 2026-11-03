import { Router } from "express";
import { config, isCampuxConfigured } from "../config.js";
import { execute, isoAfter, nowIso, queryOne } from "../db/index.js";
import { writeAudit, writeLoginLog } from "../lib/audit.js";
import { completeAuthorization, createAuthorizationRequest } from "../lib/campux.js";
import { randomToken } from "../lib/crypto.js";
import { AppError, errors } from "../lib/errors.js";
import { asyncHandler, attachUser } from "../lib/http.js";
import { rateLimit } from "../lib/rate-limit.js";
import { readSystemConfig } from "../lib/runtime-config.js";
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

/** 校园墙「再验证」通过后，验证凭证的有效期（秒） */
const CAMPUX_VERIFICATION_TTL_SECONDS = 300;

function adminRoleOf(userId: string): AdminRow | undefined {
  return queryOne<AdminRow>("SELECT * FROM admins WHERE user_id = ?", userId);
}

authRouter.get("/session", attachUser, (req, res) => {
  const auth = req.auth;
  const system = readSystemConfig();
  const site = { name: system.siteName, schoolName: system.schoolName, icp: system.icp };
  if (!auth) {
    res.json({
      authenticated: false,
      isAdmin: false,
      campuxConfigured: isCampuxConfigured(),
      site,
    });
    return;
  }
  res.json({
    authenticated: true,
    onboarded: auth.user.onboarded === 1,
    onboardStep: auth.user.onboard_step,
    isAdmin: adminRoleOf(auth.user.id) !== undefined,
    campuxConfigured: isCampuxConfigured(),
    site,
    me: toMe(auth.user),
  });
});

/** 发起校园墙登录（未配置时返回明确的 503，前端据此提示管理员） */
authRouter.get(
  "/login",
  rateLimit({
    scope: "auth.login",
    limit: config.security.rateLimitLoginPerMinute,
    windowSeconds: 60,
    message: "登录请求过于频繁，请稍后再试",
  }),
  (req, res, next) => {
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
  },
);

/** 转义 HTML，避免把上游返回的文案原样插进错误页（防御性处理） */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorPage(title: string, message: string): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f5f2;color:#171a20;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
.card{max-width:420px;background:#fff;border-radius:20px;padding:28px;box-shadow:0 12px 30px rgba(23,26,32,.12)}
h1{font-size:20px;margin:0 0 12px}p{line-height:1.7;color:#4a4f5a}
a.btn{display:inline-block;margin-top:16px;background:#171a20;color:#fff;text-decoration:none;padding:10px 20px;border-radius:12px}</style>
</head><body><div class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p><a class="btn" href="/login">重新登录</a></div></body></html>`;
}

authRouter.get(
  "/callback",
  rateLimit({
    scope: "auth.callback",
    limit: config.security.rateLimitCallbackPerMinute,
    windowSeconds: 60,
    message: "登录回调过于频繁，请稍后再试",
  }),
  asyncHandler(async (req, res) => {
    const ip = requestIp(req);
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    try {
      const { profile, redirectTo, purpose } = await completeAuthorization(code, state);

      // 修改支付密码时的「再授权一次」：只验证身份，不切换登录态
      if (purpose === "password_verify") {
        const auth = req.auth;
        if (!auth) {
          res
            .status(400)
            .type("html")
            .send(errorPage("验证失败", "登录已过期，请重新登录后再用校园墙验证"));
          return;
        }
        if (auth.user.campux_sub !== profile.sub) {
          writeAudit({
            actorId: auth.user.id,
            actorRole: "user",
            action: "payment_password.campux_mismatch",
            targetType: "user",
            targetId: auth.user.id,
            detail: "校园墙授权账号与当前登录账号不一致",
            ip,
          });
          res
            .status(403)
            .type("html")
            .send(
              errorPage(
                "验证失败",
                "授权的校园墙账号与当前登录账号不一致，请用本人账号重新验证",
              ),
            );
          return;
        }
        execute(
          "UPDATE password_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
          nowIso(),
          auth.user.id,
        );
        execute(
          "INSERT INTO password_verifications (id, user_id, method, expires_at, used_at, created_at) VALUES (?, ?, 'campux', ?, NULL, ?)",
          randomToken(16),
          auth.user.id,
          isoAfter(CAMPUX_VERIFICATION_TTL_SECONDS),
          nowIso(),
        );
        writeAudit({
          actorId: auth.user.id,
          actorRole: "user",
          action: "payment_password.campux_verified",
          targetType: "user",
          targetId: auth.user.id,
          detail: "校园墙授权验证通过",
          ip,
        });
        res.redirect(302, `${config.appBaseUrl}/me/password?campux=1`);
        return;
      }

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
