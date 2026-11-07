/**
 * 交易明细：全校订单筛选、分页、详情（时间线/双方/金额/渠道/备注）、CSV 导出与申诉处理。
 */
import { useState } from "react";
import {
  closeOrder,
  exportOrders,
  flagOrder,
  getAppeals,
  getOrderDetail,
  getOrders,
  handleAppeal,
} from "../api";
import {
  AppealStatusBadge,
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
  Tabs,
  TableSkeleton,
} from "../components/ui";
import { useFeedback } from "../components/dialogs";
import { useAdmin } from "../context";
import {
  formatCents,
  formatDateTime,
  formatRelative,
  fromDateInputEnd,
  fromDateInputStart,
  orderStatusLabel,
  parseYuanToCents,
  payChannelLabel,
} from "../format";
import { useAsync } from "../hooks";
import { useCopy, useContextMenus, type ContextMenuItem } from "../../components/ContextMenu";
import {
  CopyIcon,
  DownloadIcon,
  OpenIcon,
  RefreshIcon,
} from "../../components/ContextMenuIcons";
import { errorMessage } from "../../lib/http";
import type {
  AdminAppeal,
  AdminOrder,
  AdminOrderDetail,
  AppealStatus,
  OrderEvent,
  OrderFilters,
  OrderStatus,
} from "../types";

type TabKey = "orders" | "appeals";

interface FilterState {
  fromDate: string;
  toDate: string;
  status: OrderStatus | "all";
  minYuan: string;
  maxYuan: string;
  merchantId: string;
  payerId: string;
  keyword: string;
}

const EMPTY_FILTERS: FilterState = {
  fromDate: "",
  toDate: "",
  status: "all",
  minYuan: "",
  maxYuan: "",
  merchantId: "",
  payerId: "",
  keyword: "",
};

