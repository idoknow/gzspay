/** 公告标签：置顶 / 重要 / 注意（公告列表与详情共用）。 */

import type { ReactNode } from "react";
import { cn } from "../lib/format";
import { ANNOUNCEMENT_LEVEL_LABELS, type AnnouncementLevel } from "../lib/types";

/** 级别色调：info 不展示标签，important 用暖黄，warning 用警示红 */
const LEVEL_CLASS: Record<AnnouncementLevel, string> = {
  info: "bg-surface-2 text-muted",
  important: "bg-warning-soft text-warning",
  warning: "bg-danger-soft text-danger",
};

/** 大头针图标：置顶标签与置顶分组标题共用 */
export function PinIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21c3.6-3.4 6-6.6 6-9.7A6 6 0 0 0 6 11.3C6 14.4 8.4 17.6 12 21Z" />
      <circle cx="12" cy="11" r="2.2" />
    </svg>
  );
}

function Tag({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight watch:px-1.5 watch:text-[9px]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface AnnouncementTagsProps {
  pinned: boolean;
  level: AnnouncementLevel;
  className?: string;
}

/** 置顶 + 级别标签；两者都没有时返回 null（普通公告不占位） */
export function AnnouncementTags({ pinned, level, className }: AnnouncementTagsProps): ReactNode {
  const showLevel = level !== "info";
  if (!pinned && !showLevel) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      {pinned ? (
        <Tag className="announcement-pin-tag gap-1 pr-2">
          <PinIcon className="h-2.5 w-2.5 watch:h-2 watch:w-2" />
          置顶
        </Tag>
      ) : null}
      {showLevel ? <Tag className={LEVEL_CLASS[level]}>{ANNOUNCEMENT_LEVEL_LABELS[level]}</Tag> : null}
    </span>
  );
}
