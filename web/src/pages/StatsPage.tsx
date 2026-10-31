/** 交易统计：周/月/年/自定义区间，汇总 + 柱状对比 + 累计趋势 + 榜单 + CSV 导出。 */

import { useMemo, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { ChartBar } from "../components/ChartBar";
import { ChartLine } from "../components/ChartLine";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock, Spinner } from "../components/Loading";
import { MoneyText } from "../components/MoneyText";
import { PageHeader } from "../components/PageHeader";
import { Toggle } from "../components/Toggle";
import { useToast } from "../components/Toast";
import {
  exportStatsCsv,
  getStatsSummary,
  getStatsTimeseries,
  getStatsTop,
  type StatsQuery,
} from "../lib/api";
import { downloadBlob, safeFilename } from "../lib/download";
import { cn, formatCents, startOfMonth, startOfWeek, startOfYear, toDateKey } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAsync } from "../lib/hooks";
import type { StatsBucket, StatsSummary, StatsTimeseries, StatsTop, StatsTopEntry } from "../lib/types";

type Preset = "week" | "month" | "year" | "custom";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "year", label: "本年" },
  { key: "custom", label: "自定义" },
];

interface Range {
  from: string;
  to: string;
  fromKey: string;
  toKey: string;
  granularity: "day" | "month";
}

function buildRange(preset: Preset, customFrom: string, customTo: string): Range {
  const now = new Date();
  let start: Date;
  let end: Date = now;
  switch (preset) {
    case "week":
      start = startOfWeek(now);
      break;
    case "year":
      start = startOfYear(now);
      break;
    case "custom": {
      const parsedFrom = customFrom ? new Date(`${customFrom}T00:00:00`) : startOfMonth(now);
      const parsedTo = customTo ? new Date(`${customTo}T23:59:59`) : now;
      start = Number.isNaN(parsedFrom.getTime()) ? startOfMonth(now) : parsedFrom;
      end = Number.isNaN(parsedTo.getTime()) ? now : parsedTo;
      break;
    }
    case "month":
    default:
      start = startOfMonth(now);
      break;
  }
  if (start.getTime() > end.getTime()) {
    const swap = start;
    start = end;
    end = swap;
  }
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    fromKey: toDateKey(start),
    toKey: toDateKey(end),
    granularity: days > 62 ? "month" : "day",
  };
}

interface StatsData {
  summary: StatsSummary;
  timeseries: StatsTimeseries;
  top: StatsTop;
}

