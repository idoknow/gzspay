/**
 * 管理员管理（仅超级管理员）：管理员列表、从现有用户中添加管理员、移除管理员、角色权限说明。
 */
import { useState } from "react";
import { addAdmin, getAdmins, getUsers, removeAdmin } from "../api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  RoleBadge,
  SectionTitle,
  TableSkeleton,
} from "../components/ui";
import { AdminAvatar } from "../components/AdminAvatar";
import { useFeedback } from "../components/dialogs";
import { useAdmin } from "../context";
import { formatDateTime, formatNumber, roleLabel } from "../format";
import { useAsync, useDebounced } from "../hooks";
import { errorMessage } from "../../lib/http";
import type { AdminMember, AdminRole, AdminUser } from "../types";

const ROLE_OPTIONS: Array<{ value: AdminRole; label: string; description: string }> = [
  {
    value: "super",
    label: "超级管理员",
    description: "全部权限：可管理管理员、系统配置及所有业务操作。",
  },
  {
    value: "ops",
    label: "运营",
    description: "可处理订单、申诉、用户与公告，可查看日志；不可修改系统配置与管理员。",
  },
  {
    value: "auditor",
    label: "只读审计",
    description: "仅可查看数据、日志与配置，所有写操作均被禁用。",
  },
];

export function AdminsPage() {
  const feedback = useFeedback();
  const { admin } = useAdmin();
  const admins = useAsync<AdminMember[]>(() => getAdmins(), []);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const rows = admins.data ?? [];

  const handleRemove = async (member: AdminMember) => {
    if (member.userId === admin.id) {
      feedback.warning("不能移除当前登录的管理员账号");
      return;
    }
    const confirmed = await feedback.confirm({
      title: "移除管理员",
      description: `确认移除「${member.displayName}」的管理员权限？移除后该用户将无法登录管理后台。`,
      confirmText: "确认移除",
      danger: true,
    });
    if (!confirmed) return;
    setRemovingId(member.userId || member.id);
    try {
      await removeAdmin(member.userId || member.id);
      feedback.success("已移除管理员权限");
      admins.refresh();
    } catch (error) {
      feedback.error(errorMessage(error));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="管理员管理"
        description="管理员账号从现有校园墙用户中添加，角色决定其可执行的操作范围。"
        actions={
          <div className="admin-flex" style={{ gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAdding(true)}
            >
              添加管理员
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => admins.refresh()}
              disabled={admins.loading}
            >
              刷新
            </Button>
          </div>
        }
      />

      <div className="admin-stack">
        <Card
          title="管理员列表"
          subtitle={`共 ${formatNumber(rows.length)} 位管理员`}
          flush
        >
          {admins.error && !admins.data ? (
            <div style={{ padding: 18 }}>
              <ErrorState
                message={errorMessage(admins.error)}
                onRetry={() => admins.refresh()}
              />
            </div>
          ) : admins.loading && !admins.data ? (
            <div style={{ padding: 18 }}>
              <TableSkeleton rows={5} cols={5} />
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState title="暂无管理员" description="请添加第一位管理员。" />
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>管理员</th>
                    <th>角色</th>
                    <th>邮箱</th>
                    <th>加入时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((member) => {
                    const isSelf = member.userId === admin.id;
                    return (
                      <tr key={member.userId || member.id}>
                        <td>
                          <div className="admin-flex" style={{ gap: 10 }}>
                            <AdminAvatar name={member.displayName} avatarUrl={member.avatarUrl} />
                            <div>
                              <div className="admin-cell-primary">
                                {member.displayName}
                                {isSelf ? (
                                  <span className="admin-text-xs admin-muted"> （当前账号）</span>
                                ) : null}
                              </div>
                              <div className="admin-cell-sub admin-text-xs admin-mono">
                                {member.userId || member.id}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <RoleBadge role={member.role} />
                        </td>
                        <td className="admin-text-sm">{member.emailMasked || "—"}</td>
                        <td className="admin-text-sm admin-muted">
                          {formatDateTime(member.createdAt)}
                        </td>
                        <td>
                          <div className="admin-cell-actions">
                            <Button
                              variant="danger-ghost"
                              size="sm"
                              loading={removingId === (member.userId || member.id)}
                              disabled={isSelf || removingId !== null}
                              title={isSelf ? "不能移除当前登录账号" : undefined}
                              onClick={() => void handleRemove(member)}
                            >
                              移除
                            </Button>
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

        <Card title="角色权限说明">
          <div className="admin-role-cards">
            {ROLE_OPTIONS.map((option) => (
              <div key={option.value} className="admin-role-card">
                <div className="admin-flex" style={{ gap: 8, alignItems: "center" }}>
                  <RoleBadge role={option.value} />
                  <span className="admin-role-card-title">{option.label}</span>
                </div>
                <p className="admin-text-sm admin-muted" style={{ marginTop: 8 }}>
                  {option.description}
                </p>
              </div>
            ))}
          </div>
          <p className="admin-readonly-hint" style={{ marginTop: 14 }}>
            安全要求：管理员权限复用主站登录会话；所有管理员操作会写入不可修改的操作日志。
          </p>
        </Card>
      </div>

      {adding ? (
        <AddAdminModal
          existingUserIds={rows.map((member) => member.userId || member.id)}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            admins.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------- 添加管理员弹窗 */

interface AddAdminModalProps {
  existingUserIds: string[];
  onClose: () => void;
  onAdded: () => void;
}

function AddAdminModal({ existingUserIds, onClose, onAdded }: AddAdminModalProps) {
  const feedback = useFeedback();
  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebounced(keyword, 300);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [role, setRole] = useState<AdminRole>("ops");
  const [submitting, setSubmitting] = useState(false);

  const users = useAsync(
    () => getUsers(debouncedKeyword, 1, 20),
    [debouncedKeyword],
  );
  const candidates = users.data?.items ?? [];

  const submit = async () => {
    if (!selected) {
      feedback.warning("请先从用户列表中选择要添加的用户");
      return;
    }
    setSubmitting(true);
    try {
      await addAdmin(selected.id, role);
      feedback.success(`已将「${selected.displayName}」添加为${roleLabel(role)}`);
      onAdded();
    } catch (error) {
      feedback.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="添加管理员"
      description="从现有校园墙用户中搜索并选择，添加后该用户可使用校园墙账号登录后台。"
      onClose={onClose}
      wide
      footer={
        <div className="admin-flex" style={{ gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={submitting}
            disabled={!selected || submitting}
            onClick={() => void submit()}
          >
            确认添加
          </Button>
        </div>
      }
    >
      <div className="admin-stack">
        <Field label="搜索用户" hint="支持姓名、学号、邮箱关键词；最多显示 20 条结果">
          <input
            className="admin-input"
            value={keyword}
            placeholder="输入姓名 / 学号 / 邮箱"
            onChange={(event) => {
              setKeyword(event.target.value);
              setSelected(null);
            }}
            autoFocus
          />
        </Field>

        <div className="admin-choice-list">
          {users.error ? (
            <ErrorState
              message={errorMessage(users.error)}
              onRetry={() => users.refresh()}
            />
          ) : users.loading && !users.data ? (
            <TableSkeleton rows={3} cols={3} />
          ) : candidates.length === 0 ? (
            <EmptyState
              title={debouncedKeyword ? "没有匹配的用户" : "请输入关键词搜索用户"}
              description="只能从已有校园墙用户中添加管理员。"
            />
          ) : (
            candidates.map((user) => {
              const isAdmin = existingUserIds.includes(user.id);
              const isSelected = selected?.id === user.id;
              return (
                <button
                  key={user.id}
                  type="button"
                  className={`admin-user-choice${isSelected ? " is-selected" : ""}`}
                  disabled={isAdmin}
                  onClick={() => setSelected(user)}
                >
                  <div>
                    <div className="admin-cell-primary">
                      {user.displayName}
                      {user.isMerchant ? (
                        <span className="admin-text-xs admin-muted"> · 商家</span>
                      ) : null}
                    </div>
                    <div className="admin-text-xs admin-muted">
                      {user.studentNoMasked || "—"} · {user.emailMasked || "—"}
                    </div>
                  </div>
                  {isAdmin ? (
                    <Badge tone="neutral">已是管理员</Badge>
                  ) : isSelected ? (
                    <Badge tone="primary">已选择</Badge>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <SectionTitle>分配角色</SectionTitle>
        <div className="admin-form-grid">
          <Field label="角色">
            <select
              className="admin-select"
              value={role}
              onChange={(event) => setRole(event.target.value as AdminRole)}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="权限说明">
            <div className="admin-text-sm admin-muted">
              {ROLE_OPTIONS.find((option) => option.value === role)?.description}
            </div>
          </Field>
        </div>

        <div className="admin-inline-alert is-warning">
          添加管理员属于敏感操作，将记录操作日志；请遵循最小权限原则分配角色。
        </div>
      </div>
    </Modal>
  );
}