const ORDER_STATUS_OPTIONS: Array<{ value: OrderStatus | "all"; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "pending_payment", label: "待付款" },
  { value: "paid", label: "已支付" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

function toOrderFilters(state: FilterState): OrderFilters {
  return {
    from: fromDateInputStart(state.fromDate),
    to: fromDateInputEnd(state.toDate),
    status: state.status,
    minAmount:
      state.minYuan.trim() !== ""
        ? (parseYuanToCents(state.minYuan) ?? undefined)
        : undefined,
    maxAmount:
      state.maxYuan.trim() !== ""
        ? (parseYuanToCents(state.maxYuan) ?? undefined)
        : undefined,
    merchantId: state.merchantId.trim() || undefined,
    payerId: state.payerId.trim() || undefined,
    query: state.keyword.trim() || undefined,
  };
}

export function OrdersPage() {
  const [tab, setTab] = useState<TabKey>("orders");
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [listRefreshToken, setListRefreshToken] = useState(0);

  return (
    <>
      <PageHeader
        title="交易明细"
        description="订单流水、筛选导出与申诉处理。"
      />

      <Tabs
        items={[
          { key: "orders", label: "订单列表" },
          { key: "appeals", label: "申诉处理" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ marginTop: 16 }}>
        {tab === "orders" ? (
          <OrdersTab
            refreshToken={listRefreshToken}
            onOpenDetail={setDetailOrderId}
            onChanged={() => setListRefreshToken((value) => value + 1)}
          />
        ) : (
          <AppealsTab
            refreshToken={listRefreshToken}
            onOpenDetail={setDetailOrderId}
            onChanged={() => setListRefreshToken((value) => value + 1)}
          />
        )}
      </div>

      {detailOrderId ? (
        <OrderDetailDrawer
          orderId={detailOrderId}
          onClose={() => setDetailOrderId(null)}
          onChanged={() => {
            setDetailOrderId(null);
            setListRefreshToken((value) => value + 1);
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ 订单列表 */

function OrdersTab({
  refreshToken,
  onOpenDetail,
  onChanged,
}: {
  refreshToken: number;
  onOpenDetail: (orderId: string) => void;
  onChanged: () => void;
}) {
  const feedback = useFeedback();
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [exporting, setExporting] = useState(false);

  const orders = useAsync(
    () => getOrders(toOrderFilters(applied), page, pageSize),
    [applied, page, pageSize, refreshToken],
  );

  const rows = orders.data?.items ?? [];
  const total = orders.data?.total ?? 0;

  const update = (patch: Partial<FilterState>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const apply = () => {
    setApplied(draft);
    setPage(1);
  };

  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      await exportOrders(toOrderFilters(applied));
      feedback.success("订单数据已开始下载");
    } catch (error) {
      feedback.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const copy = useCopy();

  // 右键 / 长按菜单：行操作按钮、导出按钮
  useContextMenus({
    "admin.orders.row": (element) => {
      const order = rows.find((item) => item.id === element.dataset.menuId);
      if (!order) return null;
      const items: ContextMenuItem[] = [
        {
          label: "打开订单详情",
          icon: <OpenIcon />,
          onSelect: () => onOpenDetail(order.id),
        },
        { type: "separator" },
        {
          label: "复制订单号",
          icon: <CopyIcon />,
          onSelect: () => void copy(order.orderNo, "订单号"),
        },
        {
          label: "复制用户 ID",
          icon: <CopyIcon />,
          hint: order.payerUserId ? "付款人" : "无",
          disabled: !order.payerUserId,
          onSelect: () => void copy(order.payerUserId ?? "", "用户 ID"),
        },
        {
          label: "复制金额",
          icon: <CopyIcon />,
          onSelect: () => void copy(formatCents(order.amountCents), "金额"),
        },
      ];
      return items;
    },
    "admin.orders.export": () => [
      {
        label: "导出 CSV",
        icon: <DownloadIcon />,
        hint: "Excel 可打开",
        disabled: exporting,
        onSelect: () => void exportCsv(),
      },
      {
        label: "刷新列表",
        icon: <RefreshIcon />,
        onSelect: () => orders.refresh(),
      },
    ],
  });

  return (
    <div className="admin-stack">
      <Card title="筛选条件" subtitle="按本地时区，金额单位元">
        <div className="admin-form-grid">
          <Field label="开始日期">
            <input
              type="date"
              className="admin-input"
              value={draft.fromDate}
              onChange={(event) => update({ fromDate: event.target.value })}
            />
          </Field>
          <Field label="结束日期">
            <input
              type="date"
              className="admin-input"
              value={draft.toDate}
              onChange={(event) => update({ toDate: event.target.value })}
            />
          </Field>
          <Field label="订单状态">
            <select
              className="admin-select"
              value={draft.status}
              onChange={(event) =>
                update({ status: event.target.value as OrderStatus | "all" })
              }
            >
              {ORDER_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="关键词">
            <input
              className="admin-input"
              value={draft.keyword}
              placeholder="订单号 / 标题 / 备注"
              onChange={(event) => update({ keyword: event.target.value })}
            />
          </Field>
          <Field label="最小金额（元）">
            <input
              className="admin-input"
              value={draft.minYuan}
              inputMode="decimal"
              placeholder="0.00"
              onChange={(event) => update({ minYuan: event.target.value })}
            />
          </Field>
          <Field label="最大金额（元）">
            <input
              className="admin-input"
              value={draft.maxYuan}
              inputMode="decimal"
              placeholder="不限"
              onChange={(event) => update({ maxYuan: event.target.value })}
            />
          </Field>
          <Field label="商家用户 ID">
            <input
              className="admin-input"
              value={draft.merchantId}
              placeholder="商家用户 ID"
              onChange={(event) => update({ merchantId: event.target.value })}
            />
          </Field>
          <Field label="付款人用户 ID">
            <input
              className="admin-input"
              value={draft.payerId}
              placeholder="付款人用户 ID"
              onChange={(event) => update({ payerId: event.target.value })}
            />
          </Field>
        </div>

        <div className="admin-flex admin-flex-wrap" style={{ gap: 8, marginTop: 14 }}>
          <Button variant="primary" size="sm" onClick={apply}>
            查询
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>
            重置筛选
          </Button>
          <span className="admin-spacer" />
          <span
            data-menu="admin.orders.export"
            style={{ display: "inline-flex" }}
          >
            <Button
              variant="subtle"
              size="sm"
              loading={exporting}
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              导出 CSV
            </Button>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => orders.refresh()}
            disabled={orders.loading}
          >
            刷新
          </Button>
        </div>
      </Card>

      <Card
        title="订单列表"
        subtitle={`共 ${total} 条${orders.data ? ` · 第 ${orders.data.page} 页` : ""}`}
        flush
      >
        {orders.error && !orders.data ? (
          <div style={{ padding: 18 }}>
            <ErrorState
              message={errorMessage(orders.error)}
              onRetry={() => orders.refresh()}
            />
          </div>
        ) : orders.loading && !orders.data ? (
          <div style={{ padding: 18 }}>
            <TableSkeleton rows={8} cols={8} />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState
              title="没有符合条件的订单"
              description="换个条件试试。"
              action={
                <Button variant="subtle" size="sm" onClick={reset}>
                  清空筛选
                </Button>
              }
            />
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>订单号 / 标题</th>
                  <th className="admin-num">金额</th>
                  <th>状态</th>
                  <th>商家</th>
                  <th>付款人</th>
                  <th>渠道</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <div className="admin-cell-primary">{order.title}</div>
                      <div className="admin-cell-sub admin-mono admin-text-xs">
                        {order.orderNo}
                      </div>
                    </td>
                    <td className="admin-num admin-strong">
                      {formatCents(order.amountCents)}
                    </td>
                    <td>
                      <div className="admin-flex admin-flex-wrap" style={{ gap: 4 }}>
                        <OrderStatusBadge status={order.status} />
                        {order.hasAppeal ? <Badge tone="warning">有申诉</Badge> : null}
                        {order.flagged ? <Badge tone="danger">异常</Badge> : null}
                      </div>
                    </td>
                    <td className="admin-text-sm">{order.merchantName}</td>
                    <td className="admin-text-sm">{order.payerName}</td>
                    <td className="admin-text-sm">
                      {payChannelLabel(order.payChannel)}
                    </td>
                    <td className="admin-text-sm admin-muted">
                      {formatDateTime(order.createdAt)}
                    </td>
                    <td>
                      <div
                        className="admin-cell-actions"
                        data-menu="admin.orders.row"
                        data-menu-id={order.id}
                      >
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => onOpenDetail(order.id)}
                        >
                          详情
                        </Button>
                      </div>
                    </td>
                  </tr>
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
              disabled={orders.loading}
            />
          </div>
        ) : null}
      </Card>

      <div className="admin-text-xs admin-muted">
        导出与申诉处理会记入操作日志。
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 申诉处理 */

const APPEAL_STATUS_OPTIONS: Array<{ value: AppealStatus | "all"; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "pending", label: "待处理" },
  { value: "resolved", label: "已解决" },
  { value: "rejected", label: "已驳回" },
];

function AppealsTab({
  refreshToken,
  onOpenDetail,
  onChanged,
}: {
  refreshToken: number;
  onOpenDetail: (orderId: string) => void;
  onChanged: () => void;
}) {
  const feedback = useFeedback();
  const { canWrite } = useAdmin();
  const [status, setStatus] = useState<AppealStatus | "all">("pending");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [busyId, setBusyId] = useState<string | null>(null);

  const appeals = useAsync(
    () => getAppeals(status, page, pageSize),
    [status, page, pageSize, refreshToken],
  );

  const rows = appeals.data?.items ?? [];
  const total = appeals.data?.total ?? 0;

  const handle = async (appeal: AdminAppeal, next: "resolved" | "rejected") => {
    const note = await feedback.prompt({
      title: next === "resolved" ? "标记申诉已解决" : "驳回申诉",
      description: `订单 ${appeal.orderNo || appeal.orderId} · ${appeal.reason}`,
      label: "处理说明",
      placeholder:
        next === "resolved"
          ? "例如：已与商家协商退款"
          : "例如：申诉理由不成立",
      multiline: true,
      required: true,
      confirmText: next === "resolved" ? "确认已解决" : "确认驳回",
      danger: next === "rejected",
    });
    if (note === null) return;
    const trimmed = note.trim();
    if (!trimmed) {
      feedback.warning("请填写处理说明");
      return;
    }
    setBusyId(appeal.id);
    try {
      await handleAppeal(appeal.id, next, trimmed);
      feedback.success("申诉已处理");
      appeals.refresh();
      onChanged();
    } catch (error) {
      feedback.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card
      title="申诉处理"
      subtitle="处理需填说明，结果对用户可见"
      extra={
        <select
          className="admin-select"
          style={{ width: 160 }}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as AppealStatus | "all");
            setPage(1);
          }}
          aria-label="申诉状态筛选"
        >
          {APPEAL_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      }
      flush
    >
      {appeals.error && !appeals.data ? (
        <div style={{ padding: 18 }}>
          <ErrorState
            message={errorMessage(appeals.error)}
            onRetry={() => appeals.refresh()}
          />
        </div>
      ) : appeals.loading && !appeals.data ? (
        <div style={{ padding: 18 }}>
          <TableSkeleton rows={6} cols={7} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 18 }}>
          <EmptyState
            title={status === "pending" ? "没有待处理的申诉" : "暂无申诉记录"}
          />
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>订单</th>
                <th className="admin-num">金额</th>
                <th>商家 / 付款人</th>
                <th>申诉原因</th>
                <th>状态</th>
                <th>提交时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((appeal) => (
                <tr key={appeal.id}>
                  <td className="admin-mono admin-text-xs">
                    {appeal.orderNo || appeal.orderId}
                  </td>
                  <td className="admin-num">{formatCents(appeal.amountCents)}</td>
                  <td className="admin-text-sm">
                    <div>{appeal.merchantName || "—"}</div>
                    <div className="admin-muted">{appeal.payerName || "—"}</div>
                  </td>
                  <td className="admin-text-sm" style={{ maxWidth: 280 }}>
                    <div>{appeal.reason || "—"}</div>
                    {appeal.handledNote ? (
                      <div className="admin-muted">处理说明：{appeal.handledNote}</div>
                    ) : null}
                  </td>
                  <td>
                    <AppealStatusBadge status={appeal.status} />
                  </td>
                  <td className="admin-text-sm admin-muted">
                    {formatDateTime(appeal.createdAt)}
                  </td>
                  <td>
                    <div className="admin-cell-actions">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => onOpenDetail(appeal.orderId)}
                      >
                        查看订单
                      </Button>
                      {appeal.status === "pending" && canWrite ? (
                        <>
                          <Button
                            variant="link"
                            size="sm"
                            loading={busyId === appeal.id}
                            disabled={busyId !== null}
                            onClick={() => void handle(appeal, "resolved")}
                          >
                            已解决
                          </Button>
                          <Button
                            variant="danger-ghost"
                            size="sm"
                            disabled={busyId !== null}
                            onClick={() => void handle(appeal, "rejected")}
                          >
                            驳回
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
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
            disabled={appeals.loading}
          />
        </div>
      ) : null}

      {!canWrite ? (
        <div style={{ padding: "0 18px 16px" }}>
          <InfoBanner tone="info">
            当前角色只读，不能处理申诉。
          </InfoBanner>
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ 订单详情 */

function OrderDetailDrawer({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const feedback = useFeedback();
  const { canWrite } = useAdmin();
  const [busy, setBusy] = useState<string | null>(null);
  const detail = useAsync<AdminOrderDetail>(
    () => getOrderDetail(orderId),
    [orderId],
  );

  const order = detail.data;

  const run = async (
    action: "close" | "flag" | "appeal-resolved" | "appeal-rejected",
    options: {
      title: string;
      description?: string;
      label: string;
      placeholder: string;
      confirmText: string;
      danger: boolean;
    },
  ) => {
    const note = await feedback.prompt({
      title: options.title,
      description: options.description,
      label: options.label,
      placeholder: options.placeholder,
      multiline: true,
      required: true,
      confirmText: options.confirmText,
      danger: options.danger,
    });
    if (note === null) return;
    const trimmed = note.trim();
    if (!trimmed) {
      feedback.warning("请填写说明");
      return;
    }
    setBusy(action);
    try {
      if (action === "close") {
        await closeOrder(orderId, trimmed);
        feedback.success("订单已关闭");
      } else if (action === "flag") {
        await flagOrder(orderId, trimmed);
        feedback.success("订单已标记异常");
      } else if (order?.appeal) {
        await handleAppeal(
          order.appeal.id,
          action === "appeal-resolved" ? "resolved" : "rejected",
          trimmed,
        );
        feedback.success("申诉已处理");
      }
      detail.refresh();
      onChanged();
    } catch (error) {
      feedback.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer
      title={order ? `订单详情 · ${order.orderNo}` : "订单详情"}
      subtitle={order ? order.title : undefined}
      onClose={onClose}
      footer={
        canWrite && order ? (
          <div className="admin-flex admin-flex-wrap" style={{ gap: 8 }}>
            {order.status !== "completed" && order.status !== "cancelled" ? (
              <Button
                variant="danger"
                size="sm"
                loading={busy === "close"}
                disabled={busy !== null}
                onClick={() =>
                  void run("close", {
                    title: "关闭订单",
                    description: `关闭后不可恢复，未支付订单无法再支付。`,
                    label: "关闭原因",
                    placeholder: "例如：用户申诉，双方协商关闭",
                    confirmText: "确认关闭",
                    danger: true,
                  })
                }
              >
                关闭订单
              </Button>
            ) : null}
            <Button
              variant="danger-ghost"
              size="sm"
              loading={busy === "flag"}
              disabled={busy !== null}
              onClick={() =>
                void run("flag", {
                  title: "标记异常",
                  description: "标记后进入风控关注列表。",
                  label: "异常说明",
                  placeholder: "例如：金额异常、疑似刷单",
                  confirmText: "确认标记",
                  danger: true,
                })
              }
            >
              标记异常
            </Button>
          </div>
        ) : (
          <span className="admin-text-sm admin-muted">
            {canWrite ? "—" : "只读账号不可操作"}
          </span>
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
      ) : order ? (
        <div className="admin-stack">
          {!canWrite ? (
            <InfoBanner tone="info">
              只读审计：不能处理申诉或关闭订单。
            </InfoBanner>
          ) : null}
          {order.flagged ? (
            <InfoBanner tone="danger">
              该订单已被标记异常{order.flagReason ? `：${order.flagReason}` : ""}
            </InfoBanner>
          ) : null}
          {order.cancelReason ? (
            <InfoBanner tone="warning">
              取消原因：{order.cancelReason}
            </InfoBanner>
          ) : null}

          <div className="admin-detail-banner">
            <div>
              <div className="admin-detail-amount">{formatCents(order.amountCents)}</div>
              <div className="admin-detail-meta">
                <OrderStatusBadge status={order.status} />
                <Badge tone="neutral">{payChannelLabel(order.payChannel)}</Badge>
                {order.hasAppeal ? <Badge tone="warning">有申诉</Badge> : null}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="admin-text-xs admin-muted">创建时间</div>
              <div className="admin-strong">{formatDateTime(order.createdAt)}</div>
              <div className="admin-text-xs admin-muted">
                {formatRelative(order.createdAt)}
              </div>
            </div>
          </div>

          <SectionTitle>订单信息</SectionTitle>
          <KVGrid
            items={[
              { label: "订单号", value: order.orderNo, mono: true },
              { label: "标题", value: order.title },
              { label: "金额", value: formatCents(order.amountCents) },
              { label: "状态", value: orderStatusLabel(order.status) },
              { label: "支付渠道", value: payChannelLabel(order.payChannel) },
              { label: "创建时间", value: formatDateTime(order.createdAt) },
              { label: "支付时间", value: formatDateTime(order.paidAt) },
              { label: "完成时间", value: formatDateTime(order.completedAt) },
              { label: "取消时间", value: formatDateTime(order.cancelledAt) },
              { label: "预留备注", value: order.reservedNote || "—" },
              { label: "实际备注", value: order.actualNote || "—" },
              { label: "订单 ID", value: order.id, mono: true },
            ]}
          />

          <SectionTitle>交易双方</SectionTitle>
          <KVGrid
            items={[
              {
                label: "商家",
                value: `${order.merchantName}${
                  order.merchantUserId ? `（${order.merchantUserId}）` : ""
                }`,
              },
              {
                label: "付款人",
                value: `${order.payerName}${
                  order.payerUserId ? `（${order.payerUserId}）` : ""
                }`,
              },
            ]}
          />

          <SectionTitle>订单时间线</SectionTitle>
          {order.events.length === 0 ? (
            <EmptyState title="暂无时间线记录" />
          ) : (
            <div className="admin-timeline">
              {order.events.map((event) => (
                <TimelineItem key={event.id} event={event} />
              ))}
            </div>
          )}

          {order.appeal ? (
            <>
              <SectionTitle>申诉信息</SectionTitle>
              <div className="admin-card">
                <div className="admin-card-body">
                  <div className="admin-flex admin-flex-wrap" style={{ gap: 8 }}>
                    <AppealStatusBadge status={order.appeal.status} />
                    <span className="admin-text-sm admin-muted">
                      提交于 {formatDateTime(order.appeal.createdAt)}
                    </span>
                  </div>
                  <p className="admin-text-sm" style={{ marginTop: 8 }}>
                    {order.appeal.reason || "（未填写申诉原因）"}
                  </p>
                  {order.appeal.handledNote ? (
                    <p className="admin-text-sm admin-muted" style={{ marginTop: 6 }}>
                      处理说明：{order.appeal.handledNote}
                    </p>
                  ) : null}
                  {order.appeal.status === "pending" && canWrite ? (
                    <div
                      className="admin-flex admin-flex-wrap"
                      style={{ gap: 8, marginTop: 12 }}
                    >
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy === "appeal-resolved"}
                        disabled={busy !== null}
                        onClick={() =>
                          void run("appeal-resolved", {
                            title: "标记申诉已解决",
                            description: order.appeal?.reason,
                            label: "处理说明",
                            placeholder: "例如：已协调商家退款",
                            confirmText: "确认已解决",
                            danger: false,
                          })
                        }
                      >
                        标记已解决
                      </Button>
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() =>
                          void run("appeal-rejected", {
                            title: "驳回申诉",
                            description: order.appeal?.reason,
                            label: "驳回说明",
                            placeholder: "例如：申诉理由不成立",
                            confirmText: "确认驳回",
                            danger: true,
                          })
                        }
                      >
                        驳回申诉
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <EmptyState title="未找到订单" />
      )}
    </Drawer>
  );
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  created: "创建订单",
  created_order: "创建订单",
  paid: "支付成功",
  completed: "确认完成",
  confirmed: "确认完成",
  cancelled: "订单取消",
  canceled: "订单取消",
  closed: "关闭订单",
  appeal: "发起申诉",
  appealed: "发起申诉",
  flagged: "标记异常",
  refunded: "退款",
};

const ACTOR_ROLE_LABELS: Record<string, string> = {
  payer: "付款人",
  merchant: "商家",
  admin: "管理员",
  system: "系统",
  ops: "运营",
};

function TimelineItem({ event }: { event: OrderEvent }) {
  return (
    <div className="admin-timeline-item">
      <span className="admin-timeline-dot" aria-hidden="true" />
      <div className="admin-timeline-head">
        <span className="admin-timeline-title">
          {EVENT_TYPE_LABELS[event.type] ?? event.type}
        </span>
        <span className="admin-timeline-time">
          {formatDateTime(event.createdAt)}
        </span>
      </div>
      <div className="admin-timeline-detail">
        {ACTOR_ROLE_LABELS[event.actorRole] ?? event.actorRole}
        {event.detail ? ` · ${event.detail}` : ""}
      </div>
    </div>
  );
}
