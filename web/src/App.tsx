/**
 * 应用根：启动加载页 → 系统初始化检查 → 会话注入 → 路由外壳
 *（守卫 / 底部导航在页面内 / 全局收款请求弹窗 / 懒加载管理后台）。
 */

import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router-dom";
import { LoadingBlock, PageLoading } from "./components/Loading";
import { PaymentRequestDialog } from "./components/PaymentRequestDialog";
import { getSetupStatus } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/session";
import type { SessionResponse, SetupStatus } from "./lib/types";
import { AboutPage } from "./pages/AboutPage";
import { AnnouncementDetailPage } from "./pages/AnnouncementDetailPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { BootPage } from "./pages/BootPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DynamicCodePage } from "./pages/DynamicCodePage";
import { LoginPage } from "./pages/LoginPage";
import { MePage } from "./pages/MePage";
import { MerchantPage } from "./pages/MerchantPage";
import { MerchantRegisterPage } from "./pages/MerchantRegisterPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { PayPage } from "./pages/PayPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { SystemNotReadyPage } from "./pages/SystemNotReadyPage";
import { TradesPage } from "./pages/TradesPage";

/** 管理后台由另一位负责人实现，懒加载避免进入手机端主包 */
const AdminApp = lazy(() => import("./admin/AdminApp.js"));

/** 系统初始化状态：路由守卫据此决定是否放行（未初始化时管理后台必须可进入） */
const SetupStatusContext = createContext<SetupStatus | null>(null);

function useSetupStatus(): SetupStatus | null {
  return useContext(SetupStatusContext);
}

/** 是否处于管理后台入口（同一 SPA 的另一半，不受初始化拦截页影响） */
function isAdminPath(): boolean {
  const path = window.location.pathname;
  return path === "/admin" || path.startsWith("/admin/");
}

/** 已登录 + 已完成引导的业务页外壳：底部不在这里渲染（各页面自带 BottomNav），额外挂全局 SSE 弹窗 */
function BusinessLayout(): ReactNode {
  const { authenticated, onboarded } = useAuth();
  const location = useLocation();

  if (!authenticated) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  if (!onboarded) {
    return <Navigate to="/onboarding" replace />;
  }
  return (
    <>
      <Outlet />
      <PaymentRequestDialog />
    </>
  );
}

/** 登录后但未完成引导时的外壳 */
function OnboardingGate({ children }: { children: ReactNode }): ReactNode {
  const { authenticated } = useAuth();
  const location = useLocation();
  if (!authenticated) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

/** 根路径按会话状态分流 */
function HomeRoute(): ReactNode {
  const { authenticated, onboarded } = useAuth();
  if (!authenticated) return <Navigate to="/login" replace />;
  if (!onboarded) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/trades" replace />;
}

/** 管理后台：懒加载 + 登录/权限守卫 */
function AdminRoute(): ReactNode {
  const { authenticated, session, me } = useAuth();
  const location = useLocation();
  const setup = useSetupStatus();
  // 系统尚未初始化时还没有管理员账号，此时必须放行到管理后台（由它引导完成初始化）
  if (setup !== null && !setup.initialized) {
    return (
      <Suspense fallback={<PageLoading text="正在加载管理后台…" />}>
        <AdminApp />
      </Suspense>
    );
  }
  if (!authenticated) {
    return <Navigate to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />;
  }
  const isAdmin = me?.isAdmin === true || session.isAdmin === true;
  if (!isAdmin) return <Navigate to="/trades" replace />;
  return (
    <Suspense fallback={<PageLoading text="正在加载管理后台…" />}>
      <AdminApp />
    </Suspense>
  );
}

const router = createBrowserRouter([
  { path: "/", element: <HomeRoute /> },
  { path: "/login", element: <LoginPage /> },
  {
    path: "/onboarding",
    element: (
      <OnboardingGate>
        <OnboardingPage />
      </OnboardingGate>
    ),
  },
  {
    element: <BusinessLayout />,
    children: [
      { path: "/trades", element: <TradesPage /> },
      { path: "/announcements", element: <AnnouncementsPage /> },
      { path: "/announcements/:id", element: <AnnouncementDetailPage /> },
      { path: "/orders/:id", element: <OrderDetailPage /> },
      { path: "/pay", element: <PayPage /> },
      { path: "/dynamic-code", element: <DynamicCodePage /> },
      { path: "/me", element: <MePage /> },
      { path: "/me/stats", element: <StatsPage /> },
      { path: "/me/profile", element: <ProfilePage /> },
      { path: "/me/password", element: <ChangePasswordPage /> },
      { path: "/me/settings", element: <SettingsPage /> },
      { path: "/me/about", element: <AboutPage /> },
      { path: "/merchant", element: <MerchantPage /> },
      { path: "/merchant/register", element: <MerchantRegisterPage /> },
      { path: "/merchant/products", element: <ProductsPage /> },
    ],
  },
  { path: "/admin/*", element: <AdminRoute /> },
  { path: "*", element: <NotFoundPage /> },
]);

export function App(): ReactNode {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  /** 初始化状态是否已检查完成（请求失败也算完成，避免卡在加载态） */
  const [setupSettled, setSetupSettled] = useState(false);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setSetupSettled(false);
    // 兜底超时：状态接口挂住时不要让用户卡在加载态
    const timeout = window.setTimeout(() => {
      if (active) setSetupSettled(true);
    }, 8000);
    getSetupStatus()
      .then((next) => {
        if (active) setSetup(next);
      })
      .catch(() => {
        // 拿不到状态时不做拦截：正常渲染，由各页面自行报错
        if (active) setSetup(null);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setSetupSettled(true);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [session]);

  if (!session) {
    return <BootPage onReady={setSession} />;
  }

  if (!setupSettled) {
    return (
      <div className="bg-app flex min-h-[100dvh] items-center justify-center">
        <LoadingBlock text="正在检查系统状态…" />
      </div>
    );
  }

  // 未初始化且不在管理后台：主站只显示引导页（不挂底部导航、不渲染业务路由）
  if (setup !== null && !setup.initialized && !isAdminPath()) {
    return <SystemNotReadyPage status={setup} />;
  }

  return (
    <SetupStatusContext.Provider value={setup}>
      <AuthProvider initialSession={session}>
        <RouterProvider router={router} />
      </AuthProvider>
    </SetupStatusContext.Provider>
  );
}
