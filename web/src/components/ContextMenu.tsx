/**
 * 右键菜单（长按也生效）。
 *
 * 用法：页面用 `useContextMenus({ [key]: (el) => items })` 声明菜单，
 * 需要菜单的元素加 `data-menu={key}`（可选 `data-menu-id` 让回调区分是哪一条）。
 * 没有声明的元素、输入框与可编辑区域一律保留浏览器原生菜单。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useToast } from "./Toast";

export type ContextMenuItem =
  | {
      type?: "item";
      label: string;
      hint?: string;
      icon?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { type: "separator"; key?: string };

/** 根据被右键（长按）的元素生成菜单项；返回空数组表示不接管。 */
export type ContextMenuResolver = (element: HTMLElement) => ContextMenuItem[] | null;

interface ContextMenuApi {
  register: (key: string, resolver: ContextMenuResolver) => () => void;
}

const ContextMenuContext = createContext<ContextMenuApi | null>(null);

const MENU_WIDTH = 216;
const MENU_MARGIN = 8;
const LONG_PRESS_MS = 520;
const LONG_PRESS_MOVE_TOLERANCE = 10;

const NATIVE_MENU_TARGETS = "input, textarea, select, [contenteditable='true'], [contenteditable='']";

function isNativeMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(NATIVE_MENU_TARGETS));
}

