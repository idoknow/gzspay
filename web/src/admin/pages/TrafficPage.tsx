/**
 * 访问统计：请求量趋势、路由排行、HTTP 状态码、访问设备 / 浏览器 / 系统、
 * 访问地区，以及扫码（校园卡 / 平台动态码）与安全防护拦截次数。
 * 数据由服务端按「天 + 类别」聚合，只统计次数，不保存 IP 与 User-Agent。
 */
import { useState } from "react";
import { getTraffic } from "../api";
import { BarChart, DonutChart } from "../components/charts";
import { ExportableCard } from "../components/ExportableCard";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonCards,
  StatCard,
  TableSkeleton,
  Tabs,
} from "../components/ui";
import { formatNumber } from "../format";
import { useAsync } from "../hooks";
import { errorMessage } from "../../lib/http";
import type { TrafficBreakdownItem, TrafficStats } from "../types";

type RangeKey = "7" | "30" | "90";

const RANGES: Array<{ key: RangeKey; label: string; days: number }> = [
  { key: "7", label: "最近 7 天", days: 7 },
  { key: "30", label: "最近 30 天", days: 30 },
  { key: "90", label: "最近 90 天", days: 90 },
];

const DEVICE_COLORS: Record<string, string> = {
  desktop: "#3b82f6",
  mobile: "#f59e0b",
  tablet: "#8b5cf6",
  bot: "#ef4444",
  unknown: "#94a3b8",
};

function countFormat(value: number): string {
  return `${formatNumber(value)} 次`;
}

