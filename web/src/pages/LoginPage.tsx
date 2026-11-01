/** 登录页：仅「使用校园墙账号登录」一个入口；开发环境额外提供 dev-login。 */

import { useState, type ReactNode } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { LogoMark, Tagline, Wordmark } from "../components/Logo";
import { Spinner } from "../components/Loading";
import { useToast } from "../components/Toast";
import { devLogin, LOGIN_URL } from "../lib/api";
import { errorMessage } from "../lib/http";
import { useAuth } from "../lib/session";

function safeRedirect(raw: string | null): string {
  if (!raw) return "/trades";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/trades";
  return raw;
}

function authErrorText(raw: string): string {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (lower === "denied" || lower === "cancel" || lower === "cancelled" || lower === "access_denied") {
    return "已取消校园墙登录";
  }
  if (lower === "state" || lower === "invalid_state" || lower === "expired") {
    return "登录已过期，请重新登录";
  }
  if (/[\u4e00-\u9fa5]/.test(value)) return value;
  return `登录失败（${value}），请重试`;
}

export function LoginPage(): ReactNode {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const { authenticated, onboarded, setSession } = useAuth();
  const [devBusy, setDevBusy] = useState(false);
  const redirect = safeRedirect(params.get("redirect"));
  const authError = params.get("auth_error");

  if (authenticated) {
    return <Navigate to={onboarded ? redirect : "/onboarding"} replace />;
  }

  const handleDevLogin = async (): Promise<void> => {
    if (devBusy) return;
    setDevBusy(true);
    try {
      const result = await devLogin();
      setSession({
        authenticated: true,
        me: result.me,
        onboardStep: result.me.onboardStep,
        isAdmin: result.me.isAdmin,
      });
      navigate(result.me.onboarded ? redirect : "/onboarding", { replace: true });
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setDevBusy(false);
    }
  };

  return (
    <div className="bg-app flex min-h-[100dvh] flex-col px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),40px)]">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="relative flex flex-col items-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 h-44 w-44 rounded-full bg-brand/25 blur-3xl"
          />
          <LogoMark size={96} animated />
          <Wordmark size="xl" animated className="mt-5" />
          <Tagline animated className="mt-3" />
          <p className="mt-2 text-sm text-muted">桂中校园收付款</p>
        </div>

        <div className="mt-10 w-full max-w-[360px] space-y-3">
          {authError ? (
            <div className="rounded-2xl bg-danger-soft px-4 py-3 text-sm leading-relaxed text-danger animate-fade-in">
              {authErrorText(authError)}
            </div>
          ) : null}

          <a href={LOGIN_URL} className="btn btn-primary btn-block h-[52px] text-base">
            使用校园墙账号登录
          </a>
          <p className="text-center text-xs leading-relaxed text-muted">
            使用校园墙账号授权登录，无需额外注册
          </p>

          {import.meta.env.DEV ? (
            <button type="button" className="btn btn-outline btn-block" disabled={devBusy} onClick={() => void handleDevLogin()}>
              {devBusy ? <Spinner size={18} /> : null}
              开发者登录（仅开发环境）
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-10 space-y-2 text-center">
        <p className="text-[11px] leading-relaxed text-muted">
          资金通过第三方收款码流转，gzspay 不代收代付
          <br />
          付款前请核对收款方信息
        </p>
        <p className="text-[11px] text-muted">登录即代表你已阅读并同意服务条款与隐私协议</p>
      </div>
    </div>
  );
}
