/** 加载 / 错误提示块。 */

import type { ReactNode } from "react";
import { cn } from "../lib/format";

export function Spinner({ size = 22, className }: { size?: number; className?: string }): ReactNode {
  return (
    <span
      className={cn(
        "inline-block animate-spin-slow rounded-full border-2 border-brand/25 border-t-brand",
        className,
      )}
      style={{ width: size, height: size }}
      role="status"
      aria-label="加载中"
    />
  );
}

export function LoadingBlock({ text = "加载中…" }: { text?: string }): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-muted">
      <Spinner size={26} />
      <p className="text-sm">{text}</p>
    </div>
  );
}

export function PageLoading({ text }: { text?: string }): ReactNode {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <LoadingBlock text={text} />
    </div>
  );
}

export interface ErrorBlockProps {
  message: string;
  onRetry?: () => void;
  retryText?: string;
  compact?: boolean;
}

export function ErrorBlock({ message, onRetry, retryText = "重试", compact = false }: ErrorBlockProps): ReactNode {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 text-center",
        compact ? "py-8" : "py-14",
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-danger-soft text-danger">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16.4" r="1.1" fill="currentColor" />
        </svg>
      </div>
      <p className="max-w-[300px] text-sm text-muted">{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          {retryText}
        </button>
      ) : null}
    </div>
  );
}

/** 表单行内错误提示 */
export function InlineError({ message }: { message: string | null }): ReactNode {
  if (!message) return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[13px] text-danger" role="alert">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16.4" r="1.1" fill="currentColor" />
      </svg>
      <span>{message}</span>
    </p>
  );
}
