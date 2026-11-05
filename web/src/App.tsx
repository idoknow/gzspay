/**
 * 应用根：启动加载页 → 系统初始化检查 → 会话注入 → 路由外壳
 *（守卫 / 底部导航在页面内 / 全局收款请求弹窗 / 懒加载管理后台）。
 */

import { createContext, lazy, Suspense, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router-dom";
import { LoadingBlock, PageLoading } from "./components/Loading";
import { PaymentRequestDialog } from "./components/PaymentRequestDialog";
import { DevtoolsShield, PrivacyGuard, PrivacyModeBanner, PrivacyModePrompt, PrivacySessionGuard } from "./components/PrivacyMode";
import { getSetupStatus } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/session";
import type { SessionResponse, SetupStatus } from "./lib/types";
import { BootPage } from "./pages/BootPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SystemNotReadyPage } from "./pages/SystemNotReadyPage";

/**
 * 页面按路由懒加载：首屏只加载启动、登录与错误兜底页，
 * 交易统计、扫码、商家等较重的页面进入对应路由时再下载。
 */
function lazyPage(load: () => Promise<Record<string, unknown>>, exportName: string): ComponentType {
  return lazy(async () => {
    const module = await load();
    const component = module[exportName] as ComponentType | undefined;
    if (!component) {
      throw new Error(`页面模块缺少导出：${exportName}`);
    }
    return { default: component };
  });
}

const AboutPage = lazyPage(() => import("./pages/AboutPage"), "AboutPage");
const AnnouncementDetailPage = lazyPage(() => import("./pages/AnnouncementDetailPage"), "AnnouncementDetailPage");
const AnnouncementsPage = lazyPage(() => import("./pages/AnnouncementsPage"), "AnnouncementsPage");
const ChangePasswordPage = lazyPage(() => import("./pages/ChangePasswordPage"), "ChangePasswordPage");
const CollectPage = lazyPage(() => import("./pages/CollectPage"), "CollectPage");
const DevicesPage = lazyPage(() => import("./pages/DevicesPage"), "DevicesPage");
const DynamicCodePage = lazyPage(() => import("./pages/DynamicCodePage"), "DynamicCodePage");
const GuidePage = lazyPage(() => import("./pages/GuidePage"), "GuidePage");
const MePage = lazyPage(() => import("./pages/MePage"), "MePage");
const MerchantPage = lazyPage(() => import("./pages/MerchantPage"), "MerchantPage");
const MerchantCollectPage = lazyPage(() => import("./pages/MerchantCollectPage"), "MerchantCollectPage");
const MerchantRegisterPage = lazyPage(() => import("./pages/MerchantRegisterPage"), "MerchantRegisterPage");
const OnboardingPage = lazyPage(() => import("./pages/OnboardingPage"), "OnboardingPage");
const OrderDetailPage = lazyPage(() => import("./pages/OrderDetailPage"), "OrderDetailPage");
const OrderPrintPage = lazyPage(() => import("./pages/OrderPrintPage"), "OrderPrintPage");
const PayPage = lazyPage(() => import("./pages/PayPage"), "PayPage");
const ProductsPage = lazyPage(() => import("./pages/ProductsPage"), "ProductsPage");
const ProfilePage = lazyPage(() => import("./pages/ProfilePage"), "ProfilePage");
const SettingsPage = lazyPage(() => import("./pages/SettingsPage"), "SettingsPage");
const StatsPage = lazyPage(() => import("./pages/StatsPage"), "StatsPage");
const TicketDetailPage = lazyPage(() => import("./pages/TicketDetailPage"), "TicketDetailPage");
const TicketsPage = lazyPage(() => import("./pages/TicketsPage"), "TicketsPage");
const TradesPage = lazyPage(() => import("./pages/TradesPage"), "TradesPage");

/** 懒加载页面的统一加载态 */
function PageSuspense({ children }: { children: ReactNode }): ReactNode {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

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

/** 使用文档是公开页面，系统还没初始化时也允许查看 */
function isPublicDocPath(): boolean {
  const path = window.location.pathname;
  return path === "/guide" || path === "/guide/";
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
      <PrivacyModeBanner />
      <PageSuspense>
        <Outlet />
      </PageSuspense>
      <PaymentRequestDialog />
      <PrivacyModePrompt />
      <PrivacySessionGuard />
      <DevtoolsShield />
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
    path: "/guide",
    element: (
      <PageSuspense>
        <GuidePage />
      </PageSuspense>
    ),
  },
  {
    path: "/onboarding",
    element: (
      <OnboardingGate>
        <PageSuspense>
          <OnboardingPage />
        </PageSuspense>
      </OnboardingGate>
    ),
  },
  {
    element: <BusinessLayout />,
    children: [
      { path: "/trades", element: <TradesPage /> },
      { path: "/announcements", element: <AnnouncementsPage /> },
      { path: "/announcements/:id", element: <AnnouncementDetailPage /> },
      { path: "/tickets", element: <TicketsPage /> },
      { path: "/tickets/:id", element: <TicketDetailPage /> },
      { path: "/orders/print", element: <OrderPrintPage /> },
      { path: "/orders/:id", element: <OrderDetailPage /> },
      { path: "/pay", element: <PayPage /> },
      { path: "/dynamic-code", element: <DynamicCodePage /> },
      { path: "/me", element: <MePage /> },
      { path: "/me/stats", element: <StatsPage /> },
      { path: "/me/profile", element: <PrivacyGuard title="个人信息"><ProfilePage /></PrivacyGuard> },
      { path: "/me/password", element: <ChangePasswordPage /> },
      { path: "/me/settings", element: <SettingsPage /> },
      { path: "/me/devices", element: <PrivacyGuard title="登录设备管理" description="隐私模式下不展示登录过的设备与 IP。"><DevicesPage /></PrivacyGuard> },
      { path: "/me/about", element: <AboutPage /> },
      { path: "/merchant", element: <MerchantPage /> },
      { path: "/merchant/register", element: <MerchantRegisterPage /> },
      { path: "/merchant/products", element: <PrivacyGuard title="商品与店铺设置" description="隐私模式下不展示商品、价格与店铺设置。"><ProductsPage /></PrivacyGuard> },
      { path: "/merchant/collect", element: <MerchantCollectPage /> },
      { path: "/collect/id/:id", element: <CollectPage /> },
      { path: "/collect/:token", element: <CollectPage /> },
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
  if (setup !== null && !setup.initialized && !isAdminPath() && !isPublicDocPath()) {
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
