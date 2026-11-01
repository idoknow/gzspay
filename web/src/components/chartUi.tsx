/**
 * 统计图表共用件：可点按的图例、点选后的明细面板。
 * 图例点按 = 隐藏/显示对应系列；明细面板由各图表在点选数据点后渲染。
 */

import type { ReactNode } from "react";

import { cn } from "../lib/format";

export interface ChartLegendItem {
  key: string;
  label: string;
  color: string;
  hidden?: boolean;
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  onToggle: (key: string) => void;
  className?: string;
}

/** 图例：每一项都是按钮，点按可隐藏 / 恢复该系列 */
export function ChartLegend({ items, onToggle, className }: ChartLegendProps): ReactNode {
  return (
    <div className={cn("mb-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5", className)}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onToggle(item.key)}
          aria-pressed={!item.hidden}
          aria-label={`${item.hidden ? "显示" : "隐藏"}${item.label}`}
          className="flex items-center gap-1.5 rounded-full px-1 py-0.5 text-[11px] text-muted transition active:scale-95"
        >
          <span
            aria-hidden
            className={cn("h-2.5 w-2.5 rounded-[3px]", item.hidden && "opacity-40")}
            style={{ background: item.color }}
          />
          <span className={cn(item.hidden && "line-through opacity-60")}>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export interface ChartDetailRow {
  label: string;
  value: string;
  strong?: boolean;
}

export interface ChartDetailProps {
  title: string;
  rows: ChartDetailRow[];
  onClose: () => void;
}

/** 点选数据点后的明细卡：点「收起」或再次点同一点可关闭 */
export function ChartDetail({ title, rows, onClose }: ChartDetailProps): ReactNode {
  return (
    <div className="mt-2 rounded-xl border border-line/70 bg-surface-2/70 px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium text-text">{title}</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-1 text-[11px] text-muted active:scale-95"
        >
          收起
        </button>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {rows.map((row) => (
          <span key={row.label} className="text-[11px] text-muted">
            {row.label}
            <span className={cn("ml-1 text-text", row.strong && "font-semibold")}>{row.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** X 轴标签：按可用宽度抽样显示，避免小屏挤成一团 */
export function pickLabelIndexes(count: number, maxLabels: number): Set<number> {
  const result = new Set<number>();
  if (count <= 0) return result;
  const step = Math.max(1, Math.ceil(count / maxLabels));
  for (let index = 0; index < count; index += step) result.add(index);
  result.add(count - 1);
  return result;
}
