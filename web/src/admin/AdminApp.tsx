/**
 * 管理后台入口：自带认证状态机、后台路由与整体布局。
 * 手机端 shell 以 /admin/* 懒加载本组件，因此本文件默认导出 AdminApp。
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
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
import { SkeletonCards, TableSkeleton } from "./components/ui";
import { useTheme, type ThemeMode } from "./hooks";
import { AdminLayout } from "./Layout";
import { errorMessage } from "../lib/http";
import type { AdminIdentity } from "./types";
import { LoginPage } from "./pages/LoginPage";
import { SetupWizard } from "./pages/SetupWizard";

/**
 * 后台页面按路由懒加载：登录后只加载当前页面的代码，
 * 其余页面在切换导航时再按需下载，避免一次性下载整个后台。
 */
function lazyAdminPage(
  load: () => Promise<Record<string, unknown>>,
  exportName: string,
): ComponentType {
  return lazy(async () => {
    const module = await load();
    const component = module[exportName] as ComponentType | undefined;
    if (!component) {
      throw new Error(`页面模块缺少导出：${exportName}`);
    }
    return { default: component };
  });
}

const OverviewPage = lazyAdminPage(() => import("./pages/OverviewPage"), "OverviewPage");
const MonthlyPage = lazyAdminPage(() => import("./pages/MonthlyPage"), "MonthlyPage");
const UsersPage = lazyAdminPage(() => import("./pages/UsersPage"), "UsersPage");
const MerchantsPage = lazyAdminPage(() => import("./pages/MerchantsPage"), "MerchantsPage");
const AdminsPage = lazyAdminPage(() => import("./pages/AdminsPage"), "AdminsPage");
const OrdersPage = lazyAdminPage(() => import("./pages/OrdersPage"), "OrdersPage");
const StatsPage = lazyAdminPage(() => import("./pages/StatsPage"), "StatsPage");
const TrafficPage = lazyAdminPage(() => import("./pages/TrafficPage"), "TrafficPage");
const SystemPage = lazyAdminPage(() => import("./pages/SystemPage"), "SystemPage");
const AnnouncementsPage = lazyAdminPage(
  () => import("./pages/AnnouncementsPage"),
  "AnnouncementsPage",
);
const AdminTicketsPage = lazyAdminPage(
  () => import("./pages/TicketsPage"),
  "AdminTicketsPage",
);
const LogsPage = lazyAdminPage(() => import("./pages/LogsPage"), "LogsPage");
const ConfigPage = lazyAdminPage(() => import("./pages/ConfigPage"), "ConfigPage");

/** 懒加载页面的统一占位：标题区 + 指标卡 + 表格骨架，避免切换时白屏 */
function AdminPageFallback(): ReactNode {
  return (
    <div className="admin-stack" aria-busy="true">
      <SkeletonCards count={3} />
      <TableSkeleton rows={5} cols={4} />
    </div>
  );
}

/** 后台页面懒加载的 Suspense 边界 */
function PageSuspense({ children }: { children: ReactNode }): ReactNode {
  return <Suspense fallback={<AdminPageFallback />}>{children}</Suspense>;
}

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
          <Route path="overview" element={<PageSuspense><OverviewPage /></PageSuspense>} />
          <Route path="monthly" element={<PageSuspense><MonthlyPage /></PageSuspense>} />
          <Route path="users" element={<PageSuspense><UsersPage /></PageSuspense>} />
          <Route path="merchants" element={<PageSuspense><MerchantsPage /></PageSuspense>} />
          <Route path="orders" element={<PageSuspense><OrdersPage /></PageSuspense>} />
          <Route path="announcements" element={<PageSuspense><AnnouncementsPage /></PageSuspense>} />
          <Route path="tickets" element={<PageSuspense><AdminTicketsPage /></PageSuspense>} />
          <Route path="stats" element={<PageSuspense><StatsPage /></PageSuspense>} />
          <Route path="traffic" element={<PageSuspense><TrafficPage /></PageSuspense>} />
          <Route path="system" element={<PageSuspense><SystemPage /></PageSuspense>} />
          <Route path="logs" element={<PageSuspense><LogsPage /></PageSuspense>} />
          <Route
            path="admins"
            element={
              <PageSuspense>
                <RequireSuper>
                  <AdminsPage />
                </RequireSuper>
              </PageSuspense>
            }
          />
          <Route path="config" element={<PageSuspense><ConfigPage /></PageSuspense>} />
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
        <p className="admin-page-desc">仅超级管理员可访问。</p>
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
        <p className="admin-page-desc">页面不存在或已移除。</p>
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
