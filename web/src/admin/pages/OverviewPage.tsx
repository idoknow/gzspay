/**
 * 总览：核心指标卡片 + 近 12 个月交易趋势 + 最近订单 + 待处理事项。
 */
import { Link } from "react-router-dom";
import { getOverview } from "../api";
import { DualAxisTrendChart } from "../components/charts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  OrderStatusBadge,
  PageHeader,
  SkeletonCards,
  StatCard,
  TableSkeleton,
} from "../components/ui";
import {
  formatCents,
  formatDateTime,
  formatNumber,
  orderStatusLabel,
  payChannelLabel,
} from "../format";
import { useAsync } from "../hooks";
import { errorMessage } from "../../lib/http";
import type { Overview, TodoItem } from "../types";

export function OverviewPage() {
  const { data, loading, error, refresh } = useAsync<Overview>(
    () => getOverview(),
    [],
  );

  return (
    <>
      <PageHeader
        title="总览"
        description="全校交易与运营概况，数据由后台实时汇总。"
        actions={
          <Button
            variant="subtle"
            size="sm"
            onClick={() => refresh()}
            disabled={loading}
          >
            刷新
          </Button>
        }
      />

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refresh()} />
      ) : loading && !data ? (
        <>
          <SkeletonCards count={5} />
          <div className="admin-card" style={{ marginTop: 18 }}>
            <TableSkeleton rows={5} cols={5} />
          </div>
        </>
      ) : data ? (
        <div className="admin-stack">
          <div className="admin-stat-grid">
            <StatCard
              label="全校总交易额"
              value={formatCents(data.totalAmountCents)}
              hint="已支付及已完成订单累计"
              tone="primary"
            />
            <StatCard
              label="本月交易额"
              value={formatCents(data.monthAmountCents)}
              hint="本月 1 日 00:00 起"
              tone="accent"
            />
            <StatCard
              label="今日订单数"
              value={formatNumber(data.todayOrderCount)}
              hint="今日 00:00 起创建"
              tone="success"
            />
            <StatCard
              label="用户数"
              value={formatNumber(data.userCount)}
              hint="校园墙注册用户"
              tone="primary"
            />
            <StatCard
              label="商家数"
              value={formatNumber(data.merchantCount)}
              hint="已开通收款资格"
              tone="accent"
            />
          </div>

          <div className="admin-grid-main-aside">
            <Card
              title="近 12 个月交易趋势"
              subtitle="柱状为交易额，折线为订单数"
              extra={
                <Link className="admin-btn admin-btn-link admin-btn-sm" to="/admin/monthly">
                  查看每月交易额
                </Link>
              }
            >
              <DualAxisTrendChart
                points={data.trend.map((bucket) => ({
                  key: bucket.key,
                  label: bucket.label,
                  value: bucket.amountCents,
                  secondary: bucket.orderCount,
                }))}
                emptyText="暂无交易数据"
              />
            </Card>

            <Card
              title="待处理事项"
              subtitle="需要关注的运营与风控提醒"
              extra={<Badge tone="warning">{data.todos.length} 项</Badge>}
            >
              {data.todos.length === 0 ? (
                <EmptyState title="没有待处理事项" description="当前运营状态良好。" />
              ) : (
                <div className="admin-stack">
                  {data.todos.map((todo) => (
                    <TodoRow key={todo.id} todo={todo} />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card
            title="最近订单"
            subtitle="最新创建的全校订单"
            extra={
              <Link className="admin-btn admin-btn-link admin-btn-sm" to="/admin/orders">
                查看全部交易
              </Link>
            }
            flush
          >
            {data.recentOrders.length === 0 ? (
              <EmptyState title="暂无订单" description="还没有产生交易记录。" />
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>订单号</th>
                      <th>标题</th>
                      <th className="admin-num">金额</th>
                      <th>状态</th>
                      <th>商家</th>
                      <th>付款人</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td className="admin-mono admin-text-xs">{order.orderNo}</td>
                        <td className="admin-cell-primary">{order.title}</td>
                        <td className="admin-num admin-strong">
                          {formatCents(order.amountCents)}
                        </td>
                        <td>
                          <OrderStatusBadge status={order.status} />
                        </td>
                        <td>{order.merchantName}</td>
                        <td>{order.payerName}</td>
                        <td className="admin-text-sm admin-muted">
                          {formatDateTime(order.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="admin-text-xs admin-muted">
            最后更新：{formatDateTime(new Date().toISOString())} · 数据为查询时快照。
          </div>
        </div>
      ) : (
        <EmptyState title="暂无总览数据" description="后台尚未产生可统计的数据。" />
      )}
    </>
  );
}

function TodoRow({ todo }: { todo: TodoItem }) {
  return (
    <div
      className="admin-flex"
      style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}
    >
      <div>
        <div className="admin-strong">{todo.title}</div>
        {todo.detail ? (
          <div className="admin-text-sm admin-muted" style={{ marginTop: 2 }}>
            {todo.detail}
          </div>
        ) : null}
      </div>
      <Badge tone={todo.level}>{todo.level === "danger" ? "紧急" : "提醒"}</Badge>
    </div>
  );
}
