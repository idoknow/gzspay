/** 通用弹窗：居中对话框 / 底部弹层。 */

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/hooks";
import { cn } from "../lib/format";

export interface DialogProps {
  open: boolean;
  /** 关闭回调；不传时点击蒙层、按 Esc 均不关闭 */
  onClose?: () => void;
  title?: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** center：居中卡片；sheet：底部弹层（内置键盘等） */
  variant?: "center" | "sheet";
  /** 是否允许关闭（默认 true） */
  closable?: boolean;
  /** 是否显示右上角关闭按钮（默认 true） */
  showClose?: boolean;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "center",
  closable = true,
  showClose = true,
  className,
}: DialogProps): ReactNode {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && closable && onClose) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closable, onClose]);

  if (!open) return null;

  const close = (): void => {
    if (closable && onClose) onClose();
  };

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[110] flex justify-center bg-black/45 backdrop-blur-[2px]",
        variant === "sheet" ? "items-end" : "items-center px-5",
      )}
      role="presentation"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "animate-slide-up hide-scrollbar max-h-[92dvh] w-full max-w-[440px] overflow-y-auto border border-line bg-surface text-text shadow-[var(--shadow-float)]",
          variant === "sheet"
            ? "rounded-t-[26px] border-b-0 px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-3 watch:px-3.5 watch:pt-2 watch:pb-[calc(12px+env(safe-area-inset-bottom))]"
            : "rounded-[26px] px-5 py-5 watch:rounded-2xl watch:px-3.5 watch:py-3.5",
          className,
        )}
      >
        {variant === "sheet" ? (
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-surface-3 watch:mb-2 watch:h-1 watch:w-8" aria-hidden="true" />
        ) : null}
        {title || showClose ? (
          <div className="mb-1 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {title ? <h2 className="text-lg font-bold text-text watch:text-[15px]">{title}</h2> : null}
              {description ? (
                <p className="mt-1 text-sm leading-relaxed text-muted watch:mt-0.5 watch:text-[11px]">
                  {description}
                </p>
              ) : null}
            </div>
            {showClose && closable ? (
              <button
                type="button"
                onClick={close}
                aria-label="关闭"
                className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition active:bg-surface-2 watch:-mr-0.5 watch:-mt-0.5 watch:h-7 watch:w-7"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="watch:h-4 watch:w-4">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={title ? "mt-3 watch:mt-2" : ""}>{children}</div>
        {footer ? <div className="mt-5 watch:mt-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
