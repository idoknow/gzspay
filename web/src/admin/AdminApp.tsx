/**
 * 管理后台入口：自带认证状态机、后台路由与整体布局。
 * 手机端 shell 以 /admin/* 懒加载本组件，因此本文件默认导出 AdminApp。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import "./admin.css";
import {
  ADMIN_LOGIN_URL,
  getAdminSession,
  logoutAdmin,
  setAuthInvalidHandler,
} from "./api";
import { AdminContext, useAdmin, type AdminContextValue } from "./context";
import { FeedbackProvider } from "./components/dialogs";
import { InfoBanner } from "./components/ui";
import { useTheme, type ThemeMode } from "./hooks";
import { AdminLayout } from "./Layout";
import { errorMessage } from "../lib/http";
import type { AdminIdentity } from "./types";
import { LoginPage } from "./pages/LoginPage";
import { SetupWizard } from "./pages/SetupWizard";
import { OverviewPage } from "./pages/OverviewPage";
import { MonthlyPage } from "./pages/MonthlyPage";
import { UsersPage } from "./pages/UsersPage";
import { AdminsPage } from "./pages/AdminsPage";
import { OrdersPage } from "./pages/OrdersPage";
import { StatsPage } from "./pages/StatsPage";
import { SystemPage } from "./pages/SystemPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { LogsPage } from "./pages/LogsPage";
import { ConfigPage } from "./pages/ConfigPage";

/** 登录页需要区分的两种未进入后台原因 */
type AnonymousReason = "anonymous" | "not_admin";

type AuthState =
  | { phase: "loading" }
  | { phase: "setup" }
  | { phase: "anonymous"; reason: AnonymousReason }
  | { phase: "authenticated"; admin: AdminIdentity };

export default function AdminApp() {
  const theme = useTheme();
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  const [bootError, setBootError] = useState<string | null>(null);

  /**
   * 拉取当前会话，决定渲染登录页 / 初始化向导 / 后台。
   * 后台不再有独立登录：全部复用主站会话 Cookie。
   */
  const loadSession = useCallback(async () => {
    setBootError(null);
    try {
      const { session, reason } = await getAdminSession();
      if (session.authenticated && session.admin) {
        setAuth({ phase: "authenticated", admin: session.admin });
        return;
      }
      if (reason === "not_initialized" || session.initialized === false) {
        setAuth({ phase: "setup" });
        return;
      }
      setAuth({
        phase: "anonymous",
        reason: reason === "not_admin" ? "not_admin" : "anonymous",
      });
    } catch (error) {
      // 网络等非鉴权异常：停留在登录页，并提示原因
      setBootError(errorMessage(error));
      setAuth({ phase: "anonymous", reason: "anonymous" });
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // 任意接口返回未登录 / 非管理员 / 未初始化时，全局切换对应页面
  useEffect(() => {
    setAuthInvalidHandler((reason) => {
      if (reason === "not_initialized") {
        setAuth({ phase: "setup" });
        return;
      }
      setAuth({
        phase: "anonymous",
        reason: reason === "not_admin" ? "not_admin" : "anonymous",
      });
    });
    return () => setAuthInvalidHandler(null);
  }, []);

  const handleLogin = useCallback(() => {
    // 走主站登录：整页跳转，后端 302 回来后命中 /admin/*
    window.location.href = ADMIN_LOGIN_URL;
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await logoutAdmin();
    } catch {
      // 退出接口异常时也清理前端状态，避免停留在半登录状态
    }
    setAuth({ phase: "anonymous", reason: "anonymous" });
    setBootError(null);
  }, []);

  /** 初始化完成后重新探测会话，正常即进入后台 */
  const handleSetupCompleted = useCallback(() => {
    void loadSession();
  }, [loadSession]);

  return (
    <FeedbackProvider>
      <div className="admin-root" data-theme={theme.resolved}>
        {auth.phase === "loading" ? (
          <BootScreen />
        ) : auth.phase === "setup" ? (
          <SetupWizard
            themeMode={theme.mode}
            onThemeChange={theme.setMode}
            onCompleted={handleSetupCompleted}
          />
        ) : auth.phase === "anonymous" ? (
          <LoginPage
            reason={auth.reason}
            themeMode={theme.mode}
            onThemeChange={theme.setMode}
            onLogin={handleLogin}
            error={bootError}
            onRetry={bootError ? () => void loadSession() : undefined}
          />
        ) : (
          <AuthenticatedApp
            admin={auth.admin}
            themeMode={theme.mode}
            onThemeChange={theme.setMode}
            onLogout={() => void handleLogout()}
          />
        )}
      </div>
    </FeedbackProvider>
  );
}

/* ------------------------------------------------------------ 已登录路由 */

interface AuthenticatedAppProps {
  admin: AdminIdentity;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onLogout: () => void;
}

function AuthenticatedApp({
  admin,
  themeMode,
  onThemeChange,
  onLogout,
}: AuthenticatedAppProps) {
  const contextValue = useMemo<AdminContextValue>(
    () => ({
      admin,
      canWrite: admin.role === "super" || admin.role === "ops",
      isSuper: admin.role === "super",
      isAuditor: admin.role === "auditor",
      logout: onLogout,
    }),
    [admin, onLogout],
  );

  return (
    <AdminContext.Provider value={contextValue}>
      <Routes>
        <Route
          element={
            <AdminLayout themeMode={themeMode} onThemeChange={onThemeChange} />
          }
        >
          <Route
            index
            element={<Navigate to="/admin/overview" replace />}
          />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="monthly" element={<MonthlyPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route
            path="admins"
            element={
              <RequireSuper>
                <AdminsPage />
              </RequireSuper>
            }
          />
          <Route path="config" element={<ConfigPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AdminContext.Provider>
  );
}

/** 仅超级管理员可访问的路由守卫。 */
function RequireSuper({ children }: { children: ReactNode }) {
  const { isSuper } = useAdmin();
  if (!isSuper) return <AccessDeniedPage />;
  return <>{children}</>;
}

function AccessDeniedPage() {
  return (
    <div className="admin-page-header">
      <div>
        <h1 className="admin-page-title">无权访问</h1>
        <p className="admin-page-desc">
          该页面仅对超级管理员开放，当前账号角色不允许查看。
        </p>
      </div>
      <div style={{ marginTop: 16 }}>
        <InfoBanner tone="warning">
          如需调整管理员角色，请使用超级管理员账号操作。
        </InfoBanner>
      </div>
      <div style={{ marginTop: 16 }}>
        <a className="admin-btn admin-btn-primary" href="/admin/overview">
          返回总览
        </a>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="admin-page-header">
      <div>
        <h1 className="admin-page-title">页面不存在</h1>
        <p className="admin-page-desc">你访问的后台页面不存在或已被移除。</p>
      </div>
      <div style={{ marginTop: 16 }}>
        <a className="admin-btn admin-btn-primary" href="/admin/overview">
          返回总览
        </a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 启动加载页 */

function BootScreen() {
  return (
    <div className="admin-auth-page">
      <div className="admin-auth-card">
        <div className="admin-auth-brand">
          <span className="admin-brand-mark" aria-hidden="true" />
          <span className="admin-brand-name">
            <span className="admin-brand-name-gzs">gzs</span>
            <span className="admin-brand-name-pay">pay</span>
          </span>
          <span className="admin-brand-sub">管理后台</span>
        </div>
        <div className="admin-loading-note">
          <span className="admin-spinner" aria-hidden="true" />
          正在校验登录状态…
        </div>
      </div>
    </div>
  );
}
