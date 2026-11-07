/** 我的：个人信息头图 + 三个快捷入口 + 分组功能列表。 */

import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnnouncementBell } from "../components/AnnouncementBell";
import { Avatar } from "../components/Avatar";
import { BottomNav } from "../components/BottomNav";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useCopy, useContextMenus, type ContextMenuItem } from "../components/ContextMenu";
import { ArrowRightIcon, CopyIcon, OpenIcon, RefreshIcon } from "../components/ContextMenuIcons";
import { EyeIcon } from "../components/EyeIcon";
import { PageHeader } from "../components/PageHeader";
import { ExitPrivacyButton } from "../components/PrivacyMode";
import { usePrivacyMode } from "../lib/privacy";
import { useToast } from "../components/Toast";
import { getTicketUnreadCount } from "../lib/api";
import { formatFriendlyTime } from "../lib/format";
import { useAsync, useInterval, useVisible, useWatchLayout } from "../lib/hooks";
import { useTicketEvents } from "../lib/ticket-events";
import { useAuth } from "../lib/session";

type Tone = "neutral" | "brand" | "accent";

interface MenuItem {
  label: string;
  description?: string;
  path: string;
  icon: ReactNode;
  tone?: Tone;
  /** 右下角红点数字（0 时不显示） */
  badge?: number;
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text ring-line/70",
  brand: "bg-brand-soft text-brand ring-brand/20",
  accent: "bg-accent-soft text-warning ring-accent/30",
};

