/**
 * 客户端推送注册：把原生拿到的 FCM 令牌交给服务端。
 * 原生在令牌刷新后会调用 window.__gzspayPushToken，页面重新进入时也会主动取一次。
 */
import { useEffect } from "react";
import { registerPushToken } from "./api";
import { clientBridge } from "./client";

export function usePushRegistration(authenticated: boolean): void {
  useEffect(() => {
    const bridge = clientBridge();
    if (!bridge || !authenticated) return;
    let active = true;

    const register = (token: string): void => {
      if (!active || !token) return;
      void registerPushToken(token).catch(() => {
        // 注册失败不影响主流程，下次进入应用会重试
      });
    };

    window.__gzspayPushToken = register;
    register(bridge.pushToken?.() ?? "");

    return () => {
      active = false;
      delete window.__gzspayPushToken;
    };
  }, [authenticated]);
}
