/** 顶部公告按钮：点击进入公告列表；有未读时右上角显示红点。 */

import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getAnnouncements } from "../lib/api";
import { cn } from "../lib/format";

export interface AnnouncementBellProps {
  className?: string;
}

/**
 * 未读数属于「辅助提示」：挂载、路由变化、窗口重新可见 / 获得焦点时静默刷新；
 * 请求失败保持上一次的数量，不弹错误、不打断用户。
 */
export function AnnouncementBell({ className }: AnnouncementBellProps): ReactNode {
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // 卸载后不再 setState：用 active 标记丢弃迟到的响应
    let active = true;
    const refresh = (): void => {
      getAnnouncements()
        .then((result) => {
          if (active) setUnreadCount(result.unreadCount);
        })
        .catch(() => {
          // 静默失败：保留上一次的未读数
        });
    };
    refresh();
    const onVisible = (): void => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
    // 路由变化（例如从公告列表返回）时重新拉取未读数
  }, [location.pathname]);

  const hasUnread = unreadCount > 0;

  return (
    <button
      type="button"
      onClick={() => navigate("/announcements")}
      // aria-label 已带数量；红点本身无文字，视觉信息由下面的 sr-only 文案补充
      aria-label={hasUnread ? `公告（${unreadCount} 条未读）` : "公告"}
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-text shadow-[var(--shadow-xs)] transition active:scale-95 active:bg-surface-2",
        "watch:h-8 watch:w-8",
        className,
      )}
    >
      <svg
        className="h-[21px] w-[21px] watch:h-[17px] watch:w-[17px]"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M18 16H6c1.3-1.5 1.8-3.1 1.8-5.1a4.2 4.2 0 0 1 8.4 0c0 2 .5 3.6 1.8 5.1Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M10.2 19a1.9 1.9 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {hasUnread ? (
        <span
          aria-hidden="true"
          // 2px 页面底色描边，避免红点贴在图标边缘看不清
          className="absolute top-1 right-1 h-2 w-2 rounded-full bg-danger ring-2 ring-bg watch:top-0.5 watch:right-0.5 watch:h-[7px] watch:w-[7px]"
        />
      ) : null}
      {hasUnread ? <span className="sr-only">{unreadCount} 条未读公告</span> : null}
    </button>
  );
}
