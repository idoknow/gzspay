/**
 * 多系列柱状图（纯 SVG，无第三方图表库）。
 * 交互：点按图例隐藏 / 恢复系列；点按某一组柱子查看该组的明细。
 */

import { useState, type ReactNode } from "react";

import { cn } from "../lib/format";
import { ChartDetail, ChartLegend, pickLabelIndexes } from "./chartUi";

export interface BarSeries {
  key: string;
  label: string;
  color: string;
  /** 与 labels 等长 */
  values: number[];
}

export interface ChartBarsProps {
  labels: string[];
  series: BarSeries[];
  /** 数值格式化（刻度与明细分） */
  formatValue: (value: number) => string;
  /** 明细里额外展示的行（例如时段图里的「笔数」或「金额」） */
  extraRows?: { label: string; values: number[]; format: (value: number) => string }[];
  ariaLabel?: string;
  emptyText?: string;
  className?: string;
  height?: number;
}

const WIDTH = 360;

export function ChartBars({
  labels,
  series,
  formatValue,
  extraRows = [],
  ariaLabel = "柱状图",
  emptyText = "该区间暂无数据",
  className,
  height = 176,
}: ChartBarsProps): ReactNode {
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const visible = series.filter((item) => !hiddenKeys.includes(item.key));
  const count = labels.length;
  const top = 18;
  const bottom = 22;
  const plotHeight = height - top - bottom;
  const groupWidth = count > 0 ? WIDTH / count : WIDTH;
  const maxValue = Math.max(1, ...visible.flatMap((item) => item.values));
  const gap = 2;
  const barWidth = Math.max(
    2.5,
    Math.min(15, (groupWidth * 0.66 - gap * Math.max(0, visible.length - 1)) / Math.max(1, visible.length)),
  );
  const barGroupWidth = visible.length * barWidth + Math.max(0, visible.length - 1) * gap;
  const labelIndexes = pickLabelIndexes(count, 6);

  const toggle = (key: string): void => {
    setHiddenKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
    setSelected(null);
  };

  const rows =
    selected === null
      ? []
      : [
          ...visible.map((item) => ({
            label: item.label,
            value: formatValue(item.values[selected] ?? 0),
            strong: true,
          })),
          ...extraRows.map((row) => ({
            label: row.label,
            value: row.format(row.values[selected] ?? 0),
          })),
        ];

  return (
    <div className={className}>
      <ChartLegend
        items={series.map((item) => ({
          key: item.key,
          label: item.label,
          color: item.color,
          hidden: hiddenKeys.includes(item.key),
        }))}
        onToggle={toggle}
      />

      {count === 0 ? (
        <p className="py-8 text-center text-xs text-muted">{emptyText}</p>
      ) : (
        <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={ariaLabel} className="h-auto w-full">
          {[0, 0.5, 1].map((ratio) => {
            const y = top + plotHeight * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={0}
                  x2={WIDTH}
                  y1={y}
                  y2={y}
                  stroke="var(--line)"
                  strokeDasharray={ratio === 0 ? undefined : "3 4"}
                  strokeWidth={1}
                />
                <text x={0} y={y - 4} fontSize={9} fill="var(--muted)">
                  {formatValue(maxValue * ratio)}
                </text>
              </g>
            );
          })}

          {selected !== null && (
            <rect
              x={selected * groupWidth}
              y={top}
              width={groupWidth}
              height={plotHeight}
              fill="var(--brand-soft)"
              opacity={0.55}
              rx={6}
            />
          )}

          {labels.map((label, index) => {
            const groupX = index * groupWidth + (groupWidth - barGroupWidth) / 2;
            return (
              <g key={`${label}-${index}`}>
                {visible.map((item, seriesIndex) => {
                  const value = item.values[index] ?? 0;
                  const barHeight = Math.max(value > 0 ? 2 : 0, (value / maxValue) * plotHeight);
                  const x = groupX + seriesIndex * (barWidth + gap);
                  const y = top + plotHeight - barHeight;
                  return (
                    <rect
                      key={item.key}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      rx={Math.min(3, barWidth / 2)}
                      fill={item.color}
                      opacity={selected === null || selected === index ? 1 : 0.4}
                    />
                  );
                })}
                <rect
                  x={index * groupWidth}
                  y={top}
                  width={groupWidth}
                  height={plotHeight}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelected((prev) => (prev === index ? null : index))}
                >
                  <title>{`${label}：${visible.map((item) => `${item.label} ${formatValue(item.values[index] ?? 0)}`).join("，")}`}</title>
                </rect>
                {labelIndexes.has(index) && (
                  <text
                    x={index * groupWidth + groupWidth / 2}
                    y={height - 6}
                    fontSize={9}
                    fill="var(--muted)"
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {visible.length === 0 && count > 0 && (
        <p className={cn("text-center text-[11px] text-muted")}>已隐藏全部系列，点按上方图例恢复</p>
      )}

      {selected !== null && count > 0 && (
        <ChartDetail title={labels[selected] ?? ""} rows={rows} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