function MenuIcon({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }): ReactNode {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-1 watch:h-8 watch:w-8 watch:rounded-xl ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

function QrIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 14h2.5v2.5H14zM18.5 18.5H21V21h-2.5z" fill="currentColor" />
    </svg>
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

function TicketIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v1.2a2.8 2.8 0 0 0 0 6.6v1.2a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-1.2a2.8 2.8 0 0 0 0-6.6V7.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13 5v14" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2.6" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7M17 8.5 20.5 12 17 15.5M10.5 12h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

/** 快捷入口磁贴：图标 + 主标题 + 副标题 */
function QuickTile({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="card-interactive flex flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-3 text-left active:bg-surface-2 watch:gap-1.5 watch:rounded-xl watch:p-2.5"
      onClick={onClick}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-text ring-1 ring-line/60 watch:h-8 watch:w-8">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-text watch:text-[12px]">{label}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted watch:text-[10px]">{hint}</span>
      </span>
    </button>
  );
}

function MenuRow({ item, divider }: { item: MenuItem; divider: boolean }): ReactNode {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-menu="me.row"
      data-menu-id={item.path}
      className={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 active:bg-surface-2 watch:gap-2.5 watch:px-3 watch:py-3 ${
        divider ? "border-t border-line/60" : ""
      }`}
      onClick={() => navigate(item.path)}
    >
      <MenuIcon tone={item.tone}>{item.icon}</MenuIcon>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text">{item.label}</span>
        {item.description ? <span className="mt-0.5 block truncate text-xs text-muted">{item.description}</span> : null}
      </span>
      {item.badge && item.badge > 0 ? (
        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      ) : null}
      <span className="text-muted/50 transition-transform group-active:translate-x-0.5">
        <ChevronRightIcon />
      </span>
    </button>
  );
}

export function MePage(): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const watch = useWatchLayout();
  const { me, logout } = useAuth();
  const privacy = usePrivacyMode();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const visible = useVisible();
  const ticketUnread = useAsync(() => getTicketUnreadCount(), []);
  const ticketUnreadCount = ticketUnread.data?.count ?? 0;
  const copy = useCopy();

  // 页面可见时每 15 秒刷新一次工单未读红点（SSE 断线时的兜底）
  useInterval(() => {
    if (visible) ticketUnread.reload();
  }, 15000);

  // 工单有新消息时立即刷新红点
  useTicketEvents(() => {
    if (visible) ticketUnread.reload();
  });

  const accountMenu: MenuItem[] = privacy.enabled
    ? [{ label: "修改密码", description: "支付密码与登录安全", path: "/me/password", icon: <LockIcon /> }]
    : [
        { label: "个人信息", description: "姓名、学号、邮箱、校园卡", path: "/me/profile", icon: <UserIcon /> },
        { label: "修改密码", description: "支付密码与登录安全", path: "/me/password", icon: <LockIcon /> },
      ];

  const appMenu: MenuItem[] = [
    {
      label: "交易工单",
      description:
        ticketUnreadCount > 0 ? `有 ${ticketUnreadCount} 条未读消息` : "有争议时和对方沟通",
      path: "/tickets",
      icon: <TicketIcon />,
      badge: ticketUnreadCount,
    },
    { label: "设置", description: "外观与邮件通知", path: "/me/settings", icon: <SettingsIcon /> },
    { label: "关于", description: "版本、更新日志与协议", path: "/me/about", icon: <InfoIcon /> },
  ];

  /** 菜单分组：右键某一行时，把同组里的其它入口也一并列出 */
  const rowGroups: { items: MenuItem[] }[] = [{ items: accountMenu }, { items: appMenu }];

  const handleLogout = async (): Promise<void> => {
    setLoggingOut(true);
    try {
      await logout();
    } catch (cause) {
      toast.error("退出登录失败，请重试");
      setLoggingOut(false);
      void cause;
    }
  };

  // 右键 / 长按菜单：顶部信息卡、功能行、退出登录
  useContextMenus({
    "me.hero": (element) => {
      if (!me) return null;
      const openCard: ContextMenuItem = {
        label: "打开我的卡片",
        icon: <OpenIcon />,
        onSelect: () => navigate("/me/card"),
      };
      // 隐私模式下卡片上不显示个人信息，菜单里也不提供复制
      if (element.dataset.menuId === "privacy" || privacy.enabled) {
        return [
          openCard,
          { type: "separator" },
          {
            label: "复制姓名",
            icon: <CopyIcon />,
            hint: "隐私模式",
            disabled: true,
            onSelect: () => void copy(me.displayName, "姓名"),
          },
          {
            label: "复制学号",
            icon: <CopyIcon />,
            hint: "隐私模式",
            disabled: true,
            onSelect: () => void copy(me.studentNo ?? "", "学号"),
          },
        ];
      }
      return [
        openCard,
        { type: "separator" },
        { label: "复制姓名", icon: <CopyIcon />, onSelect: () => void copy(me.displayName, "姓名") },
        { label: "复制学号", icon: <CopyIcon />, onSelect: () => void copy(me.studentNo ?? "", "学号") },
      ];
    },
    "me.row": (element) => {
      const path = element.dataset.menuId ?? "";
      const group = rowGroups.find((entry) => entry.items.some((each) => each.path === path));
      const item = group?.items.find((each) => each.path === path);
      if (!group || !item) return null;
      const menuItems: ContextMenuItem[] = [
        { label: `打开${item.label}`, icon: <ArrowRightIcon />, onSelect: () => navigate(item.path) },
      ];
      const siblings = group.items.filter((each) => each.path !== path);
      if (siblings.length > 0) menuItems.push({ type: "separator" });
      for (const sibling of siblings) {
        menuItems.push({
          label: `打开${sibling.label}`,
          icon: <ArrowRightIcon />,
          onSelect: () => navigate(sibling.path),
        });
      }
      return menuItems;
    },
    "me.logout": () => [
      {
        label: "刷新工单未读",
        icon: <RefreshIcon />,
        hint: ticketUnreadCount > 0 ? `${ticketUnreadCount} 条未读` : "无未读",
        onSelect: () => ticketUnread.reload(),
      },
      { type: "separator" },
      {
        label: "退出登录",
        icon: <ArrowRightIcon />,
        danger: true,
        disabled: loggingOut,
        onSelect: () => setLogoutOpen(true),
      },
    ],
  });

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader
        title="我的"
        right={<AnnouncementBell />}
      />

      <main className="page page-with-nav space-y-4 pt-4 watch:space-y-3">
        {me ? (
          privacy.enabled ? (
            <section className="card flex items-start gap-3 p-4" data-menu="me.hero" data-menu-id="privacy">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted ring-1 ring-line">
                <EyeIcon off size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text">隐私模式已开启</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  个人信息已隐藏，其余功能正常。
                </p>
                <div className="mt-3">
                  <ExitPrivacyButton label="输入密码退出" className="btn btn-primary btn-sm" />
                </div>
              </div>
            </section>
          ) : (
          <button
            type="button"
            onClick={() => navigate("/me/card")}
            aria-label="查看我的卡片"
            data-menu="me.hero"
            data-menu-id="card"
            className="hero-gradient relative block w-full overflow-hidden rounded-3xl p-5 text-left transition active:scale-[0.99] watch:rounded-2xl watch:p-3.5"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-white/45 blur-2xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-white/25 blur-2xl"
            />
            <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-[color:var(--hero-chip)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--hero-fg)] ring-1 ring-[color:var(--hero-ring)] watch:right-3 watch:top-3 watch:px-2 watch:py-0.5 watch:text-[10px]">
              查看卡片
              <ChevronRightIcon />
            </span>
            <div className="relative flex items-center gap-4 watch:gap-2.5">
              <Avatar
                name={me.displayName}
                avatarUrl={me.avatarUrl}
                size={watch ? 44 : 60}
                className="ring-1 ring-[color:var(--hero-ring)] shadow-[0_10px_24px_-14px_rgba(0,0,0,0.55)]"
              />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-bold text-[color:var(--hero-fg)] watch:text-[15px]">
                  {me.displayName}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 watch:mt-1.5 watch:gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--hero-chip)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--hero-fg)] ring-1 ring-[color:var(--hero-ring)] watch:px-2 watch:py-0.5 watch:text-[10px]">
                    学号 {me.studentNo || "未填写"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--hero-chip)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--hero-fg)] ring-1 ring-[color:var(--hero-ring)] watch:px-2 watch:py-0.5 watch:text-[10px]">
                    卡号 {me.cardNo || "未绑定"}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-[color:var(--hero-fg-faint)] watch:mt-1.5 watch:text-[10px]">
                  加入于 {formatFriendlyTime(me.createdAt)}
                </p>
              </div>
            </div>
            {me.frozen ? (
              <p className="relative mt-4 rounded-xl bg-[color:var(--hero-chip)] px-3 py-2 text-xs leading-relaxed text-[color:var(--hero-fg)] ring-1 ring-[color:var(--hero-ring)]">
                账号已被限制，详见「关于」。
              </p>
            ) : null}
          </button>
          )
        ) : null}

        <section className="grid grid-cols-3 gap-2.5 watch:gap-2">
          <QuickTile icon={<QrIcon />} label="收付款码" hint="动态二维码" onClick={() => navigate("/dynamic-code")} />
          <QuickTile icon={<ChartIcon />} label="交易统计" hint="收支与趋势" onClick={() => navigate("/me/stats")} />
          <QuickTile
            icon={<ShopIcon />}
            label={me?.isMerchant ? "商家中心" : "成为商家"}
            hint={me?.isMerchant ? "收款与商品" : "开通收款"}
            onClick={() => navigate("/merchant")}
          />
        </section>

        <section>
          <h2 className="section-title">账户</h2>
          <div className="card overflow-hidden p-0">
            {accountMenu.map((item, index) => (
              <MenuRow key={item.path} item={item} divider={index > 0} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="section-title">应用</h2>
          <div className="card overflow-hidden p-0">
            {appMenu.map((item, index) => (
              <MenuRow key={item.path} item={item} divider={index > 0} />
            ))}
          </div>
        </section>

        <button
          type="button"
          data-menu="me.logout"
          className="card-interactive flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface py-3.5 text-sm font-semibold text-danger shadow-[var(--shadow-xs)] active:bg-danger/5 watch:rounded-xl watch:py-3"
          onClick={() => setLogoutOpen(true)}
        >
          <LogoutIcon />
          退出登录
        </button>
      </main>

      <BottomNav />

      <ConfirmDialog
        open={logoutOpen}
        title="退出登录"
        description={
          me?.displayName
            ? `退出后需重新登录：${me.displayName}`
            : "退出后需重新登录"
        }
        confirmText="退出登录"
        danger
        loading={loggingOut}
        onConfirm={() => void handleLogout()}
        onClose={() => {
          if (!loggingOut) setLogoutOpen(false);
        }}
      />
    </div>
  );
}
