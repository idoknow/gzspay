/** 启动加载页：logo 动画 + 真实字节进度条（最少停留 0.6s，超过 8s 提示网络慢，失败可重试）。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "../components/Logo";
import { runBoot, type BootProgress } from "../lib/boot";
import { errorMessage } from "../lib/http";
import type { SessionResponse } from "../lib/types";

export interface BootPageProps {
  /** 加载完成（含会话检查）后回调，由上层决定跳转 */
  onReady: (session: SessionResponse) => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function BootPage({ onReady }: BootPageProps): ReactNode {
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
        <Logo size={104} animated />
        <p className="wordmark-in mt-6 text-[26px] font-bold tracking-[0.18em] text-brand">gzspay</p>
        <p className="mt-1.5 text-sm text-muted animate-fade-in">桂中校园收付款</p>

        <div className="mt-10 w-full max-w-[300px]">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`progress-fill h-full rounded-full ${error ? "bg-danger" : "bg-gradient-to-r from-[#4a8dff] to-[#1d55e8]"}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>
              {error ? "加载失败" : percent >= 100 ? "即将进入…" : `正在加载 ${Math.max(percent, 1)}%`}
            </span>
            <span className="text-amount">{formatBytes(progress.loaded)}</span>
          </div>
          {slow && !error ? (
            <p className="mt-3 text-center text-xs text-warning animate-fade-in">网络较慢，仍在加载…</p>
          ) : null}
        </div>

        {error ? (
          <div className="mt-6 w-full max-w-[320px] text-center animate-fade-in">
            <p className="text-sm leading-relaxed text-danger">{error}</p>
            <button type="button" className="btn btn-primary btn-block mt-4" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          </div>
        ) : null}
      </div>
      <p className="mt-8 text-center text-[11px] leading-relaxed text-muted">
        资金通过第三方收款码流转，gzspay 不代收代付
      </p>
    </div>
  );
}
