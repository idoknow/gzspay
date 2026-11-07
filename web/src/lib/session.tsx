/** 登录态上下文：启动时由启动页拿到会话，之后各页面共享/刷新。 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSession, logout as apiLogout, subscribeEvents } from "./api";
import { ApiError } from "./http";
import { clearPrivacyState } from "./privacy";
import type { Me, SessionResponse } from "./types";

export interface AuthContextValue {
  session: SessionResponse;
  me: Me | null;
  authenticated: boolean;
  /** 已完成引导 */
  onboarded: boolean;
  /** 重新拉取会话（页面内数据变更后可调用） */
  refresh: () => Promise<SessionResponse>;
  /** 用最新的 Me 覆盖上下文（个人信息修改后） */
  updateMe: (me: Me) => void;
  /** 局部更新 Me（例如通知设置开关） */
  patchMe: (patch: Partial<Me>) => void;
  /** 退出登录并回到登录页 */
  logout: () => Promise<void>;
  /** 直接替换会话（外部注入登录态时使用） */
  setSession: (session: SessionResponse) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** 保留站点公开信息（登录页与开屏要显示备案号），未登录时其它字段清空 */
function anonymousState(previous?: SessionResponse): SessionResponse {
  return {
    authenticated: false,
    site: previous?.site,
    campuxConfigured: previous?.campuxConfigured,
  };
}

function toSessionState(session: SessionResponse): SessionResponse {
  if (!session.authenticated) return anonymousState(session);
  return session;
}

export function AuthProvider({
  initialSession,
  children,
}: {
  initialSession: SessionResponse;
  children: ReactNode;
}): ReactNode {
  const [session, setSessionState] = useState<SessionResponse>(() => toSessionState(initialSession));

  const setSession = useCallback((next: SessionResponse) => {
    setSessionState(toSessionState(next));
  }, []);

  const updateMe = useCallback((me: Me) => {
    setSessionState((current) => ({
      ...current,
      authenticated: true,
      me,
      onboardStep: me.onboardStep,
      isAdmin: me.isAdmin || current.isAdmin,
    }));
  }, []);

  const patchMe = useCallback((patch: Partial<Me>) => {
    setSessionState((current) => {
      if (!current.me) return current;
      const me = { ...current.me, ...patch };
      return { ...current, me, onboardStep: me.onboardStep };
    });
  }, []);

  const refresh = useCallback(async (): Promise<SessionResponse> => {
    try {
      const next = await getSession();
      setSessionState(toSessionState(next));
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSessionState((current) => anonymousState(current));
        return { authenticated: false };
      }
      throw error;
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } catch (error) {
      // 退出失败也继续清理本地态；下次进入会被 401 拦回登录页
      if (!(error instanceof ApiError)) throw error;
    }
    setSessionState((current) => anonymousState(current));
    // 公共设备上的隐私模式随登录一起清掉，下一位使用者会重新被询问
    clearPrivacyState();
    window.location.assign("/login");
  }, []);

  /** 被强制下线只处理一次（SSE 可能重复投递，也避免重复跳转） */
  const forcedRef = useRef(false);

  /**
   * 本机会话已被服务端撤销：此时退出接口也没意义（会话都没了），
   * 直接清本地态并回登录页，带一句提示说明发生了什么。
   */
  const forceLogout = useCallback((notice: string): void => {
    if (forcedRef.current) return;
    forcedRef.current = true;
    setSessionState((current) => anonymousState(current));
    clearPrivacyState();
    window.location.assign(`/login?auth_error=${encodeURIComponent(notice)}`);
  }, []);

  const authenticated = session.authenticated;
  const currentSessionId = session.sessionId ?? null;

  // 全局订阅实时事件：本机在别处被强制退出 / 被管理员下线时立刻退出登录，不必等用户刷新
  useEffect(() => {
    if (!authenticated) return;
    /** 兜底核对：SSE 断线期间可能错过 session_revoked，问一次后端确认本机会话还在不在 */
    const verifyAlive = (): void => {
      void getSession()
        .then((next) => {
          if (!next.authenticated) forceLogout("登录状态已失效，请重新登录");
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 401) {
            forceLogout("登录状态已失效，请重新登录");
          }
        });
    };
    return subscribeEvents({
      onSessionRevoked: (payload) => {
        if (forcedRef.current) return;
        const ids =
          payload.sessionIds.length > 0
            ? payload.sessionIds
            : payload.sessionId
              ? [payload.sessionId]
              : [];
        if (currentSessionId !== null) {
          // 被撤销的是别的设备时本机不受影响，忽略即可
          if (!ids.includes(currentSessionId)) return;
          forceLogout(payload.reason === "admin" ? "已被管理员强制下线" : "已在其它设备退出登录");
          return;
        }
        // 会话接口没给 sessionId（旧版后端）时，先问一次后端确认真的失效了，避免误踢
        verifyAlive();
      },
      // 连接异常（弱网、服务重启、重连时发现会话已失效）也核对一次，避免用户一直卡在「已登录」
      onError: verifyAlive,
    });
  }, [authenticated, currentSessionId, forceLogout]);

  const value = useMemo<AuthContextValue>(() => {
    const me = session.authenticated ? (session.me ?? null) : null;
    const onboarded = me ? me.onboarded : false;
    return {
      session,
      me,
      authenticated: session.authenticated && me !== null,
      onboarded,
      refresh,
      updateMe,
      patchMe,
      logout,
      setSession,
    };
  }, [session, refresh, updateMe, patchMe, logout, setSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return context;
}

/** 已登录用户（用于业务页面，AuthProvider 已保证上下文存在） */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("当前未登录");
  return me;
}
