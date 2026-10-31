/**
 * 公告发布：公告列表 + 新建/编辑/删除，支持置顶与生效/失效时间。
 */
import { useMemo, useState } from "react";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  updateAnnouncement,
} from "../api";
import { useFeedback } from "../components/dialogs";
import {
  AnnouncementStatusBadge,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InfoBanner,
  Modal,
  PageHeader,
  Switch,
  TableSkeleton,
} from "../components/ui";
import {
  formatDateTime,
  fromDateTimeInputValue,
  toDateTimeInputValue,
} from "../format";
import { useAsync } from "../hooks";
import { useAdmin } from "../context";
import { errorMessage } from "../../lib/http";
import type { Announcement, AnnouncementInput } from "../types";

type EditorState = { mode: "create" } | { mode: "edit"; announcement: Announcement } | null;

export function AnnouncementsPage() {
  const { canWrite } = useAdmin();
  const feedback = useFeedback();
  const { data, loading, error, refresh } = useAsync<Announcement[]>(
    () => getAnnouncements(),
    [],
  );
  const [editor, setEditor] = useState<EditorState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const announcements = useMemo(() => {
    const list = [...(data ?? [])];
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    });
    return list;
  }, [data]);

  async function handleDelete(announcement: Announcement) {
    const confirmed = await feedback.confirm({
      title: "删除公告",
      description: `确定删除公告「${announcement.title}」吗？删除后不可恢复，用户将不再看到该公告。`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) return;
    setDeletingId(announcement.id);
    try {
      await deleteAnnouncement(announcement.id);
      feedback.success("公告已删除");
      refresh();
    } catch (err) {
      feedback.error(errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="公告发布"
        description="发布全校可见的公告通知，可设置生效时间、失效时间与置顶。"
        actions={
          <>
            <button
              type="button"
              className="admin-btn admin-btn-subtle admin-btn-sm"
              onClick={() => refresh()}
              disabled={loading}
            >
              刷新
            </button>
            {canWrite ? (
              <Button variant="primary" onClick={() => setEditor({ mode: "create" })}>
                新建公告
              </Button>
            ) : null}
          </>
        }
      />

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refresh()} />
      ) : loading && !data ? (
        <div className="admin-card">
          <TableSkeleton rows={5} cols={5} />
        </div>
      ) : (
        <div className="admin-stack">
          {!canWrite ? (
            <InfoBanner tone="info">
              当前账号为只读审计角色，可以查看公告但无法新建、编辑或删除。
            </InfoBanner>
          ) : null}

          <Card
            title="公告列表"
            subtitle="置顶公告优先展示，其余按创建时间倒序"
            extra={<Badge tone="neutral">{announcements.length} 条</Badge>}
            flush
          >
            {announcements.length === 0 ? (
              <EmptyState
                title="暂无公告"
                description={
                  canWrite
                    ? "点击右上角「新建公告」发布第一条公告。"
                    : "还没有发布任何公告。"
                }
              />
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>公告</th>
                      <th>展示状态</th>
                      <th>生效时间</th>
                      <th>失效时间</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {announcements.map((announcement) => {
                      const status = announcementStatusInfo(announcement);
                      return (
                        <tr key={announcement.id}>
                          <td>
                            <div className="admin-flex" style={{ gap: 6, flexWrap: "wrap" }}>
                              {announcement.pinned ? (
                                <Badge tone="accent">置顶</Badge>
                              ) : null}
                              <span className="admin-cell-primary">
                                {announcement.title}
                              </span>
                              <AnnouncementStatusBadge
                                startsAt={announcement.startsAt}
                                endsAt={announcement.endsAt}
                              />
                            </div>
                            <div className="admin-text-sm admin-muted admin-clamp-2">
                              {announcement.content}
                            </div>
                          </td>
                          <td className="admin-text-sm">{status.detail}</td>
                          <td className="admin-text-sm">
                            {formatDateTime(announcement.startsAt)}
                          </td>
                          <td className="admin-text-sm">
                            {formatDateTime(announcement.endsAt)}
                          </td>
                          <td className="admin-text-sm admin-muted">
                            {formatDateTime(announcement.updatedAt)}
                          </td>
                          <td>
                            <div className="admin-cell-actions">
                              {canWrite ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      setEditor({ mode: "edit", announcement })
                                    }
                                  >
                                    编辑
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="danger-ghost"
                                    loading={deletingId === announcement.id}
                                    disabled={deletingId === announcement.id}
                                    onClick={() => handleDelete(announcement)}
                                  >
                                    删除
                                  </Button>
                                </>
                              ) : (
                                <span className="admin-text-xs admin-muted">只读</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {editor ? (
        <AnnouncementEditor
          announcement={editor.mode === "edit" ? editor.announcement : null}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function announcementStatusInfo(announcement: Announcement): { detail: string } {
  const now = Date.now();
  const starts = Date.parse(announcement.startsAt ?? "");
  const ends = Date.parse(announcement.endsAt ?? "");
  if (Number.isFinite(starts) && now < starts) return { detail: "到达生效时间后展示" };
  if (Number.isFinite(ends) && now > ends) return { detail: "已超过失效时间" };
  return { detail: "正在向全校展示" };
}

interface AnnouncementEditorProps {
  announcement: Announcement | null;
  onClose: () => void;
  onSaved: () => void;
}

function AnnouncementEditor({ announcement, onClose, onSaved }: AnnouncementEditorProps) {
  const feedback = useFeedback();
  const isEdit = announcement !== null;
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [content, setContent] = useState(announcement?.content ?? "");
  const [startsAt, setStartsAt] = useState(
    announcement ? toDateTimeInputValue(announcement.startsAt) : "",
  );
  const [endsAt, setEndsAt] = useState(
    announcement ? toDateTimeInputValue(announcement.endsAt) : "",
  );
  const [pinned, setPinned] = useState(announcement?.pinned ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle) {
      setFormError("请填写公告标题。");
      return;
    }
    if (!trimmedContent) {
      setFormError("请填写公告正文。");
      return;
    }
    if (!startsAt || !endsAt) {
      setFormError("请填写生效时间与失效时间。");
      return;
    }
    const startsIso = fromDateTimeInputValue(startsAt);
    const endsIso = fromDateTimeInputValue(endsAt);
    if (!startsIso || !endsIso) {
      setFormError("生效时间或失效时间格式不正确。");
      return;
    }
    if (Date.parse(endsIso) <= Date.parse(startsIso)) {
      setFormError("失效时间必须晚于生效时间。");
      return;
    }

    const input: AnnouncementInput = {
      title: trimmedTitle,
      content: trimmedContent,
      startsAt: startsIso,
      endsAt: endsIso,
      pinned,
    };

    setSubmitting(true);
    setFormError(null);
    try {
      if (isEdit) {
        await updateAnnouncement(announcement.id, input);
        feedback.success("公告已更新");
      } else {
        await createAnnouncement(input);
        feedback.success("公告已发布");
      }
      onSaved();
    } catch (err) {
      const message = errorMessage(err);
      setFormError(message);
      feedback.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "编辑公告" : "新建公告"}
      description="公告内容将展示给全校用户，请仔细核对生效与失效时间。"
      onClose={onClose}
      wide
      footer={
        <>
          <button
            type="button"
            className="admin-btn admin-btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "正在保存…" : isEdit ? "保存修改" : "发布公告"}
          </button>
        </>
      }
    >
      <div className="admin-form-grid">
        <Field label="公告标题" required className="admin-field-full">
          <input
            className="admin-input"
            value={title}
            maxLength={100}
            placeholder="例如：关于双十一期间支付渠道维护的通知"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="公告正文" required className="admin-field-full">
          <textarea
            className="admin-textarea"
            rows={8}
            value={content}
            placeholder="填写公告正文，支持换行。"
            onChange={(event) => setContent(event.target.value)}
          />
        </Field>
        <Field label="生效时间" required>
          <input
            type="datetime-local"
            className="admin-input"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </Field>
        <Field label="失效时间" required>
          <input
            type="datetime-local"
            className="admin-input"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </Field>
        <Field
          label="置顶展示"
          hint="置顶公告在校园墙公告列表顶部优先展示。"
          className="admin-field-full"
        >
          <Switch checked={pinned} onChange={setPinned} label="置顶该公告" />
        </Field>
      </div>
      {formError ? (
        <div className="admin-inline-alert is-danger" style={{ marginTop: 12 }}>
          {formError}
        </div>
      ) : null}
      <p className="admin-readonly-hint" style={{ marginTop: 12 }}>
        提示：生效时间早于当前时间时公告会立即展示；失效后自动隐藏但记录保留。
      </p>
    </Modal>
  );
}
