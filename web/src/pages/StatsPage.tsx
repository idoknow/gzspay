/** 交易统计：本周/本月/本年，汇总 + 柱状对比 + 累计趋势；支持导出 CSV / Excel / 图片 / PDF。 */

import { useMemo, useState, type ReactNode } from "react";
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
  type StatsQuery,
} from "../lib/api";
import { downloadBlob, safeFilename } from "../lib/download";
import {
  centsToYuan,
  cn,
  formatCents,
  startOfMonth,
  startOfWeek,
  startOfYear,
  toDateKey,
} from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAsync } from "../lib/hooks";
import { buildImagePdf } from "../lib/pdf";
import { canvasToJpegBytes, canvasToPngBlob, renderStatsReport } from "../lib/statsReport";
import type { StatsBucket, StatsSummary, StatsTimeseries } from "../lib/types";
import { buildXlsx, type XlsxCell } from "../lib/xlsx";

type Preset = "week" | "month" | "year";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "year", label: "本年" },
];

interface Range {
  from: string;
  to: string;
  fromKey: string;
  toKey: string;
  granularity: "day" | "month";
}

function buildRange(preset: Preset): Range {
  const now = new Date();
  let start: Date;
  const end: Date = now;
  switch (preset) {
    case "week":
      start = startOfWeek(now);
      break;
    case "year":
      start = startOfYear(now);
      break;
    case "month":
    default:
      start = startOfMonth(now);
      break;
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
}

type ExportKind = "csv" | "xlsx" | "png" | "pdf";

/** Uint8Array → 独立 ArrayBuffer（BlobPart 要求，规避 TS5.9 泛型收窄） */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function StatsPage(): ReactNode {
  const toast = useToast();
  const [preset, setPreset] = useState<Preset>("month");
  const [includePending, setIncludePending] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  const range = useMemo(() => buildRange(preset), [preset]);
  const query: StatsQuery = useMemo(
    () => ({ from: range.from, to: range.to, includePending }),
    [range.from, range.to, includePending],
  );

  const { data, loading, error, reload } = useAsync<StatsData>(
    () =>
      Promise.all([
        getStatsSummary(query),
        getStatsTimeseries({ ...query, granularity: range.granularity }),
      ]).then(([summary, timeseries]) => ({ summary, timeseries })),
    [query.from, query.to, query.includePending, range.granularity],
  );

  const rangeLabel = `${range.fromKey} 至 ${range.toKey}`;
  const fileBase = safeFilename(`gzspay-交易统计-${range.fromKey}-${range.toKey}`);

  const runExport = async (kind: ExportKind, task: () => Promise<string>): Promise<void> => {
    if (exporting) return;
    setExporting(kind);
    try {
      const message = await task();
      toast.success(message);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setExporting(null);
    }
  };

  const handleExportCsv = (): void => {
    void runExport("csv", async () => {
      const blob = await exportStatsCsv(query);
      downloadBlob(blob, `${fileBase}.csv`);
      return "CSV 已导出";
    });
  };

  const handleExportXlsx = (): void => {
    const summary = data?.summary;
    if (!summary) {
      toast.error("统计结果还没加载完");
      return;
    }
    const bucketSuffix = range.granularity === "month" ? "按月" : "按日";
    const summaryRows: XlsxCell[][] = [
      ["gzspay 交易统计", ""],
      ["统计区间", rangeLabel],
      ["统计口径", includePending ? "含待付款与已支付订单" : "仅已完成订单"],
      ["统计粒度", bucketSuffix],
      [],
      ["支出（元）", "收入（元）", "净额（元）", "订单数"],
      [
        Number(centsToYuan(summary.expenseCents)),
        Number(centsToYuan(summary.incomeCents)),
        Number(centsToYuan(summary.netCents)),
        summary.orderCount,
      ],
    ];
    const detailRows: XlsxCell[][] = [
      ["统计区间", rangeLabel],
      [],
      ["时间", "支出（元）", "收入（元）"],
      ...(data?.timeseries.buckets ?? []).map((bucket) => [
        bucket.key,
        Number(centsToYuan(bucket.expenseCents)),
        Number(centsToYuan(bucket.incomeCents)),
      ]),
    ];
    void runExport("xlsx", async () => {
      const bytes = buildXlsx([
        { name: "汇总", rows: summaryRows, boldRows: [0, 5], columnWidths: [18, 18, 14, 10] },
        { name: "明细", rows: detailRows, boldRows: [2], columnWidths: [16, 14, 14] },
      ]);
      downloadBlob(
        new Blob([toBuffer(bytes)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `${fileBase}.xlsx`,
      );
      return "Excel 已导出";
    });
  };

  const handleExportPng = (): void => {
    if (!data) {
      toast.error("统计结果还没加载完");
      return;
    }
    void runExport("png", async () => {
      const { canvas } = renderStatsReport({
        rangeLabel,
        granularity: range.granularity,
        includePending,
        summary: data.summary,
        buckets: data.timeseries.buckets,
      });
      const blob = await canvasToPngBlob(canvas);
      downloadBlob(blob, `${fileBase}.png`);
      return "图片已导出";
    });
  };

  const handleExportPdf = (): void => {
    if (!data) {
      toast.error("统计结果还没加载完");
      return;
    }
    void runExport("pdf", async () => {
      const report = renderStatsReport({
        rangeLabel,
        granularity: range.granularity,
        includePending,
        summary: data.summary,
        buckets: data.timeseries.buckets,
      });
      const jpeg = canvasToJpegBytes(report.canvas);
      const bytes = buildImagePdf(jpeg, report.canvas.width, report.canvas.height, {
        title: `gzspay stats ${range.fromKey} ${range.toKey}`,
      });
      downloadBlob(new Blob([toBuffer(bytes)], { type: "application/pdf" }), `${fileBase}.pdf`);
      return "PDF 已导出";
    });
  };

  const buckets: StatsBucket[] = data?.timeseries.buckets ?? [];

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="交易统计" back />

      <main className="page space-y-4 pb-10 pt-4">
        <section className="card p-3">
          <div className="segmented" role="tablist" aria-label="统计区间">
            <span
              aria-hidden="true"
              className="segmented-thumb left-1"
              style={{
                width: "calc((100% - 8px) / 3)",
                transform: `translateX(${Math.max(
                  0,
                  PRESETS.findIndex((item) => item.key === preset),
                ) * 100}%)`,
              }}
            />
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={preset === item.key}
                className={cn(
                  "segmented-item text-[12.5px]",
                  preset === item.key && "segmented-item-active",
                )}
                onClick={() => setPreset(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <p className="mt-2 px-1 text-[11px] text-muted">
            {range.fromKey} 至 {range.toKey}
          </p>

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

            <section className="card p-3">
              <div className="flex items-baseline justify-between px-1">
                <p className="text-[13px] font-medium text-text">导出报表</p>
                <p className="text-[11px] text-muted">区间与图表一并导出</p>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                {(
                  [
                    { kind: "csv", label: "CSV 表格", run: handleExportCsv },
                    { kind: "xlsx", label: "Excel 表格", run: handleExportXlsx },
                    { kind: "png", label: "PNG 图片", run: handleExportPng },
                    { kind: "pdf", label: "PDF 文件", run: handleExportPdf },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.kind}
                    type="button"
                    className="btn btn-outline btn-sm justify-center gap-1.5 watch:text-[12px]"
                    disabled={exporting !== null}
                    onClick={item.run}
                  >
                    {exporting === item.kind ? <Spinner size={14} /> : <ExportIcon kind={item.kind} />}
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
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

/** 导出按钮的小图标 */
function ExportIcon({ kind }: { kind: ExportKind }): ReactNode {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true,
  } as const;
  switch (kind) {
    case "csv":
      return (
        <svg {...common}>
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "xlsx":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9 4v16M4 10h5M4 15h5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "png":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="9" cy="10" r="1.4" fill="currentColor" />
          <path
            d="M5 17l4.5-4.5L13 16l2.5-2.5L20 18"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path
            d="M7 3.5h6.5L19 9v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M13 3.5V9h5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M9 13.5h6M9 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}
