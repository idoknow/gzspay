/**
 * 管理后台入口：自带认证状态机、后台路由与整体布局。
 * 手机端 shell 以 /admin/* 懒加载本组件，因此本文件默认导出 AdminApp。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import "./admin.css";
import {
  ADMIN_LOGIN_URL,
  fetchSession,
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
import { VerifyPage } from "./pages/VerifyPage";
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

type AuthState =
  | { phase: "loading" }
  | { phase: "anonymous" }
  | { phase: "pending2fa"; emailMasked: string }
  | { phase: "authenticated"; admin: AdminIdentity };

export default function AdminApp() {
  const theme = useTheme();
  const navigate = useNavigate();
  const [auth, setAuth] = useState<AuthState>({ phase: "loading" });
  const [bootError, setBootError] = useState<string | null>(null);

  /** 拉取当前会话，决定渲染登录页 / 二次验证页 / 后台。 */
  const loadSession = useCallback(async () => {
    setBootError(null);
    try {
      const session = await fetchSession();
      if (session.authenticated && session.admin) {
        setAuth({ phase: "authenticated", admin: session.admin });
        return;
      }
      if (session.pending2fa) {
        setAuth({
          phase: "pending2fa",
          emailMasked: session.emailMasked ?? session.admin?.emailMasked ?? "",
        });
        return;
      }
      setAuth({ phase: "anonymous" });
    } catch (error) {
      // 网络等非鉴权异常：停留在登录页，并提示原因
      setBootError(errorMessage(error));
      setAuth({ phase: "anonymous" });
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // 任意接口返回 401 时，全局切换到登录页或二次验证页
  useEffect(() => {
    setAuthInvalidHandler((reason) => {
      setAuth(
        reason === "pending2fa"
          ? { phase: "pending2fa", emailMasked: "" }
          : { phase: "anonymous" },
      );
    });
    return () => setAuthInvalidHandler(null);
  }, []);

  const handleLogin = useCallback(() => {
    // 走校园墙 OAuth：整页跳转，后端 302 回来后命中 /admin/*
    window.location.href = ADMIN_LOGIN_URL;
  }, []);

  const handleReLogin = useCallback(() => {
    setAuth({ phase: "anonymous" });
    setBootError(null);
    handleLogin();
  }, [handleLogin]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutAdmin();
    } catch {
      // 退出接口异常时也清理前端状态，避免停留在半登录状态
    }
    setAuth({ phase: "anonymous" });
    setBootError(null);
  }, []);

  const handleVerified = useCallback(
    (admin: AdminIdentity) => {
      setAuth({ phase: "authenticated", admin });
      setBootError(null);
      navigate("/admin/overview", { replace: true });
    },
    [navigate],
  );

  return (
    <FeedbackProvider>
      <div className="admin-root" data-theme={theme.resolved}>
        {auth.phase === "loading" ? (
          <BootScreen />
        ) : auth.phase === "anonymous" ? (
          <LoginPage
            themeMode={theme.mode}
            onThemeChange={theme.setMode}
            onLogin={handleLogin}
            error={bootError}
            onRetry={bootError ? () => void loadSession() : undefined}
          />
        ) : auth.phase === "pending2fa" ? (
          <VerifyPage
            emailMasked={auth.emailMasked}
            themeMode={theme.mode}
            onThemeChange={theme.setMode}
            onVerified={handleVerified}
            onReLogin={handleReLogin}
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
          <Route
            path="verify"
            element={<Navigate to="/admin/overview" replace />}
          />
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
