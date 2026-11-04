/**
 * 管理后台整体布局：左侧固定侧边栏 + 顶部栏 + 内容区。
 * 导航按角色过滤：管理员管理仅超级管理员可见；其余入口所有角色可见（只读角色仅可浏览）。
 */
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAdmin } from "./context";
import { AdminAvatar } from "./components/AdminAvatar";
import { useFeedback } from "./components/dialogs";
import { ThemeSwitch, cx } from "./components/ui";
import { roleLabel } from "./format";
import type { ThemeMode } from "./hooks";
import type { AdminRole } from "./types";

interface NavItem {
  /** /admin 下的相对路径 */
  path: string;
  label: string;
  icon: IconName;
  group: string;
  /** 允许访问的角色；不填表示所有角色 */
  roles?: AdminRole[];
}

type IconName =
  | "overview"
  | "monthly"
  | "users"
  | "merchants"
  | "orders"
  | "stats"
  | "traffic"
  | "admins"
  | "announcements"
  | "tickets"
  | "system"
  | "logs"
  | "config";

const NAV_ITEMS: NavItem[] = [
  { path: "overview", label: "总览", icon: "overview", group: "数据概览" },
  { path: "monthly", label: "每月交易额", icon: "monthly", group: "数据概览" },
  { path: "stats", label: "数据统计", icon: "stats", group: "数据概览" },
  { path: "traffic", label: "访问统计", icon: "traffic", group: "数据概览" },
  { path: "users", label: "用户管理", icon: "users", group: "业务管理" },
  { path: "merchants", label: "商家管理", icon: "merchants", group: "业务管理" },
  { path: "orders", label: "交易明细", icon: "orders", group: "业务管理" },
  {
    path: "announcements",
    label: "公告发布",
    icon: "announcements",
    group: "业务管理",
  },
  { path: "tickets", label: "交易工单", icon: "tickets", group: "业务管理" },
  { path: "system", label: "系统状态", icon: "system", group: "系统运维" },
  { path: "logs", label: "日志查看", icon: "logs", group: "系统运维" },
  {
    path: "admins",
    label: "管理员管理",
    icon: "admins",
    group: "权限与配置",
    roles: ["super"],
  },
  { path: "config", label: "系统配置", icon: "config", group: "权限与配置" },
];

const NAV_GROUPS = ["数据概览", "业务管理", "系统运维", "权限与配置"];

