/** 交易页公告横幅：可关闭，当天内记住（localStorage 按日期）。 */

import { useMemo, useState, type ReactNode } from "react";
import { getActiveAnnouncements } from "../lib/api";
import { toDateKey } from "../lib/format";
import { useAsync } from "../lib/hooks";
import type { Announcement } from "../lib/types";
import { Dialog } from "./Dialog";

const STORAGE_KEY = "gzspay-announcement-dismissed";

interface DismissedState {
  date: string;
  id: string;
}

function readDismissed(): DismissedState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DismissedState> | null;
    if (!parsed || typeof parsed.date !== "string" || typeof parsed.id !== "string") return null;
    return { date: parsed.date, id: parsed.id };
  } catch {
    return null;
  }
}

export function AnnouncementBanner(): ReactNode {
  const today = toDateKey(new Date());
  const dismissed = useMemo(() => readDismissed(), []);
  const { data, error, reload } = useAsync(() => getActiveAnnouncements(), []);
  const [hidden, setHidden] = useState(false);
  const [detail, setDetail] = useState<Announcement | null>(null);

  const announcement = useMemo<Announcement | null>(() => {
    const items = data?.items ?? [];
    return items.find((item) => item.pinned) ?? items[0] ?? null;
  }, [data]);

  if (hidden) return null;

  if (error) {
    return (
      <div className="mb-3 flex items-center justify-between rounded-2xl bg-surface-2 px-3.5 py-2 text-xs text-muted">
        <span>公告加载失败</span>
        <button type="button" className="font-semibold text-brand" onClick={reload}>
          重试
        </button>
      </div>
    );
  }

  if (!announcement) return null;
  if (dismissed && dismissed.date === today && dismissed.id === announcement.id) return null;

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, id: announcement.id }));
    } catch {
      // 隐私模式下 localStorage 可能不可用，忽略即可
    }
    setHidden(true);
  };

  return (
    <>
      <div className="mb-3 flex items-start gap-3 rounded-2xl bg-accent-soft px-3.5 py-3 shadow-[var(--shadow-xs)] ring-1 ring-accent/30">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#4a3300]"
          style={{ background: "var(--accent-gradient)" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 10v4l5 1 5 4V5L9 9l-5 1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M17 9.5a4 4 0 0 1 0 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDetail(announcement)}>
          <p className="truncate text-sm font-semibold text-text">{announcement.title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-warning">{announcement.content}</p>
        </button>
        <button
          type="button"
          aria-label="关闭公告"
          onClick={dismiss}
          className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-warning/80 active:bg-black/5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <Dialog open={detail !== null} onClose={() => setDetail(null)} title={detail?.title ?? "公告"}>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{detail?.content}</p>
      </Dialog>
    </>
  );
}
