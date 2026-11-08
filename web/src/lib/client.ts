/** 应用锁状态：类型与原生 LockStore 的取值一一对应 */
export interface LockStatus {
  type: "none" | "pin4" | "pin6" | "pattern";
  biometricEnabled: boolean;
  biometricAvailable: boolean;
}

/**
 * 安卓客户端外壳暴露的能力（WebView 里注入的 window.GzspayClient）。
 * 网页在浏览器里打开时没有这个对象，相关入口整块不渲染。
 *
 * 标了可选的方法是较新客户端才有的：旧版本 APK 仍能打开网页，
 * 调用前先判断，缺失时提示更新客户端而不是抛异常。
 */
export interface GzspayClientBridge {
  /** 客户端版本号，如 1.0.0 */
  version: () => string;
  /** HCE 是否已经拿到卡片链接 */
  nfcReady: () => boolean;
  /** 让客户端重新同步一次 NFC 卡片链接 */
  refreshNfc: () => void;
  /** 回到「我的」页 */
  goHome: () => void;
  /** 应用锁状态（JSON），网页设置页读取 */
  lockStatus?: () => string;
  /** 保存四/六位数字或手势密码，返回是否成功 */
  saveLock?: (type: "pin4" | "pin6" | "pattern", code: string) => boolean;
  /** 关闭应用锁 */
  clearLock?: () => void;
  /** 是否允许指纹 / 人脸解锁 */
  setBiometric?: (enabled: boolean) => boolean;
  /** 启动原生 NFC 读卡，读到卡号后回调 window.__gzspayNfcRead */
  startNfcRead?: () => boolean;
  /** 停止原生 NFC 读卡 */
  stopNfcRead?: () => void;
  /** 当前 FCM 推送令牌，未配置或获取失败时为空字符串 */
  pushToken?: () => string;
  /** 系统通知权限是否已授权 */
  notificationsEnabled?: () => boolean;
  /** 请求系统通知权限 */
  requestNotifications?: () => void;
  /** 打开系统的应用通知设置页 */
  openNotificationSettings?: () => void;
  /** 相机权限是否已授权 */
  cameraEnabled?: () => boolean;
  /** 请求相机权限 */
  requestCamera?: () => void;
  /** 系统 NFC 开关是否打开 */
  nfcEnabled?: () => boolean;
  /** 打开系统 NFC 设置页 */
  openNfcSettings?: () => void;
}

declare global {
  interface Window {
    GzspayClient?: GzspayClientBridge;
    /** 原生读到校园卡卡号后调用 */
    __gzspayNfcRead?: (cardNo: string) => void;
    /** 原生拿到新的 FCM 令牌后调用 */
    __gzspayPushToken?: (token: string) => void;
  }
}

export function clientBridge(): GzspayClientBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.GzspayClient;
  return bridge && typeof bridge.version === "function" ? bridge : null;
}

/** 判断是否跑在客户端外壳里（UA 带 GzspayApp/<版本>） */
export function isClientApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return /GzspayApp\//.test(navigator.userAgent);
}
