/** 通用 hooks：异步加载、轮询、倒计时、滚动锁定、主题。 */

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./http";
import { getThemeMode, subscribeThemeMode, type ThemeMode } from "./theme";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (data: T | null) => void;
}

/** 通用异步数据加载：deps 变化或 reload() 时重新请求 */
export function useAsync<T>(factory: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    factoryRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(errorMessage(reason));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  return { data, loading, error, reload, setData };
}

/** 定时器 hook（delay 为 null 时暂停） */
export function useInterval(callback: () => void, delay: number | null): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    if (delay === null) return;
    const timer = window.setInterval(() => callbackRef.current(), delay);
    return () => window.clearInterval(timer);
  }, [delay]);
}

/** 当前时间（毫秒），用于倒计时展示 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export interface CountdownState {
  /** 剩余秒数 */
  remaining: number;
  running: boolean;
  /** 从 seconds 重新开始 */
  restart: (seconds?: number) => void;
  /** 立即停止 */
  stop: () => void;
}

/** 秒级倒计时（用于验证码重发、二维码过期等） */
export function useCountdown(seconds: number, active = true): CountdownState {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  const restart = useCallback(
    (nextSeconds?: number) => {
      const total = nextSeconds ?? seconds;
      setDeadline(Date.now() + total * 1000);
      setRemaining(total);
    },
    [seconds],
  );

  const stop = useCallback(() => {
    setDeadline(null);
    setRemaining(0);
  }, []);

  useEffect(() => {
    if (!active || deadline === null) return;
    const tick = (): void => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) setDeadline(null);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [active, deadline]);

  return { remaining, running: deadline !== null, restart, stop };
}

/** 锁定 body 滚动（弹窗、底部键盘打开时） */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [locked]);
}

/** 当前主题偏好（设置页使用） */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(() => getThemeMode());
  useEffect(() => subscribeThemeMode(setMode), []);
  return mode;
}

/** 小屏 / 手表视口断点（与 styles.css 的 watch 变体保持一致） */
export const WATCH_MEDIA_QUERY = "(max-width: 359px)";

/**
 * 是否处于小屏 / 手表视口（宽度小于 360px）。
 * 手表上的浏览器通常没有可用摄像头，扫码会优先走手动输入。
 */
export function useWatchLayout(): boolean {
  const [watch, setWatch] = useState(
    () => typeof window !== "undefined" && window.matchMedia(WATCH_MEDIA_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(WATCH_MEDIA_QUERY);
    const onChange = (): void => setWatch(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return watch;
}

/** 页面可见性（切回前台时刷新数据） */
export function useVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onChange = (): void => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/** 防抖值 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
