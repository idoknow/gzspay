/** 公告详情：进入后标记已读，正文用 Markdown 渲染。 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnnouncementTags } from "../components/AnnouncementTags";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { getAnnouncements, markAnnouncementRead } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { Markdown } from "../lib/markdown";
import type { Announcement } from "../lib/types";

/** 修改时间与发布时间不同才展示「修改于」 */
function wasUpdated(item: Announcement): boolean {
  const published = Date.parse(item.publishedAt);
  const updated = Date.parse(item.updatedAt);
  if (Number.isNaN(published) || Number.isNaN(updated)) return false;
  return updated !== published;
}

export function AnnouncementDetailPage(): ReactNode {
  const navigate = useNavigate();
  const { id = "" } = useParams<{ id: string }>();
  const { data, loading, error, reload } = useAsync(() => getAnnouncements(), [id]);

  const announcement = useMemo<Announcement | null>(
    () => (data?.items ?? []).find((item) => item.id === id) ?? null,
    [data, id],
  );

  /** 已发出过已读请求的公告 id，避免同一条重复 POST */
  const markedIdRef = useRef<string | null>(null);

  // 打开详情即标记已读：失败不打扰阅读，列表页每次挂载会重新拉取，因此未读数自动减少
  useEffect(() => {
    if (!announcement || announcement.read) return;
    if (markedIdRef.current === announcement.id) return;
    markedIdRef.current = announcement.id;
    markAnnouncementRead(announcement.id).catch(() => {
      markedIdRef.current = null;
    });
  }, [announcement]);

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="公告详情" back />

      <main className="page pt-4 pb-10 watch:pt-3 watch:pb-6">
        {loading && !data ? (
          <LoadingBlock text="正在加载公告…" />
        ) : error && !data ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !announcement ? (
          <EmptyState
            title="公告不存在"
            description="可能已被撤回或链接失效"
            action={
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => navigate("/announcements", { replace: true })}
              >
                返回列表
              </button>
            }
          />
        ) : (
          <article className="card p-5 watch:rounded-2xl watch:p-3.5">
            <AnnouncementTags pinned={announcement.pinned} level={announcement.level} className="mb-2" />
            <h1 className="text-[19px] font-bold leading-snug text-text watch:text-[16px]">{announcement.title}</h1>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted watch:text-[10.5px]">
              发布于 {formatDateTime(announcement.publishedAt)}
              {wasUpdated(announcement) ? ` · 修改于 ${formatDateTime(announcement.updatedAt)}` : null}
            </p>
            <div className="divider my-3 watch:my-2" />
            <Markdown text={announcement.content} className="text-[14.5px] watch:text-[13px]" />
          </article>
        )}
      </main>
    </div>
  );
}
