/** 应用根：启动加载页 → 会话注入 → 路由外壳（守卫 / 底部导航在页面内 / 全局收款请求弹窗 / 懒加载管理后台）。 */

import { lazy, Suspense, useState, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router-dom";
import { PageLoading } from "./components/Loading";
import { PaymentRequestDialog } from "./components/PaymentRequestDialog";
import { AuthProvider, useAuth } from "./lib/session";
import type { SessionResponse } from "./lib/types";
import { AboutPage } from "./pages/AboutPage";
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
import { TradesPage } from "./pages/TradesPage";

/** 管理后台由另一位负责人实现，懒加载避免进入手机端主包 */
const AdminApp = lazy(() => import("./admin/AdminApp.js"));

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

  if (!session) {
    return <BootPage onReady={(next) => setSession(next)} />;
  }

  return (
    <AuthProvider initialSession={session}>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