/** 横向占比条：用于路由 / 安全防护排行 */
function ShareRow({ item, max }: { item: TrafficBreakdownItem; max: number }) {
  const width = max > 0 ? Math.max((item.count / max) * 100, 2) : 0;
  return (
    <div className="admin-traffic-row">
      <div className="admin-traffic-row-head">
        <span className="admin-traffic-row-label" title={item.label}>
          {item.label}
        </span>
        <span className="admin-traffic-row-value">
          {formatNumber(item.count)}
          <span className="admin-traffic-row-share">{item.share.toFixed(1)}%</span>
        </span>
      </div>
      <div className="admin-traffic-bar" aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ShareList({
  items,
  emptyText,
}: {
  items: TrafficBreakdownItem[];
  emptyText: string;
}) {
  if (items.length === 0) return <EmptyState title={emptyText} />;
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="admin-traffic-list">
      {items.map((item) => (
        <ShareRow key={item.key} item={item} max={max} />
      ))}
    </div>
  );
}

export function TrafficPage() {
  const [range, setRange] = useState<RangeKey>("7");
  const days = RANGES.find((item) => item.key === range)?.days ?? 7;
  const { data, loading, error, refresh } = useAsync<TrafficStats>(
    () => getTraffic(days),
    [days],
  );

  const seriesPoints = (data?.series ?? []).map((point) => ({
    key: point.day,
    label: point.label,
    value: point.requests,
    secondary: point.scans,
  }));

  const deviceSlices = (data?.devices ?? []).map((item) => ({
    label: item.label,
    value: item.count,
    color: DEVICE_COLORS[item.key],
    hint: `${formatNumber(item.count)} 次 · ${item.share.toFixed(1)}%`,
  }));

  return (
    <>
      <PageHeader
        title="访问统计"
        description="请求量、访问设备与地区、扫码次数与安全防护拦截情况，仅管理员可见。"
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

      <Tabs
        items={RANGES.map((item) => ({ key: item.key, label: item.label }))}
        active={range}
        onChange={(key) => setRange(key)}
      />

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refresh()} />
      ) : loading && !data ? (
        <>
          <SkeletonCards count={5} />
          <div className="admin-card" style={{ marginTop: 18 }}>
            <TableSkeleton rows={6} cols={4} />
          </div>
        </>
      ) : data ? (
        <div className="admin-stack" style={{ marginTop: 18 }}>
          <div className="admin-stat-grid">
            <StatCard
              label="请求总数"
              value={formatNumber(data.requests.total)}
              hint={`${data.since} 至 ${data.until}`}
            />
            <StatCard
              label="今日请求"
              value={formatNumber(data.requests.today)}
              hint="按服务器本地时区统计"
              tone="accent"
            />
            <StatCard
              label="日均请求"
              value={formatNumber(data.requests.averagePerDay)}
              hint={`最近 ${data.days} 天平均`}
            />
            <StatCard
              label="扫码次数"
              value={formatNumber(data.scans.total)}
              hint="校园卡 + 平台动态码"
              tone="success"
            />
            <StatCard
              label="安全防护拦截"
              value={formatNumber(data.security.total)}
              hint="限流、CSRF、地区、扫描器与越权访问"
            />
          </div>

          <ExportableCard
            title="请求量趋势"
            subtitle="柱状为每日请求数，副轴数据为当日扫码次数；点击柱子查看当天明细"
            filename="访问统计-请求量趋势"
            csv={{
              headers: ["日期", "请求数", "扫码次数", "安全拦截"],
              rows: data.series.map((point) => [
                point.label || point.day,
                point.requests,
                point.scans,
                point.security,
              ]),
            }}
            json={data.series}
          >
            <BarChart
              points={seriesPoints}
              height={240}
              valueFormat={countFormat}
              emptyText="最近还没有请求数据"
              ariaLabel="每日请求量柱状图"
            />
          </ExportableCard>

          <div className="admin-grid-main-aside">
            <Card title="路由请求排行" subtitle="按接口 / 页面统计的请求次数（前 15）">
              <ShareList items={data.routes} emptyText="暂无路由请求数据" />
            </Card>
            <ExportableCard
              title="访问设备"
              subtitle="按 User-Agent 粗分类"
              filename="访问统计-访问设备"
              csv={{
                headers: ["设备", "请求数", "占比（%）"],
                rows: data.devices.map((item) => [item.label, item.count, item.share]),
              }}
              json={data.devices}
            >
              <DonutChart
                slices={deviceSlices}
                centerLabel="请求"
                centerValue={formatNumber(
                  deviceSlices.reduce((sum, slice) => sum + slice.value, 0),
                )}
                emptyText="暂无设备数据"
              />
            </ExportableCard>
          </div>

          <div className="admin-grid-2">
            <ExportableCard
              title="HTTP 状态码"
              subtitle="响应状态分布，关注 4xx / 5xx 占比"
              filename="访问统计-状态码"
              csv={{
                headers: ["状态码", "请求数", "占比（%）"],
                rows: data.statuses.map((item) => [item.label || item.key, item.count, item.share]),
              }}
              json={data.statuses}
            >
              <BarChart
                points={data.statuses.map((item) => ({
                  key: item.key,
                  label: item.label,
                  value: item.count,
                }))}
                height={220}
                valueFormat={countFormat}
                emptyText="暂无状态码数据"
                ariaLabel="HTTP 状态码分布图"
              />
            </ExportableCard>
            <Card title="访问地区" subtitle="按 IP 归属地粗分类（不保存具体 IP）">
              <ShareList items={data.regions} emptyText="暂无地区数据" />
            </Card>
          </div>

          <div className="admin-grid-2">
            <Card title="浏览器与系统" subtitle="访问客户端分布">
              <ShareList
                items={[...data.browsers, ...data.systems]}
                emptyText="暂无客户端数据"
              />
            </Card>
            <ExportableCard
              title="扫码统计"
              subtitle="校园卡与平台动态码被扫次数"
              filename="访问统计-扫码统计"
              csv={{
                headers: ["扫码方式", "次数", "占比（%）"],
                rows: data.scans.items.map((item) => [item.label || item.key, item.count, item.share]),
              }}
              json={data.scans.items}
            >
              <BarChart
                points={data.scans.items.map((item) => ({
                  key: item.key,
                  label: item.label,
                  value: item.count,
                }))}
                height={200}
                valueFormat={countFormat}
                emptyText="暂无扫码数据"
                ariaLabel="扫码次数统计图"
              />
            </ExportableCard>
          </div>

          <Card
            title="安全防护"
            subtitle="限流、CSRF、地区拦截、扫描器路径、后台入口探测与越权访问等拦截次数"
          >
            <ShareList items={data.security.items} emptyText="最近没有安全防护拦截" />
          </Card>
        </div>
      ) : null}
    </>
  );
}
