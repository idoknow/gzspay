/** 系统尚未初始化拦截页：引导管理员先去管理后台完成初始化配置（校园墙登录、发件配置、站点信息）。 */

import { useState, type ReactNode } from "react";
import { LogoMark } from "../components/Logo";
import { Spinner } from "../components/Loading";
import { getSetupStatus } from "../lib/api";
import { errorMessage } from "../lib/http";
import { useWatchLayout } from "../lib/hooks";
import type { SetupStatus } from "../lib/types";

export interface SystemNotReadyPageProps {
  /** 初始化状态（拿不到时为 null，页面仍可展示与重试） */
  status: SetupStatus | null;
}

export function SystemNotReadyPage({ status }: SystemNotReadyPageProps): ReactNode {
  const watch = useWatchLayout();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const siteName = status?.system?.siteName?.trim() ?? "";

  /** 前往管理后台（同 SPA 的不同入口，整页跳转确保后台状态机重新初始化） */
  const handleGoAdmin = (): void => {
    window.location.href = "/admin";
  };

  /** 管理员在后台完成初始化后，主站无需手动刷新即可重新检查 */
  const handleRecheck = async (): Promise<void> => {
    if (checking) return;
    setChecking(true);
    setNote(null);
    try {
      const next = await getSetupStatus();
      if (next.initialized) {
        window.location.assign("/");
        return;
      }
      setNote("仍未初始化");
    } catch (cause) {
      setNote(errorMessage(cause));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="bg-app flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10 watch:px-3 watch:py-5">
      <div className="card w-full max-w-[400px] px-6 py-8 text-center watch:max-w-full watch:px-4 watch:py-5">
        <div className="flex justify-center">
          <LogoMark size={watch ? 56 : 76} />
        </div>

        <h1 className="mt-6 text-xl font-bold text-text watch:mt-4 watch:text-base">系统尚未初始化</h1>

        <p className="mt-3 text-sm leading-relaxed text-muted watch:mt-2 watch:text-[12px]">
          请管理员完成初始化配置
        </p>

        {siteName ? (
          <p className="mt-3 text-sm text-muted watch:mt-2 watch:text-[12px]">站点：{siteName}</p>
        ) : null}

        <button
          type="button"
          className="btn btn-primary btn-block mt-6 watch:mt-4"
          onClick={handleGoAdmin}
        >
          前往管理后台
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-block mt-2 text-sm watch:mt-1 watch:text-[12px]"
          onClick={() => void handleRecheck()}
          disabled={checking}
        >
          {checking ? <Spinner size={16} /> : null}
          重新检查
        </button>

        {note ? (
          <p role="alert" className="mt-3 text-xs leading-relaxed text-warning watch:mt-2 watch:text-[11px]">
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
}
