/** 启动加载页：logo 动画 + 真实进度条（最少停留 0.6s，超过 8s 提示网络慢，失败可重试）。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark, Tagline, Wordmark } from "../components/Logo";
import { runBoot, type BootProgress } from "../lib/boot";
import { errorMessage } from "../lib/http";
import { useWatchLayout } from "../lib/hooks";
import type { SessionResponse } from "../lib/types";

export interface BootPageProps {
  /** 加载完成（含会话检查）后回调，由上层决定跳转 */
  onReady: (session: SessionResponse) => void;
}

export function BootPage({ onReady }: BootPageProps): ReactNode {
  const watch = useWatchLayout();
  const [progress, setProgress] = useState<BootProgress>({ loaded: 0, total: 0, ratio: 0 });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  // 上层传回的 onReady 可能是内联箭头函数，用 ref 固定引用，避免进度更新时重启加载
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let active = true;
    setError(null);
    setSlow(false);
    setProgress({ loaded: 0, total: 0, ratio: 0 });

    const slowTimer = window.setTimeout(() => {
      if (active) setSlow(true);
    }, 8000);

    runBoot({
      onProgress: (next) => {
        if (active) setProgress(next);
      },
    })
      .then((result) => {
        if (active) onReadyRef.current(result.session);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        window.clearTimeout(slowTimer);
      });

    return () => {
      active = false;
      window.clearTimeout(slowTimer);
    };
  }, [attempt]);

  const percent = progress.ratio > 0 ? Math.round(Math.min(1, progress.ratio) * 100) : 0;
  const barWidth = error ? 100 : Math.max(6, percent);

  return (
    <div className="bg-app flex min-h-[100dvh] flex-col items-center justify-center px-8 py-10">
      <div className="flex flex-1 flex-col items-center justify-center">
        <LogoMark size={watch ? 76 : 112} animated />
        <Wordmark size={watch ? "lg" : "display"} animated className="mt-5 watch:mt-3" />
        <Tagline animated className="mt-4 watch:mt-2" />
        <p className="mt-3 text-sm text-muted animate-fade-in watch:mt-2 watch:text-[11px]">桂中校园收付款</p>

        <div className="mt-10 w-full max-w-[300px] watch:mt-5 watch:max-w-[220px]">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2 watch:h-1">
            <div
              className={`progress-fill h-full rounded-full ${error ? "bg-danger" : "bg-gradient-to-r from-[#4a8dff] to-[#1e6bff]"}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <div className="mt-3 text-center text-xs text-muted watch:mt-2 watch:text-[10px]">
            <span>
              {error ? "加载失败" : percent >= 100 ? "即将进入…" : `正在加载 ${Math.max(percent, 1)}%`}
            </span>
          </div>
          {slow && !error ? (
            <p className="mt-3 text-center text-xs text-warning animate-fade-in watch:mt-1.5 watch:text-[10px]">
              网络较慢，仍在加载…
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="mt-6 w-full max-w-[320px] text-center animate-fade-in watch:mt-3">
            <p className="text-sm leading-relaxed text-danger watch:text-[11px]">{error}</p>
            <button type="button" className="btn btn-primary btn-block mt-4" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          </div>
        ) : null}
      </div>
      <p className="mt-8 text-center text-[11px] leading-relaxed text-muted watch:mt-3 watch:text-[9px]">
        资金通过第三方收款码流转，gzspay 不代收代付
      </p>
    </div>
  );
}
