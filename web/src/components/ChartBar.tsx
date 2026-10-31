/** 柱状对比图（SVG 手写）：支出 / 收入按区间对比。 */

import type { ReactNode } from "react";
import { cn } from "../lib/format";
import type { StatsBucket } from "../lib/types";

function compactYuan(cents: number): string {
  const yuan = cents / 100;
  if (yuan >= 10000) return `${(yuan / 10000).toFixed(yuan >= 100000 ? 0 : 1)}万`;
  if (yuan >= 1000) return `${Math.round(yuan / 100) / 10}k`;
  if (yuan >= 10) return String(Math.round(yuan));
  return yuan.toFixed(1);
}

export interface ChartBarProps {
  buckets: StatsBucket[];
  className?: string;
}

export function ChartBar({ buckets, className }: ChartBarProps): ReactNode {
  const width = 360;
  const height = 180;
  const padX = 6;
  const padTop = 22;
  const padBottom = 24;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  if (buckets.length === 0) {
    return (
      <div className={cn("flex h-[180px] items-center justify-center text-sm text-muted", className)}>
        该区间暂无数据
      </div>
    );
  }

  const max = Math.max(1, ...buckets.flatMap((bucket) => [bucket.expenseCents, bucket.incomeCents]));
  const groupWidth = plotW / buckets.length;
  const barWidth = Math.min(14, Math.max(3, groupWidth * 0.28));
  const labelStep = Math.max(1, Math.ceil(buckets.length / 6));
  const gridLines = [0, 0.5, 1];

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex items-center justify-end gap-4 pr-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> 支出
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> 收入
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="支出收入对比图">
        {gridLines.map((ratio) => {
          const y = padTop + plotH * (1 - ratio);
          return (
            <g key={ratio}>
              <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 4" />
              <text x={padX} y={y - 3} fontSize="8" fill="var(--muted)">
                {compactYuan(Math.round(max * ratio))}
              </text>
            </g>
          );
        })}
        {buckets.map((bucket, index) => {
          const center = padX + groupWidth * index + groupWidth / 2;
          const expenseHeight = (bucket.expenseCents / max) * plotH;
          const incomeHeight = (bucket.incomeCents / max) * plotH;
          const base = padTop + plotH;
          return (
            <g key={bucket.key}>
              <rect
                x={center - barWidth - 1}
                y={base - expenseHeight}
                width={barWidth}
                height={Math.max(bucket.expenseCents > 0 ? 2 : 0, expenseHeight)}
                rx="2.5"
                fill="var(--brand)"
              >
                <title>{`${bucket.key} 支出 ¥${(bucket.expenseCents / 100).toFixed(2)}`}</title>
              </rect>
              <rect
                x={center + 1}
                y={base - incomeHeight}
                width={barWidth}
                height={Math.max(bucket.incomeCents > 0 ? 2 : 0, incomeHeight)}
                rx="2.5"
                fill="var(--accent)"
              >
                <title>{`${bucket.key} 收入 ¥${(bucket.incomeCents / 100).toFixed(2)}`}</title>
              </rect>
              {index % labelStep === 0 || index === buckets.length - 1 ? (
                <text x={center} y={height - 8} fontSize="8.5" fill="var(--muted)" textAnchor="middle">
                  {bucket.key}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
