/** 我的：头部个人信息 + 我的收付款码快捷入口 + 功能列表。 */

import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { BottomNav } from "../components/BottomNav";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";
import { formatFriendlyTime } from "../lib/format";
import { useWatchLayout } from "../lib/hooks";
import { useAuth } from "../lib/session";

interface MenuItem {
  label: string;
  description?: string;
  path: string;
  icon: ReactNode;
}

function MenuIcon({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-text ring-1 ring-line/70 watch:h-8 watch:w-8 watch:rounded-xl">
      {children}
    </span>
  );
}

function ChartIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ShopIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9ZM4 9l1.6-4.2A1 1 0 0 1 6.5 4h11a1 1 0 0 1 .9.8L20 9M9 20v-5h6v5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 20c.8-3.6 3.7-5.4 7.5-5.4S18.7 16.4 19.5 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 10V7.8a3.5 3.5 0 0 1 7 0V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" />
    </svg>
  );
}

function SettingsIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InfoIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" />
    </svg>
  );
}

function ChevronRightIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MePage(): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const watch = useWatchLayout();
  const { me, logout } = useAuth();
  const [showCardNo, setShowCardNo] = useState(false);

  const menu: MenuItem[] = [
    { label: "交易统计", description: "收支汇总与趋势", path: "/me/stats", icon: <ChartIcon /> },
    { label: "商家", description: me?.isMerchant ? "商家中心与商品" : "注册成为商家", path: "/merchant", icon: <ShopIcon /> },
    { label: "个人信息", description: "姓名、学号、邮箱、校园卡", path: "/me/profile", icon: <UserIcon /> },
    { label: "修改密码", path: "/me/password", icon: <LockIcon /> },
    { label: "设置", description: "外观与邮件通知", path: "/me/settings", icon: <SettingsIcon /> },
    { label: "关于", description: "版本、更新日志与协议", path: "/me/about", icon: <InfoIcon /> },
  ];

  const handleLogout = async (): Promise<void> => {
    try {
      await logout();
    } catch (cause) {
      toast.error("退出登录失败，请重试");
      void cause;
    }
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader
        title="我的"
        right={
          <button
            type="button"
            className="btn btn-sm btn-outline gap-1.5"
            onClick={() => navigate("/dynamic-code")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
              <rect x="14" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
              <rect x="3" y="14" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
              <path d="M14 14h2.5v2.5H14zM18.5 18.5H21V21h-2.5z" fill="currentColor" />
            </svg>
            我的收付款码
          </button>
        }
      />

      <main className="page page-with-nav space-y-4 pt-4">
        {me ? (
          <section className="hero-gradient relative overflow-hidden rounded-3xl p-5 watch:rounded-2xl watch:p-3.5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-white/45 blur-2xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-white/25 blur-2xl"
            />
            <div className="relative flex items-center gap-4 watch:gap-2.5">
              <span className="rounded-[22px] bg-white/55 p-[3px] ring-1 ring-[color:var(--hero-ring)] watch:rounded-[16px] watch:p-0.5">
                <Avatar name={me.displayName} avatarUrl={me.avatarUrl} size={watch ? 44 : 60} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-lg font-bold text-[color:var(--hero-fg)] watch:text-[15px]">
                    {me.displayName}
                  </h1>
                  {me.isMerchant ? (
                    <span className="shrink-0 rounded-full bg-[color:var(--hero-chip)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--hero-fg)] ring-1 ring-[color:var(--hero-ring)]">
                      商家
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-[color:var(--hero-fg-soft)]">学号 {me.studentNo || "未填写"}</p>
                {me.cardNoMasked ? (
                  <button
                    type="button"
                    className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[color:var(--hero-fg-soft)]"
                    onClick={() => setShowCardNo((value) => !value)}
                  >
                    <span>卡号 {showCardNo ? (me.cardNo ?? me.cardNoMasked) : me.cardNoMasked}</span>
                    <span className="font-semibold text-[color:var(--hero-fg)] underline decoration-[color:var(--hero-ring)] underline-offset-2">
                      {showCardNo ? "隐藏" : "显示"}
                    </span>
                  </button>
                ) : (
                  <p className="mt-0.5 text-[11px] text-[color:var(--hero-fg-soft)]">卡号 未绑定</p>
                )}
                <p className="mt-0.5 text-[11px] text-[color:var(--hero-fg-faint)]">
                  加入于 {formatFriendlyTime(me.createdAt)}
                </p>
              </div>
            </div>
            {me.frozen ? (
              <p className="relative mt-4 rounded-xl bg-[color:var(--hero-chip)] px-3 py-2 text-xs leading-relaxed text-[color:var(--hero-fg)] ring-1 ring-[color:var(--hero-ring)]">
                账号已被限制，如有疑问请通过「关于」中的联系方式联系我们。
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="card overflow-hidden p-0">
          {menu.map((item, index) => (
            <button
              key={item.path}
              type="button"
              className={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 active:bg-surface-2 watch:gap-2.5 watch:px-3 watch:py-2.5 ${
                index > 0 ? "border-t border-line/70" : ""
              }`}
              onClick={() => navigate(item.path)}
            >
              <MenuIcon>{item.icon}</MenuIcon>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text">{item.label}</span>
                {item.description ? <span className="mt-0.5 block text-xs text-muted">{item.description}</span> : null}
              </span>
              <span className="text-muted/60 transition-transform group-active:translate-x-0.5">
                <ChevronRightIcon />
              </span>
            </button>
          ))}
        </section>

        <button
          type="button"
          className="btn btn-block border border-line bg-surface text-[15px] font-semibold text-danger shadow-[var(--shadow-xs)]"
          onClick={() => void handleLogout()}
        >
          退出登录
        </button>

        <p className="text-center text-[11px] leading-relaxed text-muted">
          资金通过第三方收款码流转，gzspay 不代收代付
        </p>
      </main>

      <BottomNav />
    </div>
  );
}
