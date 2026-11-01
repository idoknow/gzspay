/** 公告列表：顶部统计 + 未读 / 已读分组，点击进入详情阅读 Markdown 全文。 */

import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnnouncementTags, PinIcon } from "../components/AnnouncementTags";
import { BottomNav } from "../components/BottomNav";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { getAnnouncements } from "../lib/api";
import { cn, formatDateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";
import type { Announcement } from "../lib/types";

/** 置顶优先，其次发布时间倒序（与接口排序保持一致，前端再兜底一次） */
function sortAnnouncements(items: Announcement[]): Announcement[] {
  const timeOf = (value: string): number => {
    const time = Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
  };
  return [...items].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return timeOf(right.publishedAt) - timeOf(left.publishedAt);
  });
}

/**
 * Markdown 源文本 → 纯文本摘要（列表只展示两行）。
 * 这里只做「去记号」的简化处理，完整渲染交给详情页的 Markdown 组件。
 */
function plainSummary(content: string): string {
  const text = content
    .replace(/\r\n/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`_~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** 修改时间与发布时间不同才展示「修改于」 */
function wasUpdated(item: Announcement): boolean {
  const published = Date.parse(item.publishedAt);
  const updated = Date.parse(item.updatedAt);
  if (Number.isNaN(published) || Number.isNaN(updated)) return false;
  return updated !== published;
}

function AnnouncementCard({
  item,
  onClick,
  showPinnedTag = true,
}: {
  item: Announcement;
  onClick: () => void;
  /** 置顶分组里的卡片不再重复显示「置顶」标签，避免与分组标题重复 */
  showPinnedTag?: boolean;
}): ReactNode {
  const summary = plainSummary(item.content);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "card card-interactive block w-full px-4 py-3.5 text-left watch:rounded-2xl watch:px-3 watch:py-2.5",
        item.pinned && "card-pinned",
      )}
    >
      <div className="flex items-start gap-2.5 watch:gap-2">
        {/* 未读实心圆点；已读留白保持左侧对齐 */}
        <span className="mt-[7px] flex h-2 w-2 shrink-0 items-center justify-center watch:mt-1.5" aria-hidden="true">
          {item.read ? null : <span className="h-2 w-2 rounded-full bg-brand watch:h-[7px] watch:w-[7px]" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[15px] text-text watch:text-[13.5px]",
                item.read ? "font-medium" : "font-bold",
              )}
            >
              {item.title}
            </span>
            <AnnouncementTags pinned={showPinnedTag && item.pinned} level={item.level} />
          </span>
          {summary ? (
            <span className="mt-1 line-clamp-2 block text-[12.5px] leading-relaxed text-muted watch:mt-0.5 watch:text-[11.5px]">
              {summary}
            </span>
          ) : null}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted/85 watch:mt-1 watch:text-[10px]">
            <span>发布于 {formatDateTime(item.publishedAt)}</span>
            {wasUpdated(item) ? <span>修改于 {formatDateTime(item.updatedAt)}</span> : null}
          </span>
        </span>
      </div>
    </button>
  );
}

function AnnouncementGroup({
  title,
  items,
  onOpen,
  pinned = false,
}: {
  title: string;
  items: Announcement[];
  onOpen: (id: string) => void;
  pinned?: boolean;
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className={cn("section-title", pinned && "section-title-pinned")}>
        {title}
        <span className="font-normal text-muted/70">{items.length} 条</span>
        {pinned ? <PinIcon className="h-3.5 w-3.5 text-warning watch:h-3 watch:w-3" /> : null}
      </h2>
      <div className="space-y-2.5 watch:space-y-2">
        {items.map((item) => (
          <AnnouncementCard
            key={item.id}
            item={item}
            onClick={() => onOpen(item.id)}
            showPinnedTag={!pinned}
          />
        ))}
      </div>
    </section>
  );
}

export function AnnouncementsPage(): ReactNode {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(() => getAnnouncements(), []);

  const { pinned, unread, read, total, pinnedCount, unreadCount } = useMemo(() => {
    const items = sortAnnouncements(data?.items ?? []);
    const pinnedItems = items.filter((item) => item.pinned);
    const others = items.filter((item) => !item.pinned);
    return {
      pinned: pinnedItems,
      unread: others.filter((item) => !item.read),
      read: others.filter((item) => item.read),
      total: items.length,
      pinnedCount: pinnedItems.length,
      // 未读条数以服务端为准，缺失时退回本地分组长度
      unreadCount: data?.unreadCount ?? items.filter((item) => !item.read).length,
    };
  }, [data]);

  const openDetail = (id: string): void => {
    navigate(`/announcements/${id}`);
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="公告" back />

      <main className="page page-with-nav space-y-4 pt-4 watch:space-y-3 watch:pt-3">
        {loading && !data ? (
          <LoadingBlock text="正在加载公告…" />
        ) : error && !data ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : total === 0 ? (
          <EmptyState title="暂无公告" description="管理员发布公告后会显示在这里" />
        ) : (
          <>
            <p className="px-1 text-xs text-muted watch:text-[11px]">
              共 {total} 条
              {pinnedCount > 0 ? ` · ${pinnedCount} 条置顶` : ""}
              {unreadCount > 0 ? ` · ${unreadCount} 条未读` : " · 全部已读"}
            </p>

            <AnnouncementGroup title="置顶" items={pinned} onOpen={openDetail} pinned />
            <AnnouncementGroup title="未读" items={unread} onOpen={openDetail} />
            <AnnouncementGroup title="已读" items={read} onOpen={openDetail} />

            {error ? (
              <p className="pt-1 text-center text-xs text-danger">
                {error}
                <button type="button" className="ml-2 font-semibold text-brand" onClick={reload}>
                  重试
                </button>
              </p>
            ) : null}
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
