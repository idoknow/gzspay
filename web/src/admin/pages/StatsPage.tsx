/**
 * 数据统计：交易额与订单数趋势、商家排行、支付方式占比、订单转化漏斗与平均确认时长。
 */
import { useMemo } from "react";
import { getStats } from "../api";
import { DonutChart, DualAxisTrendChart, FunnelBars } from "../components/charts";
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

  const maxMerchantAmount = useMemo(
    () =>
      Math.max(
        1,
        ...(data?.merchantRanking ?? []).map((merchant) => merchant.amountCents),
      ),
    [data],
  );

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

          <Card title="交易额与订单数趋势" subtitle="柱状为交易额，折线为订单数">
            <DualAxisTrendChart
              points={data.trend.map((bucket) => ({
                key: bucket.key,
                label: bucket.label,
                value: bucket.amountCents,
                secondary: bucket.orderCount,
              }))}
              emptyText="暂无趋势数据"
            />
          </Card>

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

            <Card title="支付方式占比" subtitle="按订单数统计">
              {(data.paymentMethods ?? []).length === 0 ? (
                <EmptyState title="暂无支付数据" description="还没有已支付订单。" />
              ) : (
                <div className="admin-donut-wrap">
                  <DonutChart
                    slices={data.paymentMethods.map((method) => ({
                      label: method.label || method.method,
                      value: method.count,
                    }))}
                    centerLabel="支付订单"
                    centerValue={formatNumber(
                      data.paymentMethods.reduce(
                        (sum, method) => sum + method.count,
                        0,
                      ),
                    )}
                  />
                  <div className="admin-donut-legend">
                    {data.paymentMethods.map((method) => {
                      const totalCount = data.paymentMethods.reduce(
                        (sum, item) => sum + item.count,
                        0,
                      );
                      return (
                        <div className="admin-donut-legend-row" key={method.method}>
                          <div>
                            <div className="admin-strong">
                              {method.label || method.method}
                            </div>
                            <div className="admin-text-xs admin-muted">
                              {formatNumber(method.count)} 单 ·{" "}
                              {formatCents(method.amountCents)}
                            </div>
                          </div>
                          <span className="admin-strong">
                            {totalCount > 0
                              ? formatPercent((method.count / totalCount) * 100)
                              : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
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
