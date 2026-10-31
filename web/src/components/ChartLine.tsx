/** 累计趋势折线图（SVG 手写）：支出 / 收入累计。 */

import { useId, type ReactNode } from "react";
import { cn } from "../lib/format";
import type { StatsBucket } from "../lib/types";

function compactYuan(cents: number): string {
  const yuan = cents / 100;
  if (yuan >= 10000) return `${(yuan / 10000).toFixed(yuan >= 100000 ? 0 : 1)}万`;
  if (yuan >= 1000) return `${Math.round(yuan / 100) / 10}k`;
  if (yuan >= 10) return String(Math.round(yuan));
  return yuan.toFixed(1);
}

export interface ChartLineProps {
  buckets: StatsBucket[];
  className?: string;
}

export function ChartLine({ buckets, className }: ChartLineProps): ReactNode {
  const seed = useId().replace(/[^a-zA-Z0-9]/g, "");
  const width = 360;
  const height = 180;
  const padX = 6;
  const padTop = 18;
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

  let expenseSum = 0;
  let incomeSum = 0;
  const expensePoints: { x: number; y: number; value: number }[] = [];
  const incomePoints: { x: number; y: number; value: number }[] = [];
  const stepX = buckets.length > 1 ? plotW / (buckets.length - 1) : 0;
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    if (!bucket) continue;
    expenseSum += bucket.expenseCents;
    incomeSum += bucket.incomeCents;
    const x = buckets.length > 1 ? padX + stepX * index : padX + plotW / 2;
    expensePoints.push({ x, y: 0, value: expenseSum });
    incomePoints.push({ x, y: 0, value: incomeSum });
  }

  const max = Math.max(1, expenseSum, incomeSum);
  const toY = (value: number): number => padTop + plotH * (1 - value / max);
  for (const point of expensePoints) point.y = toY(point.value);
  for (const point of incomePoints) point.y = toY(point.value);

  const toPath = (points: { x: number; y: number }[]): string => {
    if (points.length === 0) return "";
    const [first, ...rest] = points;
    if (!first) return "";
    return rest.reduce((path, point) => `${path} L${point.x.toFixed(1)},${point.y.toFixed(1)}`, `M${first.x.toFixed(1)},${first.y.toFixed(1)}`);
  };
  const toArea = (points: { x: number; y: number }[]): string => {
    if (points.length === 0) return "";
    const line = toPath(points);
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return "";
    const base = padTop + plotH;
    return `${line} L${last.x.toFixed(1)},${base} L${first.x.toFixed(1)},${base} Z`;
  };

  const gridLines = [0, 0.5, 1];
  const labelStep = Math.max(1, Math.ceil(buckets.length / 6));
  const lastExpense = expensePoints[expensePoints.length - 1];
  const lastIncome = incomePoints[incomePoints.length - 1];

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-2 flex items-center justify-end gap-4 pr-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> 累计支出
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> 累计收入
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="累计趋势图">
        <defs>
          <linearGradient id={`gz-area-expense-${seed}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`gz-area-income-${seed}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
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
        <path d={toArea(expensePoints)} fill={`url(#gz-area-expense-${seed})`} />
        <path d={toArea(incomePoints)} fill={`url(#gz-area-income-${seed})`} />
        <path d={toPath(expensePoints)} fill="none" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d={toPath(incomePoints)} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {lastExpense ? <circle cx={lastExpense.x} cy={lastExpense.y} r="3" fill="var(--brand)" /> : null}
        {lastIncome ? <circle cx={lastIncome.x} cy={lastIncome.y} r="3" fill="var(--accent)" /> : null}
        {buckets.map((bucket, index) =>
          index % labelStep === 0 || index === buckets.length - 1 ? (
            <text
              key={bucket.key}
              x={buckets.length > 1 ? padX + stepX * index : padX + plotW / 2}
              y={height - 8}
              fontSize="8.5"
              fill="var(--muted)"
              textAnchor="middle"
            >
              {bucket.key}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