function hasTextSelection(): boolean {
  if (typeof window === "undefined") return false;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

export function ContextMenuProvider({ children }: { children: ReactNode }): ReactNode {
  const toast = useToast();
  const registry = useRef(new Map<string, ContextMenuResolver>());
  const [menu, setMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placed, setPlaced] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const api = useMemo<ContextMenuApi>(
    () => ({
      register(key, resolver) {
        registry.current.set(key, resolver);
        return () => {
          if (registry.current.get(key) === resolver) registry.current.delete(key);
        };
      },
    }),
    [],
  );

  const close = useCallback((restoreFocus = true) => {
    setMenu(null);
    setActiveIndex(0);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (restoreFocus && trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
  }, []);

  const openAt = useCallback((element: HTMLElement, x: number, y: number) => {
    const resolver = registry.current.get(element.dataset.menu ?? "");
    const items = resolver ? resolver(element) : null;
    if (!items || items.length === 0) return false;
    triggerRef.current = element instanceof HTMLElement && element.tabIndex >= 0 ? element : null;
    setMenu({ items, x, y });
    setActiveIndex(items.findIndex((item) => item.type !== "separator" && !item.disabled));
    return true;
  }, []);

  // 右键：只处理声明了 data-menu 的元素
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-menu]") : null;
      if (!target) return;
      if (isNativeMenuTarget(event.target) || hasTextSelection()) return;
      if (target.dataset.menuDisabled === "true") return;
      if (!openAt(target, event.clientX, event.clientY)) return;
      event.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [openAt]);

  // 长按：手机上等价于右键
  useEffect(() => {
    let timer = 0;
    let startX = 0;
    let startY = 0;
    let pressed: HTMLElement | null = null;

    const cancel = () => {
      window.clearTimeout(timer);
      pressed = null;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return cancel();
      const touch = event.touches[0];
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-menu]") : null;
      if (!touch || !target) return cancel();
      if (isNativeMenuTarget(event.target) || target.dataset.menuDisabled === "true") return cancel();
      pressed = target;
      startX = touch.clientX;
      startY = touch.clientY;
      timer = window.setTimeout(() => {
        if (!pressed) return;
        const target = pressed;
        pressed = null;
        if (navigator.vibrate) navigator.vibrate(8);
        openAt(target, startX, startY);
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (Math.abs(touch.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE) cancel();
      else if (Math.abs(touch.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) cancel();
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", cancel, { passive: true });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", cancel);
      document.removeEventListener("touchcancel", cancel);
    };
  }, [openAt]);

  // 定位：先按指针位置显示，量到尺寸后再夹回视口内
  useEffect(() => {
    if (!menu) return;
    const rect = menuRef.current?.getBoundingClientRect();
    const height = rect?.height ?? 0;
    const maxX = window.innerWidth - MENU_WIDTH - MENU_MARGIN;
    const maxY = window.innerHeight - height - MENU_MARGIN;
    setPlaced({
      x: Math.max(MENU_MARGIN, Math.min(menu.x, maxX)),
      y: Math.max(MENU_MARGIN, Math.min(menu.y, maxY)),
    });
    menuRef.current?.querySelector<HTMLButtonElement>("[data-menu-item]:not([disabled])")?.focus({
      preventScroll: true,
    });
  }, [menu]);

  // 关闭：点别处、滚动、缩放、切页
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close(false);
    };
    const onScrollOrResize = () => close(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onScrollOrResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onScrollOrResize);
    };
  }, [menu, close]);

  const enabledIndexes = useMemo(
    () =>
      (menu?.items ?? [])
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.type !== "separator" && !item.disabled)
        .map(({ index }) => index),
    [menu],
  );

  const moveActive = useCallback(
    (delta: number) => {
      if (enabledIndexes.length === 0) return;
      const current = enabledIndexes.indexOf(activeIndex);
      const nextOffset = (current < 0 ? 0 : current + delta + enabledIndexes.length) % enabledIndexes.length;
      const next = enabledIndexes[nextOffset];
      if (next === undefined) return;
      setActiveIndex(next);
      const node = menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-menu-item]")[next];
      node?.focus({ preventScroll: true });
    },
    [activeIndex, enabledIndexes],
  );

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveActive(-enabledIndexes.length);
    } else if (event.key === "End") {
      event.preventDefault();
      moveActive(enabledIndexes.length);
    } else if (event.key === "Tab") {
      event.preventDefault();
      close();
    }
  };

  const select = (item: ContextMenuItem) => {
    if (item.type === "separator" || item.disabled) return;
    close(false);
    try {
      item.onSelect();
    } catch (error) {
      console.error("[gzspay] 右键菜单操作失败", error);
      toast.error("操作失败，请重试");
    }
  };

  return (
    <ContextMenuContext.Provider value={api}>
      {children}
      {menu
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="操作菜单"
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
              onContextMenu={(event) => event.preventDefault()}
              style={{ left: placed.x, top: placed.y, width: MENU_WIDTH }}
              className="fixed z-[80] animate-[ctx-in_120ms_ease-out] rounded-2xl border border-line/70 bg-surface/98 p-1.5 shadow-[0_22px_48px_-24px_rgba(0,0,0,0.55)] backdrop-blur"
            >
              {menu.items.map((item, index) =>
                item.type === "separator" ? (
                  <div key={item.key ?? `sep-${index}`} className="my-1 h-px bg-line/60" role="separator" />
                ) : (
                  <button
                    key={`${item.label}-${index}`}
                    type="button"
                    role="menuitem"
                    data-menu-item
                    disabled={item.disabled}
                    tabIndex={-1}
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => select(item)}
                    className={[
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12.5px] transition",
                      item.disabled
                        ? "cursor-not-allowed text-muted/60"
                        : item.danger
                          ? "text-danger hover:bg-danger/10"
                          : activeIndex === index
                            ? "bg-surface-2 text-text"
                            : "text-text hover:bg-surface-2",
                    ].join(" ")}
                  >
                    {item.icon ? (
                      <span className={cnIcon(item.danger)} aria-hidden="true">
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? (
                      <span className="shrink-0 font-mono text-[10.5px] text-muted/80">{item.hint}</span>
                    ) : null}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </ContextMenuContext.Provider>
  );
}

function cnIcon(danger?: boolean): string {
  return danger ? "flex h-4 w-4 shrink-0 items-center justify-center text-danger" : "flex h-4 w-4 shrink-0 items-center justify-center text-muted";
}

/** 页面声明菜单：key 与元素上的 `data-menu` 对应。 */
export function useContextMenus(menus: Record<string, ContextMenuResolver>): void {
  const ctx = useContext(ContextMenuContext);
  const menusRef = useRef(menus);
  menusRef.current = menus;
  const keys = Object.keys(menus).sort().join("|");

  useEffect(() => {
    if (!ctx) return;
    const offs = keys
      .split("|")
      .filter(Boolean)
      .map((key) => ctx.register(key, (element) => menusRef.current[key]?.(element) ?? null));
    return () => offs.forEach((off) => off());
  }, [ctx, keys]);
}

/** 复制到剪贴板（www 与 iframe 里 execCommand 兜底），带 toast 反馈。 */
export function useCopy(): (text: string, label?: string) => Promise<boolean> {
  const toast = useToast();
  return useCallback(
    async (text: string, label = "内容") => {
      const value = text.trim();
      if (!value) {
        toast.info(`没有可复制的${label}`);
        return false;
      }
      const ok = await writeClipboard(value);
      if (ok) toast.success(`已复制${label}`);
      else toast.error("复制失败，请手动选择文本复制");
      return ok;
    },
    [toast],
  );
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
