/**
 * 每月交易额：按年展示 12 个月柱状图，点击某月展开该月每日趋势。
 */
import { useEffect, useMemo, useState } from "react";
import { getMonthly, getMonthlyDays } from "../api";
import { BarChart, DualAxisTrendChart } from "../components/charts";
import {
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
  formatDate,
  formatMonthLabel,
  formatNumber,
  formatPercent,
} from "../format";
import { useAsync } from "../hooks";
import { errorMessage } from "../../lib/http";
import type { DailyBucket, MonthlyData } from "../types";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [
  CURRENT_YEAR,
  CURRENT_YEAR - 1,
  CURRENT_YEAR - 2,
  CURRENT_YEAR - 3,
];

export function MonthlyPage() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const { data, loading, error, refresh } = useAsync<MonthlyData>(
    () => getMonthly(year),
    [year],
  );

  // 切换年份时清除上一年的选中月份
  useEffect(() => {
    setSelectedKey(null);
  }, [year]);

  const months = data?.months ?? [];

  const activeMonth = useMemo(() => {
    if (selectedKey) {
      const picked = months.find((month) => month.key === selectedKey);
      if (picked) return picked;
    }
    const currentKey = `${CURRENT_YEAR}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    return (
      months.find((month) => month.key === currentKey) ??
      [...months].reverse().find((month) => month.amountCents > 0) ??
      months[months.length - 1] ??
      null
    );
  }, [months, selectedKey]);

  // 后端 monthly 未带每日明细时兜底拉取
  const fallbackDays = useAsync<DailyBucket[]>(
    () =>
      activeMonth && activeMonth.days.length === 0
        ? getMonthlyDays(year, activeMonth.key)
        : Promise.resolve([]),
    [year, activeMonth?.key, activeMonth?.days.length],
  );

  const days =
    activeMonth && activeMonth.days.length > 0
      ? activeMonth.days
      : (fallbackDays.data ?? []);

  const daysLoading =
    activeMonth !== null &&
    activeMonth.days.length === 0 &&
    fallbackDays.loading &&
    fallbackDays.data === null;

  const summary = useMemo(() => {
    const amount = months.reduce((sum, month) => sum + month.amountCents, 0);
    const orders = months.reduce((sum, month) => sum + month.orderCount, 0);
    const activeMonths = months.filter((month) => month.amountCents > 0).length;
    return { amount, orders, activeMonths };
  }, [months]);

  const monthStats = useMemo(() => {
    if (!activeMonth) return null;
    const amount = activeMonth.amountCents;
    const orders = activeMonth.orderCount;
    const peak = days.reduce<DailyBucket | null>(
      (best, day) => (best === null || day.amountCents > best.amountCents ? day : best),
      null,
    );
    return {
      amount,
      orders,
      average: days.length > 0 ? amount / days.length : 0,
      peak,
    };
  }, [activeMonth, days]);

  return (
    <>
      <PageHeader
        title="每月交易额"
        description="按自然月查看全校交易规模，点击柱状图可展开该月每日趋势。"
        actions={
          <div className="admin-flex" style={{ gap: 8 }}>
            <select
              className="admin-select"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              aria-label="选择年份"
            >
              {YEAR_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} 年
                </option>
              ))}
            </select>
            <button
              type="button"
              className="admin-btn admin-btn-subtle admin-btn-sm"
              onClick={() => refresh()}
              disabled={loading}
            >
              刷新
            </button>
          </div>
        }
      />

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refresh()} />
      ) : loading && !data ? (
        <>
          <SkeletonCards count={3} />
          <div className="admin-card" style={{ marginTop: 18 }}>
            <TableSkeleton rows={5} cols={4} />
          </div>
        </>
      ) : months.length === 0 ? (
        <EmptyState title="暂无交易数据" description={`${year} 年还没有产生交易记录。`} />
      ) : (
        <div className="admin-stack">
          <div className="admin-stat-grid">
            <StatCard
              label={`${year} 年交易额`}
              value={formatCents(summary.amount)}
              hint="全年已支付及已完成订单"
              tone="primary"
            />
            <StatCard
              label={`${year} 年订单数`}
              value={formatNumber(summary.orders)}
              hint="全年创建订单总数"
              tone="accent"
            />
            <StatCard
              label="有交易月份"
              value={`${summary.activeMonths} / 12`}
              hint="产生过交易的月份数"
              tone="success"
            />
          </div>

          <Card
            title={`${year} 年每月交易额`}
            subtitle="点击柱状图查看该月每日趋势"
            extra={
              <span className="admin-text-sm admin-muted">
                单位：元 · 当前选中：
                {activeMonth ? formatMonthLabel(activeMonth.key) : "—"}
              </span>
            }
          >
            <BarChart
              points={months.map((month) => ({
                key: month.key,
                label: month.label || formatMonthLabel(month.key),
                value: month.amountCents,
              }))}
              onSelect={(point) => setSelectedKey(point.key)}
              selectedKey={activeMonth?.key}
              emptyText="暂无月度数据"
              ariaLabel={`${year} 年每月交易额`}
            />
          </Card>

          <div className="admin-grid-main-aside">
            <Card
              title={
                activeMonth
                  ? `${formatMonthLabel(activeMonth.key)}每日交易趋势`
                  : "每日交易趋势"
              }
              subtitle="柱状为交易额，折线为订单数；点击左侧月份可切换"
            >
              {daysLoading ? (
                <TableSkeleton rows={4} cols={3} />
              ) : (
                <DualAxisTrendChart
                  points={days.map((day) => ({
                    key: day.key,
                    label: day.label || day.key.slice(5),
                    value: day.amountCents,
                    secondary: day.orderCount,
                  }))}
                  emptyText="该月暂无每日明细"
                />
              )}
            </Card>

            <Card title="所选月份概览">
              {monthStats ? (
                <div className="admin-stack">
                  <SectionTitle>{formatMonthLabel(activeMonth?.key ?? "")}</SectionTitle>
                  <div className="admin-kv-grid">
                    <div className="admin-kv">
                      <span className="admin-kv-label">交易额</span>
                      <span className="admin-kv-value">
                        {formatCents(monthStats.amount)}
                      </span>
                    </div>
                    <div className="admin-kv">
                      <span className="admin-kv-label">订单数</span>
                      <span className="admin-kv-value">
                        {formatNumber(monthStats.orders)}
                      </span>
                    </div>
                    <div className="admin-kv">
                      <span className="admin-kv-label">日均交易额</span>
                      <span className="admin-kv-value">
                        {formatCents(monthStats.average)}
                      </span>
                    </div>
                    <div className="admin-kv">
                      <span className="admin-kv-label">单日均订单</span>
                      <span className="admin-kv-value">
                        {days.length > 0
                          ? formatNumber(monthStats.orders / days.length)
                          : "—"}
                      </span>
                    </div>
                    <div className="admin-kv">
                      <span className="admin-kv-label">最高单日</span>
                      <span className="admin-kv-value">
                        {monthStats.peak
                          ? `${formatDate(monthStats.peak.key)} · ${formatCents(
                              monthStats.peak.amountCents,
                            )}`
                          : "—"}
                      </span>
                    </div>
                    <div className="admin-kv">
                      <span className="admin-kv-label">订单占比</span>
                      <span className="admin-kv-value">
                        {summary.orders > 0
                          ? formatPercent((monthStats.orders / summary.orders) * 100)
                          : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState title="请选择月份" description="点击左侧柱状图查看该月数据。" />
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
