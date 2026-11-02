/**
 * 内置安全键盘：6 位数字，固定 1-9 / 0 顺序，只用按钮输入（不弹系统键盘），
 * 屏幕只显示圆点、不回显明文。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/format";
import { errorMessage } from "../lib/http";
import { Spinner } from "./Loading";

/** 固定数字键顺序（1-9 后再接 0），不随机打乱 */
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const ZERO = 0;

export interface BuiltInKeypadProps {
  title?: string;
  description?: string;
  /** 密码位数，默认 6 */
  length?: number;
  /** 输入满后自动提交；抛错时展示错误并清空输入 */
  onSubmit: (value: string) => Promise<void> | void;
  onCancel?: () => void;
  cancelText?: string;
  /** 键盘下方的附加内容（如「忘记密码」入口） */
  footerExtra?: ReactNode;
  className?: string;
}

export function BuiltInKeypad({
  title,
  description,
  length = 6,
  onSubmit,
  onCancel,
  cancelText = "取消",
  footerExtra,
  className,
}: BuiltInKeypadProps): ReactNode {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const submit = useCallback(async (password: string) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      await onSubmitRef.current(password);
      setValue("");
      setError(null);
    } catch (reason: unknown) {
      setValue("");
      setError(errorMessage(reason));
      if (typeof navigator.vibrate === "function") navigator.vibrate(60);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (value.length !== length) return;
    const timer = window.setTimeout(() => {
      void submit(value);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [value, length, submit]);

  const appendDigit = useCallback(
    (digit: number) => {
      if (submittingRef.current) return;
      setError(null);
      setValue((current) => (current.length >= length ? current : current + String(digit)));
    },
    [length],
  );

  const removeLast = useCallback(() => {
    if (submittingRef.current) return;
    setError(null);
    setValue((current) => current.slice(0, -1));
  }, []);

  // 桌面端物理键盘辅助（移动端不会因此弹出系统键盘）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        appendDigit(Number(event.key));
      } else if (event.key === "Backspace") {
        event.preventDefault();
        removeLast();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appendDigit, removeLast]);

  const dots = Array.from({ length }, (_, index) => index);
  const keyClass =
    "flex h-14 select-none items-center justify-center rounded-2xl bg-surface-2 text-2xl font-semibold text-text transition active:scale-[0.98] active:bg-surface-3 disabled:opacity-40 watch:h-9 watch:rounded-xl watch:text-lg";

  return (
    <div className={cn("w-full", className)}>
      {title ? (
        <div className="mb-4 text-center watch:mb-2">
          <p className="text-base font-bold text-text watch:text-[13px]">{title}</p>
          {description ? (
            <p className="mt-1 text-sm text-muted watch:mt-0.5 watch:text-[11px]">{description}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-center gap-3 py-1 watch:gap-1.5 watch:py-0.5" aria-label="已输入位数">
        {dots.map((index) => (
          <span
            key={index}
            className={cn(
              "h-3.5 w-3.5 rounded-full border transition-colors watch:h-2.5 watch:w-2.5",
              index < value.length ? "border-brand bg-brand" : "border-line bg-surface-2",
            )}
          />
        ))}
      </div>

      <div className="flex min-h-6 items-center justify-center pt-2 watch:min-h-4 watch:pt-1">
        {busy ? (
          <span className="flex items-center gap-2 text-xs text-muted watch:text-[10px]">
            <Spinner size={14} /> 验证中…
          </span>
        ) : error ? (
          <span
            className="animate-fade-in text-center text-[13px] font-medium text-danger watch:text-[11px]"
            role="alert"
          >
            {error}
          </span>
        ) : (
          <span className="text-xs text-muted watch:text-[10px]">密码只在本机输入</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2.5 watch:mt-2 watch:gap-1.5">
        {DIGITS.map((digit) => (
          <button
            key={`digit-${digit}`}
            type="button"
            className={keyClass}
            disabled={busy}
            onClick={() => appendDigit(digit)}
          >
            {digit}
          </button>
        ))}
        <span aria-hidden="true" />
        <button type="button" className={keyClass} disabled={busy} onClick={() => appendDigit(ZERO)}>
          {ZERO}
        </button>
        <button
          type="button"
          aria-label="删除"
          className={keyClass}
          disabled={busy}
          onClick={removeLast}
        >
          <svg
            className="h-6 w-6 watch:h-4 watch:w-4"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9 5h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9L3 12l6-7Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <path d="M12 9.5l4 5M16 9.5l-4 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 watch:mt-2 watch:gap-2">
        {onCancel ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
        ) : (
          <span />
        )}
        {footerExtra}
      </div>
    </div>
  );
}
