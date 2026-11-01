/**
 * 数据统计：交易额与订单数趋势、金额区间分布、交易时段分布、商家排行、
 * 支付方式占比、订单转化漏斗与平均确认时长。
 * 图表支持点击图例隐藏/显示系列、点击柱子 / 折线点 / 环形扇区查看该点明细。
 */
import { useMemo, useState } from "react";
import { getStats } from "../api";
import {
  AmountDistributionChart,
  DonutChart,
  DualAxisTrendChart,
  FunnelBars,
  HourlyChart,
} from "../components/charts";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionTitle,
  SkeletonCards,
  StatCard,
  TableSkeleton,
} from "../components/ui";
import {
  formatCents,
  formatCentsCompact,
  formatDuration,
  formatNumber,
  formatPercent,
} from "../format";
import { useAsync } from "../hooks";
import { errorMessage } from "../../lib/http";
import type { AdminStats } from "../types";

export function StatsPage() {
  const { data, loading, error, refresh } = useAsync<AdminStats>(
    () => getStats(),
    [],
  );
  /** 趋势图选中的时间点 */
  const [trendKey, setTrendKey] = useState<string | null>(null);
  /** 金额区间图选中的区间 */
  const [amountKey, setAmountKey] = useState<string | null>(null);
  /** 时段图选中的小时 */
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  /** 支付方式环形图选中的扇区下标 */
  const [paymentIndex, setPaymentIndex] = useState<number | null>(null);
  /** 订单状态环形图选中的扇区下标 */
  const [statusIndex, setStatusIndex] = useState<number | null>(null);

  const maxMerchantAmount = useMemo(
    () =>
      Math.max(
        1,
        ...(data?.merchantRanking ?? []).map((merchant) => merchant.amountCents),
      ),
    [data],
  );

  const paymentTotal = useMemo(
    () =>
      (data?.paymentMethods ?? []).reduce(
        (sum, method) => sum + method.count,
        0,
      ),
    [data],
  );

  const selectedPayment =
    paymentIndex !== null && data?.paymentMethods[paymentIndex]
      ? data.paymentMethods[paymentIndex]
      : null;

  const statusCounts = data?.statusCounts ?? [];

  const statusTotal = useMemo(
    () => statusCounts.reduce((sum, item) => sum + item.count, 0),
    [statusCounts],
  );

  const selectedStatus =
    statusIndex !== null && statusCounts[statusIndex]
      ? statusCounts[statusIndex]
      : null;

  return (
    <>
      <PageHeader
        title="数据统计"
        description="全校交易趋势、商家表现、支付方式与订单转化分析。"
        actions={
          <button
            type="button"
            className="admin-btn admin-btn-subtle admin-btn-sm"
            onClick={() => refresh()}
            disabled={loading}
          >
            刷新
          </button>
        }
      />

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refresh()} />
      ) : loading && !data ? (
        <>
          <SkeletonCards count={3} />
          <div className="admin-card" style={{ marginTop: 18 }}>
            <TableSkeleton rows={6} cols={4} />
          </div>
        </>
      ) : data ? (
        <div className="admin-stack">
          <StatsSummary stats={data} />

          <Card
            title="交易额与订单数趋势"
            subtitle="柱状为交易额，折线为订单数；点击图例可隐藏系列，点击柱子或圆点查看该点明细"
          >
            <DualAxisTrendChart
              points={data.trend.map((bucket) => ({
                key: bucket.key,
                label: bucket.label,
                value: bucket.amountCents,
                secondary: bucket.orderCount,
              }))}
              onSelect={(point) => setTrendKey(point.key)}
              selectedKey={trendKey}
              onClearSelect={() => setTrendKey(null)}
              emptyText="暂无趋势数据"
            />
          </Card>

          <div className="admin-grid-3">
            <Card
              title="金额区间分布"
              subtitle="按成交订单金额分档汇总，点击区间查看单数与金额"
            >
              <AmountDistributionChart
                items={data.amountDistribution ?? []}
                onSelect={(item) => setAmountKey(item.key)}
                selectedKey={amountKey}
                onClearSelect={() => setAmountKey(null)}
              />
            </Card>

            <Card
              title="交易时段分布"
              subtitle="按小时汇总交易额，点击柱体查看该时段明细"
            >
              <HourlyChart
                items={data.hourly ?? []}
                onSelect={(item) => setSelectedHour(item.hour)}
                selectedHour={selectedHour}
                onClearSelect={() => setSelectedHour(null)}
              />
            </Card>

            <Card
              title="订单状态分布"
              subtitle="按订单状态统计；点击扇区或图例查看、隐藏状态"
            >
              {statusCounts.length === 0 || statusTotal === 0 ? (
                <EmptyState
                  title="暂无状态数据"
                  description="还没有产生订单记录。"
                />
              ) : (
                <div className="admin-donut-wrap">
                  {selectedStatus ? (
                    <SelectedDetail
                      title={`已选：${selectedStatus.label || selectedStatus.status}`}
                      rows={[
                        {
                          label: "订单数",
                          value: `${formatNumber(selectedStatus.count)} 单`,
                        },
                        {
                          label: "占比",
                          value:
                            statusTotal > 0
                              ? formatPercent(
                                  (selectedStatus.count / statusTotal) * 100,
                                )
                              : "—",
                        },
                      ]}
                      onClose={() => setStatusIndex(null)}
                    />
                  ) : null}
                  <DonutChart
                    slices={statusCounts.map((item) => ({
                      label: item.label || item.status,
                      value: item.count,
                      hint: `${formatNumber(item.count)} 单`,
                    }))}
                    centerLabel="订单总数"
                    centerValue={formatNumber(statusTotal)}
                    onSelect={(_slice, index) => setStatusIndex(index)}
                    selectedIndex={statusIndex}
                    emptyText="暂无状态数据"
                  />
                </div>
              )}
            </Card>
          </div>

          <div className="admin-grid-2">
            <Card
              title="商家排行"
              subtitle="按交易额降序，最多展示前 10 名"
              extra={
                <Badge tone="neutral">
                  {(data.merchantRanking ?? []).length} 家
                </Badge>
              }
            >
              {(data.merchantRanking ?? []).length === 0 ? (
                <EmptyState title="暂无商家数据" description="还没有商家产生交易。" />
              ) : (
                <div className="admin-stack">
                  {data.merchantRanking.slice(0, 10).map((merchant, index) => (
                    <div className="admin-rank-row" key={merchant.id}>
                      <div className="admin-rank-index">{index + 1}</div>
                      <div className="admin-rank-main">
                        <div className="admin-flex" style={{ justifyContent: "space-between", gap: 8 }}>
                          <span className="admin-rank-name">{merchant.name}</span>
                          <span className="admin-rank-meta">
                            {formatNumber(merchant.orderCount)} 单
                          </span>
                        </div>
                        <div className="admin-rank-bar">
                          <span
                            style={{
                              width: `${Math.max(
                                2,
                                (merchant.amountCents / maxMerchantAmount) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="admin-rank-amount">
                        {formatCentsCompact(merchant.amountCents)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="支付方式占比"
              subtitle="按订单数统计；点击扇区或图例查看、隐藏支付方式"
            >
              {(data.paymentMethods ?? []).length === 0 ? (
                <EmptyState title="暂无支付数据" description="还没有已支付订单。" />
              ) : (
                <div className="admin-donut-wrap">
                  {selectedPayment ? (
                    <SelectedDetail
                      title={`已选：${selectedPayment.label || selectedPayment.method}`}
                      rows={[
                        {
                          label: "订单数",
                          value: `${formatNumber(selectedPayment.count)} 单`,
                        },
                        {
                          label: "交易额",
                          value: formatCents(selectedPayment.amountCents),
                        },
                        {
                          label: "占比",
                          value:
                            paymentTotal > 0
                              ? formatPercent(
                                  (selectedPayment.count / paymentTotal) * 100,
                                )
                              : "—",
                        },
                      ]}
                      onClose={() => setPaymentIndex(null)}
                    />
                  ) : null}
                  <DonutChart
                    slices={data.paymentMethods.map((method) => ({
                      label: method.label || method.method,
                      value: method.count,
                      hint: `${formatNumber(method.count)} 单 · ${formatCents(method.amountCents)}`,
                    }))}
                    centerLabel="支付订单"
                    centerValue={formatNumber(paymentTotal)}
                    onSelect={(_slice, index) => setPaymentIndex(index)}
                    selectedIndex={paymentIndex}
                  />
                </div>
              )}
            </Card>
          </div>

          <Card
            title="订单转化漏斗"
            subtitle="从创建订单到支付、完成的转化情况"
            extra={
              <span className="admin-text-sm admin-muted">
                平均确认时长：{formatDuration(data.avgConfirmMinutes)}
              </span>
            }
          >
            {(data.funnel ?? []).length === 0 ? (
              <EmptyState title="暂无转化数据" description="还没有订单数据。" />
            ) : (
              <div className="admin-grid-main-aside">
                <FunnelBars steps={data.funnel} />
                <div className="admin-stack">
                  <SectionTitle>转化率</SectionTitle>
                  {data.funnel.map((step, index) => {
                    const first = data.funnel[0]?.count ?? 0;
                    const previous = index > 0 ? data.funnel[index - 1]?.count ?? 0 : 0;
                    return (
                      <div
                        className="admin-flex"
                        style={{ justifyContent: "space-between", gap: 8 }}
                        key={step.key}
                      >
                        <span className="admin-text-sm">
                          {step.label}（{formatNumber(step.count)} 单）
                        </span>
                        <span className="admin-strong admin-text-sm">
                          {index === 0
                            ? "基准"
                            : first > 0
                              ? formatPercent((step.count / first) * 100)
                              : "—"}
                          {index > 0 && previous > 0 ? (
                            <span className="admin-text-xs admin-muted">
                              {" "}
                              · 较上一步 {formatPercent((step.count / previous) * 100)}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                  <p className="admin-readonly-hint">
                    口径：创建订单 → 已支付 → 已完成；统计周期由后端按最近 12 个月汇总。
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      ) : (
        <EmptyState title="暂无统计数据" description="后台尚未产生可统计的数据。" />
      )}
    </>
  );
}

/**
 * 图表选中项明细卡：环形图（支付方式 / 订单状态）共用。
 * 展示「已选」标题 + 若干指标，可关闭。
 */
function SelectedDetail({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: { label: string; value: string }[];
  onClose: () => void;
}) {
  return (
    <div className="admin-chart-detail" role="status" aria-live="polite">
      <div className="admin-chart-detail-head">
        <span className="admin-chart-detail-title">{title}</span>
        <button
          type="button"
          className="admin-chart-detail-close"
          onClick={onClose}
          aria-label="关闭图表明细"
          title="关闭明细"
        >
          ×
        </button>
      </div>
      <div className="admin-chart-detail-grid">
        {rows.map((row) => (
          <div className="admin-chart-detail-item" key={row.label}>
            <span className="admin-chart-detail-label">{row.label}</span>
            <span className="admin-chart-detail-value">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsSummary({ stats }: { stats: AdminStats }) {
  const funnel = stats.funnel ?? [];
  const created = funnel.find((step) => step.key === "created")?.count ?? 0;
  const paid = funnel.find((step) => step.key === "paid")?.count ?? 0;
  const completed = funnel.find((step) => step.key === "completed")?.count ?? 0;
  const totalAmount = stats.trend.reduce(
    (sum, bucket) => sum + bucket.amountCents,
    0,
  );
  const totalOrders = stats.trend.reduce(
    (sum, bucket) => sum + bucket.orderCount,
    0,
  );

  return (
    <div className="admin-stat-grid">
      <StatCard
        label="近 12 个月交易额"
        value={formatCentsCompact(totalAmount)}
        hint={formatCents(totalAmount)}
        tone="primary"
      />
      <StatCard
        label="近 12 个月订单数"
        value={formatNumber(totalOrders)}
        hint="含所有状态订单"
        tone="accent"
      />
      <StatCard
        label="支付成功率"
        value={created > 0 ? formatPercent((paid / created) * 100) : "—"}
        hint={`已支付 ${formatNumber(paid)} / 创建 ${formatNumber(created)}`}
        tone="success"
      />
      <StatCard
        label="完成率"
        value={created > 0 ? formatPercent((completed / created) * 100) : "—"}
        hint={`已完成 ${formatNumber(completed)} 单`}
        tone="primary"
      />
      <StatCard
        label="平均确认时长"
        value={formatDuration(stats.avgConfirmMinutes)}
        hint="用户支付后商家确认的平均耗时"
        tone="accent"
      />
    </div>
  );
}
