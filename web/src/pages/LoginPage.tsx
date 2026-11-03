/** 登录页：仅「使用校园墙账号登录」一个入口；未配置校园墙登录时禁用入口并提示。 */

import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { LegalDocLinks } from "../components/LegalDocLinks";
import { LogoMark, Tagline, Wordmark } from "../components/Logo";
import { SiteIcp } from "../components/SiteIcp";
import { getSetupStatus, LOGIN_URL } from "../lib/api";
import { useWatchLayout } from "../lib/hooks";
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
  const [params] = useSearchParams();
  const watch = useWatchLayout();
  const { authenticated, onboarded } = useAuth();
  /** 校园墙登录是否可用：null 表示状态未知（读取失败或仍在读取） */
  const [campuxConfigured, setCampuxConfigured] = useState<boolean | null>(null);
  /** 站点备案号（读取失败则留空，不展示） */
  const [icp, setIcp] = useState("");
  const redirect = safeRedirect(params.get("redirect"));
  const authError = params.get("auth_error");

  // 读取初始化状态：未配置校园墙登录时禁用入口并给出提示；读取失败不阻塞（由后端登录接口自行报错）
  useEffect(() => {
    let active = true;
    getSetupStatus()
      .then((status) => {
        if (!active) return;
        setCampuxConfigured(status.campuxConfigured);
        setIcp(status.system.icp ?? "");
      })
      .catch(() => {
        // 忽略：状态未知时保持入口可用
      });
    return () => {
      active = false;
    };
  }, []);

  if (authenticated) {
    return <Navigate to={onboarded ? redirect : "/onboarding"} replace />;
  }

  const campuxUnavailable = campuxConfigured === false;

  return (
    <div className="bg-app flex min-h-[100dvh] flex-col px-6 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),40px)] watch:px-3 watch:pb-[max(env(safe-area-inset-bottom),10px)] watch:pt-[max(env(safe-area-inset-top),12px)]">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="relative flex flex-col items-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-8 h-44 w-44 rounded-full bg-accent/30 blur-3xl watch:-top-4 watch:h-24 watch:w-24"
          />
          <LogoMark size={watch ? 64 : 96} animated />
          <Wordmark size={watch ? "md" : "xl"} animated className="mt-5 watch:mt-3" />
          <Tagline animated className="mt-3 watch:mt-1.5" />
          <p className="mt-2 text-sm text-muted watch:mt-1 watch:text-[11px]">桂中校园服务</p>
        </div>

        <div className="mt-10 w-full max-w-[360px] space-y-3 watch:mt-5 watch:space-y-2">
          {authError ? (
            <div className="rounded-2xl bg-danger-soft px-4 py-3 text-sm leading-relaxed text-danger animate-fade-in watch:rounded-xl watch:px-3 watch:py-2 watch:text-[11px]">
              {authErrorText(authError)}
            </div>
          ) : null}

          {campuxUnavailable ? (
            <>
              <span
                className="btn btn-primary btn-block h-[52px] cursor-not-allowed text-base opacity-50 watch:h-9 watch:text-[13px]"
                aria-disabled="true"
              >
                使用校园墙账号登录
              </span>
              <div
                role="alert"
                className="rounded-2xl bg-warning-soft px-4 py-3 text-sm leading-relaxed text-warning animate-fade-in watch:rounded-xl watch:px-3 watch:py-2 watch:text-[11px]"
              >
                管理员尚未配置校园墙登录，暂时无法登录
              </div>
            </>
          ) : (
            <a
              href={LOGIN_URL}
              className="btn btn-primary btn-block h-[52px] text-base watch:h-9 watch:text-[13px]"
            >
              使用校园墙账号登录
            </a>
          )}
          <p className="text-center text-xs leading-relaxed text-muted watch:text-[10px]">
            使用校园墙账号授权登录，无需额外注册
          </p>
        </div>
      </div>

      <div className="mt-10 text-center watch:mt-4">
        <p className="text-[11px] text-muted watch:text-[9px]">
          <LegalDocLinks prefix="登录即代表你已阅读并同意" />
        </p>
        <div className="mt-2 watch:mt-1">
          <SiteIcp icp={icp} className="text-[10px] watch:text-[9px]" />
        </div>
      </div>
    </div>
  );
}
