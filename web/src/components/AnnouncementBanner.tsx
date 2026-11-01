/** 交易页顶部公告通知（苹果通知中心风格，磨砂玻璃卡片）：可关闭，当天内记住（localStorage 按日期）。 */

import { useMemo, useState, type ReactNode } from "react";
import { getActiveAnnouncements } from "../lib/api";
import { toDateKey } from "../lib/format";
import { useAsync, useWatchLayout } from "../lib/hooks";
import type { Announcement } from "../lib/types";
import { Dialog } from "./Dialog";
import { LogoMark } from "./Logo";

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
  const watch = useWatchLayout();
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
      <div className="animate-notify-in mb-3 flex items-center justify-between rounded-[22px] border border-line/70 bg-surface/80 px-3.5 py-2.5 text-xs text-muted shadow-[var(--shadow-xs)] backdrop-blur-2xl">
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
      <div className="animate-notify-in relative mb-3 rounded-[22px] border border-line/70 bg-surface/80 py-3 pr-11 pl-3.5 shadow-[0_20px_44px_-24px_rgba(17,20,26,0.6)] backdrop-blur-2xl watch:rounded-[18px] watch:py-2.5 watch:pr-9 watch:pl-3">
        <div className="flex items-start gap-3 watch:gap-2.5">
          <span className="shrink-0 drop-shadow-[0_4px_10px_rgba(30,107,255,0.35)]">
            <LogoMark size={watch ? 30 : 38} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold tracking-wide text-muted">gzspay</span>
              <span className="text-[10px] text-muted/70">公告</span>
            </div>
            <button
              type="button"
              className="mt-0.5 block w-full text-left"
              onClick={() => setDetail(announcement)}
            >
              <span className="block truncate text-[13.5px] font-semibold leading-relaxed text-text watch:text-[12.5px]">
                {announcement.title}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-muted watch:text-[11.5px]">
                {announcement.content}
              </span>
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="关闭公告"
          onClick={dismiss}
          className="absolute top-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded-full text-muted/80 transition hover:bg-surface-2 active:scale-90 watch:top-2 watch:right-2"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <Dialog open={detail !== null} onClose={() => setDetail(null)} title={detail?.title ?? "公告"}>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">{detail?.content}</p>
      </Dialog>
    </>
  );
}
