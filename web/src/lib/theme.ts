/** 主题：浅色 / 深色 / 自动（跟随系统）。通过 <html data-theme> + CSS 变量即时生效。 */

export type ThemeMode = "light" | "dark" | "auto";

const STORAGE_KEY = "gzspay-theme";
const CHANGE_EVENT = "gzspay-theme-change";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "auto";
}

/** 读取用户保存的主题偏好 */
export function getThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    // 隐私模式等场景忽略
  }
  return "auto";
}

/** 把偏好解析成实际主题 */
export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyResolved(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  const color = theme === "dark" ? "#0a1020" : "#f4f6fb";
  for (const tag of meta) {
    tag.content = color;
  }
}

/** 应用主题（不改变保存的偏好） */
export function applyTheme(mode: ThemeMode): void {
  applyResolved(resolveTheme(mode));
}

/** 保存并应用主题；会通知同页内订阅者 */
export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // 忽略存储失败
  }
  applyTheme(mode);
  window.dispatchEvent(new CustomEvent<ThemeMode>(CHANGE_EVENT, { detail: mode }));
}

/** 订阅主题变更（含系统主题变化，仅 auto 时生效） */
export function subscribeThemeMode(listener: (mode: ThemeMode) => void): () => void {
  const onLocal = (event: Event): void => {
    const detail = event instanceof CustomEvent ? (event.detail as unknown) : undefined;
    listener(isThemeMode(detail) ? detail : getThemeMode());
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    listener(getThemeMode());
  };
  let media: MediaQueryList | null = null;
  const onMedia = (): void => {
    if (getThemeMode() === "auto") {
      applyTheme("auto");
      listener("auto");
    }
  };
  window.addEventListener(CHANGE_EVENT, onLocal);
  window.addEventListener("storage", onStorage);
  try {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", onMedia);
  } catch {
    media = null;
  }
  return () => {
    window.removeEventListener(CHANGE_EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener("change", onMedia);
  };
}

/** 启动时立即应用一次（index.html 已做首帧兜底，这里保证与存储一致） */
export function initTheme(): void {
  applyTheme(getThemeMode());
}
