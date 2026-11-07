/**
 * 安卓客户端外壳暴露的能力（WebView 里注入的 window.GzspayClient）。
 * 网页在浏览器里打开时没有这个对象，相关入口整块不渲染。
 */
export interface GzspayClientBridge {
  /** 客户端版本号，如 1.0.0 */
  version: () => string;
  /** HCE 是否已经拿到卡片链接 */
  nfcReady: () => boolean;
  /** 让客户端重新同步一次 NFC 卡片链接 */
  refreshNfc: () => void;
  /** 打开客户端的应用锁设置页 */
  openLockSetup: () => void;
  /** 回到「我的」页 */
  goHome: () => void;
}

declare global {
  interface Window {
    GzspayClient?: GzspayClientBridge;
  }
}

export function clientBridge(): GzspayClientBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.GzspayClient;
  return bridge && typeof bridge.openLockSetup === "function" ? bridge : null;
}

/** 判断是否跑在客户端外壳里（UA 带 GzspayApp/<版本>） */
export function isClientApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return /GzspayApp\//.test(navigator.userAgent);
}
