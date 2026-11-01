/**
 * 公告发布：公告列表 + 新建/编辑/删除。
 * 公告按「创建即发布」处理：发布日期默认等于创建时间，可手动修改；
 * 修改标题/正文/级别/发布日期后会清空已读记录，等价于重新推送（用户端再次出现红点）。
 */
import { useMemo, useState } from "react";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  updateAnnouncement,
} from "../api";
import { RichTextEditor } from "../components/RichTextEditor";
import { useFeedback } from "../components/dialogs";
import {
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
import type {
  Announcement,
  AnnouncementInput,
  AnnouncementLevel,
} from "../types";

type EditorState = { mode: "create" } | { mode: "edit"; announcement: Announcement } | null;

const LEVEL_OPTIONS: { value: AnnouncementLevel; label: string; hint: string }[] = [
  { value: "info", label: "普通", hint: "日常通知" },
  { value: "important", label: "重要", hint: "需要用户重点留意" },
  { value: "warning", label: "警告", hint: "渠道维护、风险提醒等" },
];

const LEVEL_META: Record<AnnouncementLevel, { label: string; tone: "neutral" | "primary" | "warning" }> = {
  info: { label: "普通", tone: "neutral" },
  important: { label: "重要", tone: "primary" },
  warning: { label: "警告", tone: "warning" },
};

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
      return (b.publishedAt ?? b.createdAt ?? "").localeCompare(
        a.publishedAt ?? a.createdAt ?? "",
      );
    });
    return list;
  }, [data]);

  const totalRead = useMemo(
    () => announcements.reduce((acc, item) => acc + item.readCount, 0),
    [announcements],
  );

  async function handleDelete(announcement: Announcement) {
    const confirmed = await feedback.confirm({
      title: "删除公告",
      description: `确定删除公告「${announcement.title}」吗？删除后不可恢复，用户端也会立即消失。`,
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
        description="发布后主站顶部铃铛旁会显示未读红点，用户读过后红点消失；修改公告会重新推送。"
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
            subtitle="置顶公告优先展示，其余按发布日期倒序"
            extra={
              <div className="admin-flex" style={{ gap: 8, flexWrap: "wrap" }}>
                <Badge tone="neutral">{announcements.length} 条</Badge>
                <Badge tone="primary">累计已读 {totalRead}</Badge>
              </div>
            }
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
                      <th>级别</th>
                      <th>阅读情况</th>
                      <th>发布日期</th>
                      <th>修改日期</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {announcements.map((announcement) => {
                      const level = LEVEL_META[announcement.level];
                      const readRatio =
                        announcement.totalUsers > 0
                          ? Math.round((announcement.readCount / announcement.totalUsers) * 100)
                          : 0;
                      return (
                        <tr key={announcement.id}>
                          <td>
                            <div className="admin-flex" style={{ gap: 6, flexWrap: "wrap" }}>
                              {announcement.pinned ? <Badge tone="accent">置顶</Badge> : null}
                              <span className="admin-cell-primary">{announcement.title}</span>
                            </div>
                            <div className="admin-text-sm admin-muted admin-clamp-2">
                              {plainSummary(announcement.content)}
                            </div>
                          </td>
                          <td>
                            <Badge tone={level.tone}>{level.label}</Badge>
                          </td>
                          <td className="admin-text-sm">
                            <div>
                              {announcement.readCount} / {announcement.totalUsers}
                              <span className="admin-muted">（{readRatio}%）</span>
                            </div>
                            <div className="admin-text-xs admin-muted">已读 / 全部用户</div>
                          </td>
                          <td className="admin-text-sm">
                            {formatDateTime(announcement.publishedAt ?? announcement.createdAt)}
                          </td>
                          <td className="admin-text-sm admin-muted">
                            {announcement.edited
                              ? formatDateTime(announcement.updatedAt)
                              : "未修改"}
                          </td>
                          <td>
                            <div className="admin-cell-actions">
                              {canWrite ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditor({ mode: "edit", announcement })}
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

/** 列表摘要：去掉 Markdown 标记，避免显示一堆符号 */
function plainSummary(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const [level, setLevel] = useState<AnnouncementLevel>(announcement?.level ?? "info");
  const [pinned, setPinned] = useState(announcement?.pinned ?? false);
  const [publishedAt, setPublishedAt] = useState(
    toDateTimeInputValue(
      announcement?.publishedAt ?? announcement?.createdAt ?? new Date().toISOString(),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const createdAtLabel = isEdit
    ? formatDateTime(announcement.createdAt)
    : "保存时自动记录";
  const updatedAtLabel =
    isEdit && announcement.edited ? formatDateTime(announcement.updatedAt) : "保存修改后记录";

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
    const publishedIso = publishedAt ? fromDateTimeInputValue(publishedAt) : null;
    if (publishedAt && !publishedIso) {
      setFormError("发布日期格式不正确。");
      return;
    }

    const input: AnnouncementInput = {
      title: trimmedTitle,
      content: trimmedContent,
      level,
      pinned,
      publishedAt: publishedIso,
    };

    setSubmitting(true);
    setFormError(null);
    try {
      if (isEdit) {
        const result = await updateAnnouncement(announcement.id, input);
        feedback.success(
          result.republished
            ? "公告已更新并重新推送，用户端会重新出现未读红点"
            : "公告已更新",
        );
      } else {
        await createAnnouncement(input);
        feedback.success("公告已发布，用户端会出现未读红点");
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
      description="公告内容会展示给全校用户；修改标题、正文、级别或发布日期后会重新推送。"
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
            maxLength={80}
            placeholder="例如：关于双十一期间支付渠道维护的通知"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>

        <Field label="公告正文" required className="admin-field-full">
          <RichTextEditor value={content} onChange={setContent} maxLength={8000} />
        </Field>

        <Field
          label="公告级别"
          hint="重要与警告会在用户端用不同颜色标记，方便快速识别。"
        >
          <select
            className="admin-select"
            value={level}
            onChange={(event) => setLevel(event.target.value as AnnouncementLevel)}
          >
            {LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}（{option.hint}）
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="发布日期"
          hint="默认等于创建时间，可以修改成更早或更晚的时间。"
        >
          <input
            type="datetime-local"
            className="admin-input"
            value={publishedAt}
            onChange={(event) => setPublishedAt(event.target.value)}
          />
        </Field>

        <Field label="时间记录" className="admin-field-full">
          <div className="admin-flex admin-text-sm admin-muted" style={{ gap: 16, flexWrap: "wrap" }}>
            <span>创建时间：{createdAtLabel}</span>
            <span>修改时间：{updatedAtLabel}</span>
          </div>
        </Field>

        <Field
          label="置顶展示"
          hint="置顶公告在用户端公告列表顶部优先展示。"
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
        提示：修改已发布公告的标题、正文、级别或发布日期后，已读记录会被清空，
        所有用户会重新收到未读红点。
      </p>
    </Modal>
  );
}