/** 桌面端侧边栏收缩状态（记住上次选择） */
const SIDEBAR_STORAGE_KEY = "gzspay.admin.sidebar";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export interface AdminLayoutProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function AdminLayout({ themeMode, onThemeChange }: AdminLayoutProps) {
  const { admin, isAuditor, isSuper, logout } = useAdmin();
  const feedback = useFeedback();
  const location = useLocation();
  /** 手机/平板上的抽屉式导航开关（桌面端始终展示侧栏） */
  const [navOpen, setNavOpen] = useState(false);
  /** 桌面端侧边栏是否收起为图标栏 */
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        collapsed ? "collapsed" : "expanded",
      );
    } catch {
      // 隐私模式下写入失败不影响使用
    }
  }, [collapsed]);

  // 切换页面后自动收起抽屉
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // 抽屉打开时按 Esc 关闭，并锁住背景滚动
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.roles === undefined || item.roles.includes(admin.role),
  );
  const current =
    visibleItems.find((item) => location.pathname.endsWith(`/${item.path}`)) ??
    NAV_ITEMS[0];

  const handleLogout = () => {
    void (async () => {
      const confirmed = await feedback.confirm({
        title: "退出登录",
        description: `确定要退出管理后台吗？当前账号：${admin.displayName}`,
        confirmText: "退出登录",
        danger: true,
      });
      if (confirmed) logout();
    })();
  };

  return (
    <div className={cx("admin-shell", collapsed && "is-collapsed")}>
      <aside className={cx("admin-sidebar", navOpen && "is-open")}>
        <div className="admin-sidebar-brand">
          <div className="admin-brand-mark" aria-hidden="true" />
          <div className="admin-brand-text">
            <span className="admin-brand-name">
              <span className="admin-brand-name-gzs">gzs</span>
              <span className="admin-brand-name-pay">pay</span>
            </span>
            <span className="admin-brand-sub">校园支付 · 管理后台</span>
          </div>
          <button
            type="button"
            className="admin-sidebar-close"
            aria-label="关闭导航"
            onClick={() => setNavOpen(false)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <nav className="admin-nav" aria-label="后台导航">
          {NAV_GROUPS.map((group) => {
            const items = visibleItems.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <div className="admin-nav-group-title">{group}</div>
                {items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={`/admin/${item.path}`}
                    className={({ isActive }) =>
                      cx("admin-nav-item", isActive && "is-active")
                    }
                    title={item.label}
                  >
                    <span className="admin-nav-icon" aria-hidden="true">
                      <NavIcon name={item.icon} />
                    </span>
                    <span className="admin-nav-label">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <div>登录角色：{roleLabel(admin.role)}</div>
          <div>
            {isAuditor
              ? "只读审计模式：仅可查看数据"
              : isSuper
                ? "超级管理员：全部权限"
                : "运营：可处理业务，不可改配置"}
          </div>
          <div className="admin-sidebar-back">
            <a
              href="/"
              className="admin-sidebar-back-link"
              title="返回 gzspay 主站首页"
            >
              <span className="admin-sidebar-back-arrow" aria-hidden="true">
                ←
              </span>
              返回 Pay 主站
            </a>
          </div>
        </div>
      </aside>

      {navOpen ? (
        <button
          type="button"
          className="admin-sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <div className="admin-main">
        <header className="admin-topbar">
          <button
            type="button"
            className="admin-topbar-collapse"
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-pressed={collapsed}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={() => setCollapsed((value) => !value)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3"
                y="4.5"
                width="18"
                height="15"
                rx="2.6"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path d="M9.6 4.5v15" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="m15.6 9.6-2.4 2.4 2.4 2.4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="admin-topbar-menu"
            aria-label={navOpen ? "收起导航" : "展开导航"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="admin-topbar-heading">
            <div className="admin-topbar-title">{current?.label ?? "管理后台"}</div>
            <div className="admin-topbar-crumb">管理后台 / {current?.group ?? ""}</div>
          </div>
          <div className="admin-topbar-actions">
            <ThemeSwitch mode={themeMode} onChange={onThemeChange} />
            <div className="admin-topbar-user">
              <AdminAvatar name={admin.displayName} avatarUrl={admin.avatarUrl} />
              <div className="admin-user-meta">
                <span className="admin-user-name">{admin.displayName}</span>
                <span className="admin-user-role">
                  {roleLabel(admin.role)}
                  {admin.emailMasked ? ` · ${admin.emailMasked}` : ""}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="admin-btn admin-btn-ghost admin-btn-sm"
              onClick={handleLogout}
            >
              退出
            </button>
          </div>
        </header>

        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 图标 */

function NavIcon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "monthly":
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <path d="M16 4.5a3 3 0 0 1 0 6M17.5 14.2A5.5 5.5 0 0 1 21 19.5" />
        </svg>
      );
    case "merchants":
      return (
        <svg {...common}>
          <path d="M4 9.5 5.6 4h12.8L20 9.5" />
          <path d="M4 9.5h16V20H4V9.5Z" />
          <path d="M9 20v-5h6v5" />
          <path d="M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
        </svg>
      );
    case "orders":
      return (
        <svg {...common}>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      );
    case "stats":
      return (
        <svg {...common}>
          <path d="M21.2 12A9.2 9.2 0 1 1 12 2.8" />
          <path d="M12 3v9h9" />
        </svg>
      );
    case "traffic":
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case "admins":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v6c0 4.5 3.2 7.7 7.5 9 4.3-1.3 7.5-4.5 7.5-9V6L12 3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "announcements":
      return (
        <svg {...common}>
          <path d="M4 10v4l12 5V5L4 10Z" />
          <path d="M16 8.5a4 4 0 0 1 0 7" />
          <path d="M7 14v5" />
        </svg>
      );
    case "tickets":
      return (
        <svg {...common}>
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v1.2a2.8 2.8 0 0 0 0 6.6v1.2a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-1.2a2.8 2.8 0 0 0 0-6.6V7.5Z" />
          <path d="M13 5v14" strokeDasharray="2.4 2.6" />
        </svg>
      );
    case "system":
      return (
        <svg {...common}>
          <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
        </svg>
      );
    case "logs":
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6V3Z" />
          <path d="M14 3v5h5M9.5 12h6M9.5 16h6" />
        </svg>
      );
    case "config":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 9c.26.6.86 1 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
        </svg>
      );
    default:
      return null;
  }
}
