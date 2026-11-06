/**
 * 用户管理：总数与新增趋势、姓名/学号/邮箱搜索、分页列表、用户详情及写操作。
 */
import { useState } from "react";
import {
  freezeUser,
  forceLogoutUser,
  getOnlineUsers,
  getUserDetail,
  getUserLogins,
  getUsers,
  getUsersGrowth,
  resetUserCard,
  unfreezeUser,
} from "../api";
import { BarChart } from "../components/charts";
import { AdminAvatar } from "../components/AdminAvatar";
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  InfoBanner,
  KVGrid,
  OrderStatusBadge,
  PageHeader,
  Pagination,
  SectionTitle,
  StatCard,
  TableSkeleton,
} from "../components/ui";
import { useFeedback } from "../components/dialogs";
import { useAdmin } from "../context";
import {
  formatCents,
  formatDateTime,
  formatNumber,
  formatRelative,
} from "../format";
import { useAsync, useDebounced } from "../hooks";
import { errorMessage } from "../../lib/http";
import type { AdminUser, OnlineUser, TrendBucket, UserDetailPayload } from "../types";

export function UsersPage() {
  const feedback = useFeedback();
  const { canWrite } = useAdmin();
  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebounced(keyword, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const users = useAsync(
    () => getUsers(debouncedKeyword, page, pageSize),
    [debouncedKeyword, page, pageSize],
  );
  const growth = useAsync<TrendBucket[]>(() => getUsersGrowth(12), []);
  const online = useAsync(() => getOnlineUsers(), []);
  const logins = useAsync(() => getUserLogins(8), []);

  const rows = users.data?.items ?? [];
  const total = users.data?.total ?? 0;
  const newUsers = (growth.data ?? []).reduce(
    (sum, bucket) => sum + bucket.orderCount,
    0,
  );
  const onlineUsers = online.data?.items ?? [];
  const onlineWindow = online.data?.onlineWindowMinutes ?? 5;
  const loginTotal = logins.data?.total ?? 0;
  const recentLogins = logins.data?.recent ?? [];

  const changeKeyword = (value: string) => {
    setKeyword(value);
    setPage(1);
  };

  const handleForceLogout = async (user: OnlineUser) => {
    const confirmed = await feedback.confirm({
      title: "强制下线",
      description: `注销「${user.displayName}」的全部登录会话，需重新登录。`,
      confirmText: "强制下线",
      danger: true,
    });
    if (!confirmed) return;
    setBusyUserId(user.id);
    try {
      await forceLogoutUser(user.id);
      feedback.success(`已将「${user.displayName}」强制下线`);
      online.refresh();
      users.refresh();
    } catch (error) {
      feedback.error(errorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="用户管理"
        description="查看资料，处理冻结、重置绑卡。"
        actions={
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              users.refresh();
              growth.refresh();
              online.refresh();
              logins.refresh();
            }}
            disabled={users.loading || online.loading}
          >
            刷新
          </Button>
        }
      />

      <div className="admin-stack">
        <div className="admin-grid-main-aside">
          <Card title="近 12 个月新增用户">
            {growth.error ? (
              <ErrorState
                message={errorMessage(growth.error)}
                onRetry={() => growth.refresh()}
              />
            ) : growth.loading && !growth.data ? (
              <TableSkeleton rows={3} cols={4} />
            ) : (
              <BarChart
                points={(growth.data ?? []).map((bucket) => ({
                  key: bucket.key,
                  label: bucket.label,
                  value: bucket.orderCount,
                }))}
                valueFormat={formatNumber}
                emptyText="暂无新增用户数据"
                ariaLabel="近 12 个月新增用户"
              />
            )}
          </Card>

          <Card title="用户概况">
            <div
              className="admin-stat-grid"
              style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
            >
              <StatCard
                label="用户总数"
                value={formatNumber(total)}
                tone="primary"
              />
              <StatCard
                label="授权登录成功"
                value={formatNumber(loginTotal)}
                hint="成功登录过"
                tone="accent"
              />
              <StatCard
                label="近 12 个月新增"
                value={formatNumber(newUsers)}
                tone="accent"
              />
              <StatCard
                label="当前在线"
                value={formatNumber(onlineUsers.length)}
                hint={`近 ${onlineWindow} 分钟活跃`}
                tone="success"
              />
            </div>
          </Card>
        </div>

        <Card
          title="当前在线"
          subtitle={`近 ${onlineWindow} 分钟活跃用户，可强制下线`}
          extra={
            <div className="admin-flex" style={{ gap: 8, alignItems: "center" }}>
              <Badge tone={onlineUsers.length > 0 ? "success" : "neutral"}>
                {onlineUsers.length} 人在线
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                loading={online.loading}
                onClick={() => online.refresh()}
              >
                刷新
              </Button>
            </div>
          }
          flush
        >
          {online.error && !online.data ? (
            <div style={{ padding: 18 }}>
              <ErrorState
                message={errorMessage(online.error)}
                onRetry={() => online.refresh()}
              />
            </div>
          ) : online.loading && !online.data ? (
            <div style={{ padding: 18 }}>
              <TableSkeleton rows={3} cols={5} />
            </div>
          ) : onlineUsers.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState
                title="当前没有在线用户"
              />
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>学号</th>
                    <th>来源 IP</th>
                    <th>设备</th>
                    <th>最近活跃</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {onlineUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="admin-flex" style={{ gap: 10 }}>
                          <AdminAvatar name={user.displayName} avatarUrl={user.avatarUrl} />
                          <div>
                            <div className="admin-cell-primary">{user.displayName}</div>
                            <div className="admin-cell-sub admin-text-xs">
                              {user.isMerchant ? "商家" : "普通用户"}
                              {user.sessionCount > 1 ? ` · ${user.sessionCount} 个会话` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="admin-mono admin-text-sm">{user.studentNo || user.studentNoMasked || "—"}</td>
                      <td className="admin-mono admin-text-xs">{user.ip || "—"}</td>
                      <td className="admin-text-sm" title={user.userAgent ?? undefined}>
                        {describeAgent(user.userAgent)}
                      </td>
                      <td className="admin-text-sm admin-muted" title={formatDateTime(user.lastSeenAt)}>
                        {formatRelative(user.lastSeenAt)}
                      </td>
                      <td>
                        <div className="admin-cell-actions">
                          <Button
                            variant="danger-ghost"
                            size="sm"
                            disabled={!canWrite || busyUserId !== null}
                            loading={busyUserId === user.id}
                            onClick={() => void handleForceLogout(user)}
                          >
                            强制下线
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="最近用户登录"
          extra={
            <Button
              variant="ghost"
              size="sm"
              loading={logins.loading}
              onClick={() => logins.refresh()}
            >
              刷新
            </Button>
          }
          flush
        >
          {logins.error && !logins.data ? (
            <div style={{ padding: 18 }}>
              <ErrorState
                message={errorMessage(logins.error)}
                onRetry={() => logins.refresh()}
              />
            </div>
          ) : logins.loading && !logins.data ? (
            <div style={{ padding: 18 }}>
              <TableSkeleton rows={4} cols={3} />
            </div>
          ) : recentLogins.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState title="暂无登录记录" />
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>学号</th>
                    <th>最近登录</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLogins.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="admin-flex" style={{ gap: 10 }}>
                          <AdminAvatar name={user.displayName} avatarUrl={user.avatarUrl} />
                          <div>
                            <div className="admin-cell-primary">{user.displayName}</div>
                            <div className="admin-cell-sub admin-text-xs">
                              {user.isMerchant ? "商家" : "普通用户"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="admin-mono admin-text-sm">
                        {user.studentNo || user.studentNoMasked || "—"}
                      </td>
                      <td
                        className="admin-text-sm admin-muted"
                        title={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : undefined}
                      >
                        {user.lastLoginAt ? formatRelative(user.lastLoginAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="用户列表"
          extra={
            <div className="admin-flex" style={{ gap: 8 }}>
              <input
                className="admin-input admin-input-sm"
                style={{ width: 260 }}
                value={keyword}
                placeholder="搜索姓名 / 学号 / 邮箱"
                onChange={(event) => changeKeyword(event.target.value)}
                aria-label="搜索用户"
              />
              {keyword ? (
                <button
                  type="button"
                  className="admin-btn admin-btn-ghost admin-btn-sm"
                  onClick={() => changeKeyword("")}
                >
                  清空
                </button>
              ) : null}
            </div>
          }
          flush
        >
          {users.error && !users.data ? (
            <div style={{ padding: 18 }}>
              <ErrorState
                message={errorMessage(users.error)}
                onRetry={() => users.refresh()}
              />
            </div>
          ) : users.loading && !users.data ? (
            <div style={{ padding: 18 }}>
              <TableSkeleton rows={8} cols={7} />
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState
                title={debouncedKeyword ? "没有匹配的用户" : "暂无用户"}
                action={
                  debouncedKeyword ? (
                    <Button variant="subtle" size="sm" onClick={() => changeKeyword("")}>
                      清空搜索
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>学号</th>
                    <th>邮箱</th>
                    <th>状态</th>
                    <th className="admin-num">订单数</th>
                    <th className="admin-num">累计交易额</th>
                    <th>加入时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      onOpen={() => setDetailUserId(user.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > 0 ? (
            <div style={{ padding: "0 18px 16px" }}>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={(next) => {
                  setPageSize(next);
                  setPage(1);
                }}
                disabled={users.loading}
              />
            </div>
          ) : null}
        </Card>
      </div>

      {detailUserId ? (
        <UserDetailDrawer
          userId={detailUserId}
          onClose={() => setDetailUserId(null)}
          onChanged={() => users.refresh()}
        />
      ) : null}
    </>
  );
}

/** 把 User-Agent 归纳成「设备 · 浏览器」，列表里便于扫读。 */
function describeAgent(userAgent: string | null): string {
  if (!userAgent) return "—";
  const device = /iPhone|iPad|iPod/i.test(userAgent)
    ? "iOS"
    : /Android/i.test(userAgent)
      ? "Android"
      : /Windows/i.test(userAgent)
        ? "Windows"
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? "macOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "其它";
  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /Chrome\//i.test(userAgent)
      ? "Chrome"
      : /Firefox\//i.test(userAgent)
        ? "Firefox"
        : /Safari\//i.test(userAgent)
          ? "Safari"
          : "浏览器";
  return `${device} · ${browser}`;
}

function UserRow({ user, onOpen }: { user: AdminUser; onOpen: () => void }) {
  return (
    <tr>
      <td>
        <div className="admin-flex" style={{ gap: 10 }}>
          <AdminAvatar name={user.displayName} avatarUrl={user.avatarUrl} />
          <div>
            <div className="admin-cell-primary">{user.displayName}</div>
            <div className="admin-cell-sub admin-text-xs">
              {user.isMerchant ? "商家" : "普通用户"}
            </div>
          </div>
        </div>
      </td>
      <td className="admin-mono admin-text-sm">{user.studentNo || user.studentNoMasked || "—"}</td>
      <td className="admin-text-sm">{user.email || user.emailMasked || "—"}</td>
      <td>
        {user.frozen ? <Badge tone="danger">已冻结</Badge> : <Badge tone="success">正常</Badge>}
      </td>
      <td className="admin-num">{formatNumber(user.orderCount)}</td>
      <td className="admin-num">{formatCents(user.totalAmountCents)}</td>
      <td className="admin-text-sm admin-muted">
        {formatDateTime(user.createdAt)}
      </td>
      <td>
        <div className="admin-cell-actions">
          <Button variant="link" size="sm" onClick={onOpen}>
            详情
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------ 详情抽屉 */

interface UserDetailDrawerProps {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}

function UserDetailDrawer({ userId, onClose, onChanged }: UserDetailDrawerProps) {
  const feedback = useFeedback();
  const { canWrite } = useAdmin();
  const [busy, setBusy] = useState<string | null>(null);
  const detail = useAsync<UserDetailPayload>(
    () => getUserDetail(userId),
    [userId],
  );

  const runAction = async (
    action: "freeze" | "unfreeze" | "reset-card" | "force-logout",
    title: string,
    description: string,
    confirmText: string,
    danger: boolean,
  ) => {
    const confirmed = await feedback.confirm({
      title,
      description,
      confirmText,
      danger,
    });
    if (!confirmed) return;
    setBusy(action);
    try {
      switch (action) {
        case "freeze":
          await freezeUser(userId);
          feedback.success("已冻结该用户");
          break;
        case "unfreeze":
          await unfreezeUser(userId);
          feedback.success("已解冻该用户");
          break;
        case "reset-card":
          await resetUserCard(userId);
          feedback.success("已重置绑卡，用户需重新绑卡");
          break;
        case "force-logout":
          await forceLogoutUser(userId);
          feedback.success("已强制下线该用户");
          break;
      }
      detail.refresh();
      onChanged();
    } catch (error) {
      feedback.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const user = detail.data?.user;
  const frozen = user?.frozen ?? false;

  return (
    <Drawer
      title={user ? `${user.displayName} · 用户详情` : "用户详情"}
      subtitle={user ? `用户 ID：${user.id}` : undefined}
      onClose={onClose}
      footer={
        canWrite ? (
          <div className="admin-flex" style={{ gap: 8, flexWrap: "wrap" }}>
            {frozen ? (
              <Button
                variant="primary"
                size="sm"
                loading={busy === "unfreeze"}
                disabled={busy !== null}
                onClick={() =>
                  void runAction(
                    "unfreeze",
                    "解冻用户",
                    "解冻后可继续登录与交易。",
                    "解冻",
                    false,
                  )
                }
              >
                解冻账号
              </Button>
            ) : (
              <Button
                variant="danger"
                size="sm"
                loading={busy === "freeze"}
                disabled={busy !== null}
                onClick={() =>
                  void runAction(
                    "freeze",
                    "冻结用户",
                    "冻结后无法登录与交易；已进行的订单不受影响。",
                    "确认冻结",
                    true,
                  )
                }
              >
                冻结账号
              </Button>
            )}
            <Button
              variant="subtle"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void runAction(
                  "reset-card",
                  "重置绑卡",
                  "重置后需重新绑定校园卡才能支付。",
                  "重置绑卡",
                  false,
                )
              }
            >
              重置绑卡
            </Button>
            <Button
              variant="danger-ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void runAction(
                  "force-logout",
                  "强制下线",
                  "注销该用户全部登录会话。",
                  "强制下线",
                  true,
                )
              }
            >
              强制下线
            </Button>
          </div>
        ) : (
          <span className="admin-text-sm admin-muted">只读账号不可操作</span>
        )
      }
    >
      {detail.error && !detail.data ? (
        <ErrorState
          message={errorMessage(detail.error)}
          onRetry={() => detail.refresh()}
        />
      ) : detail.loading && !detail.data ? (
        <TableSkeleton rows={6} cols={3} />
      ) : user ? (
        <div className="admin-stack">
          {!canWrite ? (
            <InfoBanner tone="info">只读审计：不能冻结、重置绑卡。</InfoBanner>
          ) : null}
          {user.frozen ? (
            <InfoBanner tone="danger">
              该账号已被冻结
              {user.frozenReason ? `：${user.frozenReason}` : "（未填写原因）"}
            </InfoBanner>
          ) : null}

          <div className="admin-detail-banner">
            <div>
              <div className="admin-detail-amount">{user.displayName}</div>
              <div className="admin-detail-meta">
                <Badge tone={user.isMerchant ? "accent" : "neutral"}>
                  {user.isMerchant ? "商家" : "普通用户"}
                </Badge>
                {user.frozen ? <Badge tone="danger">已冻结</Badge> : <Badge tone="success">正常</Badge>}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="admin-text-xs admin-muted">加入时间</div>
              <div className="admin-strong">
                {formatDateTime(user.createdAt)}
              </div>
            </div>
          </div>

          <SectionTitle>基础资料</SectionTitle>
          <KVGrid
            items={[
              { label: "用户 ID", value: user.id, mono: true },
              { label: "学号", value: user.studentNo || user.studentNoMasked || "—", mono: true },
              { label: "邮箱", value: user.email || user.emailMasked || "—" },
              { label: "绑定卡", value: user.cardNo || user.cardNoMasked || "未绑定", mono: true },
              { label: "最近登录", value: formatDateTime(user.lastLoginAt) },
              { label: "最近登录（相对）", value: formatRelative(user.lastLoginAt) },
            ]}
          />

          <SectionTitle>交易概况</SectionTitle>
          <div className="admin-stat-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <StatCard
              label="订单数"
              value={formatNumber(detail.data?.orderCount ?? user.orderCount)}
              tone="primary"
            />
            <StatCard
              label="累计交易额"
              value={formatCents(detail.data?.totalAmountCents ?? user.totalAmountCents)}
              tone="accent"
            />
          </div>

          <SectionTitle>最近订单</SectionTitle>
          {(detail.data?.recentOrders.length ?? 0) === 0 ? (
            <EmptyState title="暂无订单" />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>订单号</th>
                    <th>标题</th>
                    <th className="admin-num">金额</th>
                    <th>状态</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.data?.recentOrders ?? []).map((order) => (
                    <tr key={order.id}>
                      <td className="admin-mono admin-text-xs">{order.orderNo}</td>
                      <td className="admin-cell-primary">{order.title}</td>
                      <td className="admin-num">{formatCents(order.amountCents)}</td>
                      <td>
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td className="admin-text-sm admin-muted">
                        {formatDateTime(order.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="未找到用户" description="该用户可能已被删除。" />
      )}
    </Drawer>
  );
}