function TopList({ title, entries, empty }: { title: string; entries: StatsTopEntry[]; empty: string }): ReactNode {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted">{empty}</p>
      ) : (
        <ol className="mt-2 space-y-2.5">
          {entries.map((entry, index) => (
            <li key={entry.user.id} className="flex items-center gap-3">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                  index === 0 ? "bg-accent text-white" : index === 1 ? "bg-brand-soft text-brand" : "bg-surface-2 text-muted",
                )}
              >
                {index + 1}
              </span>
              <Avatar name={entry.user.displayName} avatarUrl={entry.user.avatarUrl} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{entry.user.displayName}</p>
                <p className="text-[11px] text-muted">{entry.count} 笔</p>
              </div>
              <MoneyText cents={entry.totalCents} size="sm" className="shrink-0" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function StatsPage(): ReactNode {
  const toast = useToast();
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState(() => toDateKey(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState(() => toDateKey(new Date()));
  const [includePending, setIncludePending] = useState(false);
  const [exporting, setExporting] = useState(false);

  const range = useMemo(() => buildRange(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const query: StatsQuery = useMemo(
    () => ({ from: range.from, to: range.to, includePending }),
    [range.from, range.to, includePending],
  );

  const { data, loading, error, reload } = useAsync<StatsData>(
    () =>
      Promise.all([
        getStatsSummary(query),
        getStatsTimeseries({ ...query, granularity: range.granularity }),
        getStatsTop(query),
      ]).then(([summary, timeseries, top]) => ({ summary, timeseries, top })),
    [query.from, query.to, query.includePending, range.granularity],
  );

  const handleExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const blob = await exportStatsCsv(query);
      downloadBlob(blob, safeFilename(`gzspay-统计-${range.fromKey}-${range.toKey}.csv`));
      toast.success("CSV 已导出");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  const buckets: StatsBucket[] = data?.timeseries.buckets ?? [];

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="交易统计" back />

      <main className="page space-y-4 pb-10 pt-4">
        <section className="card p-3">
          <div className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={cn(
                  "rounded-xl px-2 py-2 text-[13px] font-medium transition-colors",
                  preset === item.key ? "bg-surface text-brand shadow-sm" : "text-muted",
                )}
                onClick={() => setPreset(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {preset === "custom" ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted">
                开始
                <input
                  type="date"
                  className="input mt-1 py-2"
                  value={customFrom}
                  max={customTo}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </label>
              <label className="text-[11px] text-muted">
                结束
                <input
                  type="date"
                  className="input mt-1 py-2"
                  value={customTo}
                  min={customFrom}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <p className="mt-2 px-1 text-[11px] text-muted">
              {range.fromKey} 至 {range.toKey}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2.5">
            <div>
              <p className="text-[13px] font-medium text-text">含待确认</p>
              <p className="mt-0.5 text-[11px] text-muted">开启后统计待付款与已支付订单</p>
            </div>
            <Toggle checked={includePending} onChange={setIncludePending} label="含待确认" />
          </div>
        </section>

        {loading && !data ? (
          <LoadingBlock text="正在统计…" />
        ) : error && !data ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : data ? (
          <>
            <section className="card p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-surface-2 px-2 py-3">
                  <p className="text-[11px] text-muted">支出</p>
                  <MoneyText cents={data.summary.expenseCents} size="md" className="mt-1" />
                </div>
                <div className="rounded-2xl bg-surface-2 px-2 py-3">
                  <p className="text-[11px] text-muted">收入</p>
                  <MoneyText cents={data.summary.incomeCents} size="md" className="mt-1" />
                </div>
                <div
                  className={cn(
                    "rounded-2xl px-2 py-3",
                    data.summary.netCents >= 0 ? "bg-success-soft" : "bg-danger-soft",
                  )}
                >
                  <p className="text-[11px] text-muted">净额</p>
                  <MoneyText cents={data.summary.netCents} size="md" signed className="mt-1" />
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] text-muted">共 {data.summary.orderCount} 笔订单</p>
            </section>

            <section className="card p-4">
              <h2 className="text-sm font-semibold text-text">收支对比</h2>
              <div className="mt-2">
                <ChartBar buckets={buckets} />
              </div>
            </section>

            <section className="card p-4">
              <h2 className="text-sm font-semibold text-text">累计趋势</h2>
              <div className="mt-2">
                <ChartLine buckets={buckets} />
              </div>
            </section>

            {buckets.length === 0 ? (
              <EmptyState title="该区间暂无交易" description="换个时间范围试试，或先完成一笔交易。" />
            ) : null}

            <TopList
              title="支出最多商家"
              entries={data.top.expenseTop}
              empty="该区间没有支出记录"
            />
            <TopList
              title="收入最多付款人"
              entries={data.top.incomeTop}
              empty="该区间没有收入记录"
            />

            <button type="button" className="btn btn-outline btn-block" disabled={exporting} onClick={() => void handleExport()}>
              {exporting ? <Spinner size={16} /> : null}
              导出 CSV
            </button>
            <p className="text-center text-[11px] text-muted">
              统计口径：以订单金额为准，含待确认会包含待付款与已支付订单
            </p>
          </>
        ) : null}

        {error && data ? <p className="text-center text-xs text-danger">{error}</p> : null}
      </main>
    </div>
  );
}
