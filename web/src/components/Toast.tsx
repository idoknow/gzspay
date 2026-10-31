/** 轻提示 Toast：操作结果、错误提示统一走这里，不静默失败。 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../lib/format";

export type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_STYLE: Record<ToastTone, string> = {
  success: "bg-success text-white",
  error: "bg-danger text-white",
  info: "bg-text text-surface",
};

const TONE_ICON: Record<ToastTone, ReactNode> = {
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="16.4" r="1.1" fill="currentColor" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="1.1" fill="currentColor" />
    </svg>
  ),
};

let toastSeed = 0;

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, number>>(new Map());

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone) => {
      if (!message) return;
      toastSeed += 1;
      const id = toastSeed;
      setItems((current) => [...current.slice(-2), { id, message, tone }]);
      const timer = window.setTimeout(() => remove(id), tone === "error" ? 3600 : 2400);
      timers.current.set(id, timer);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => show(message, "success"),
      error: (message: string) => show(message, "error"),
      info: (message: string) => show(message, "info"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top,0px),12px)] z-[120] flex flex-col items-center gap-2 px-4">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "animate-slide-up pointer-events-auto flex max-w-[min(92vw,420px)] items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium shadow-lg",
              TONE_STYLE[item.tone],
            )}
            onClick={() => remove(item.id)}
          >
            <span className="shrink-0">{TONE_ICON[item.tone]}</span>
            <span className="leading-snug">{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast 必须在 ToastProvider 内使用");
  return context;
}
