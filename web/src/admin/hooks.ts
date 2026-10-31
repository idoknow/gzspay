/**
 * 管理后台通用 hooks：异步加载、防抖、主题模式。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/http";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** 静默刷新（不显示骨架屏） */
  refresh: () => void;
}

/**
 * 通用异步加载：deps 变化或手动 reload 时重新请求。
 * 自动忽略组件卸载后的响应。
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // 首次加载显示骨架屏；后续刷新保留旧数据，避免闪烁
    if (!loadedRef.current) setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (cancelled) return;
        loadedRef.current = true;
        setData(result);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(errorMessage(caught));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => {
    loadedRef.current = false;
    setTick((value) => value + 1);
  }, []);

  const refresh = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  return { data, loading, error, reload, refresh };
}

/** 输入防抖 */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "gzspay.admin.theme";

function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "auto" || stored === "light" || stored === "dark") return stored;
  } catch {
    // 隐私模式等场景忽略 localStorage 异常
  }
  return "auto";
}

/** 主题：跟随系统 / 浅色 / 深色，localStorage 记忆 */
export function useTheme(): {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(readStoredTheme);
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 忽略存储失败
    }
  }, []);

  const resolved: ResolvedTheme =
    mode === "auto" ? (systemDark ? "dark" : "light") : mode;

  return { mode, resolved, setMode };
}

/** 定时轮询：每 intervalMs 调用一次 tick 回调（页面不可见时跳过） */
export function usePolling(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      callbackRef.current();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, enabled]);
}
