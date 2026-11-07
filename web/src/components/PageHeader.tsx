/** 页面头部：返回按钮 + 标题 + 右侧操作。 */

import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "../lib/format";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** 显示返回按钮（默认 false） */
  back?: boolean;
  /** 自定义返回行为；默认 history.back()，无历史时回交易页 */
  onBack?: () => void;
  right?: ReactNode;
  /** 透明背景（用于覆盖在内容上的场景） */
  transparent?: boolean;
  className?: string;
  /** 桌面端放宽头部容器（例如宽屏列表页），默认与页面同宽 520px */
  containerClassName?: string;
}

export function PageHeader({
  title,
  subtitle,
  back = false,
  onBack,
  right,
  transparent = false,
  className,
  containerClassName,
}: PageHeaderProps): ReactNode {
  const navigate = useNavigate();

  const handleBack = (): void => {
    if (onBack) {
      onBack();
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/trades", { replace: true });
    }
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-30 safe-top",
        transparent ? "bg-transparent" : "glass border-b border-line",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-[520px] items-center gap-3 px-4 py-3 watch:gap-2 watch:px-2.5 watch:py-2",
          containerClassName,
        )}
      >
        {back ? (
          <button
            type="button"
            onClick={handleBack}
            aria-label="返回"
            className="-ml-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text transition active:bg-surface-2 watch:-ml-0.5 watch:h-8 watch:w-8"
          >
            <svg
              className="h-[22px] w-[22px] watch:h-[18px] watch:w-[18px]"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M15 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold text-text watch:text-[15px]">{title}</h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-muted watch:text-[10px]">{subtitle}</p>
          ) : null}
        </div>
        {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
      </div>
    </header>
  );
}
