/** 登录态上下文：启动时由启动页拿到会话，之后各页面共享/刷新。 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { getSession, logout as apiLogout } from "./api";
import { ApiError } from "./http";
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
  /** 直接替换会话（DEV 登录后） */
  setSession: (session: SessionResponse) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toSessionState(session: SessionResponse): SessionResponse {
  if (!session.authenticated) return { authenticated: false };
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
        const anonymous: SessionResponse = { authenticated: false };
        setSessionState(anonymous);
        return anonymous;
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
    setSessionState({ authenticated: false });
    window.location.assign("/login");
  }, []);

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
