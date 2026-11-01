/**
 * 累计趋势折线图（纯 SVG）。
 * 传入的是每期数值，组件内部累加为累计值；点按图例隐藏系列，点按某一期查看明细。
 */

import { useState, type ReactNode } from "react";

import { ChartDetail, ChartLegend, pickLabelIndexes } from "./chartUi";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** 每期数值（非累计），与 labels 等长 */
  values: number[];
}

export interface ChartCumulativeProps {
  labels: string[];
  series: LineSeries[];
  formatValue: (value: number) => string;
  ariaLabel?: string;
  emptyText?: string;
  className?: string;
  height?: number;
}

const WIDTH = 360;

export function ChartCumulative({
  labels,
  series,
  formatValue,
  ariaLabel = "累计趋势图",
  emptyText = "该区间暂无数据",
  className,
  height = 176,
}: ChartCumulativeProps): ReactNode {
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const visible = series.filter((item) => !hiddenKeys.includes(item.key));
  const count = labels.length;
  const top = 18;
  const bottom = 22;
  const plotHeight = height - top - bottom;
  const stepX = count > 1 ? WIDTH / (count - 1) : 0;
  const labelIndexes = pickLabelIndexes(count, 6);

  const cumulative = visible.map((item) => {
    let total = 0;
    return item.values.map((value) => {
      total += value;
      return total;
    });
  });
  const maxValue = Math.max(1, ...cumulative.flat());
  const toY = (value: number): number => top + plotHeight * (1 - value / maxValue);
  const toX = (index: number): number => (count > 1 ? index * stepX : WIDTH / 2);

  const toggle = (key: string): void => {
    setHiddenKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
    setSelected(null);
  };

  const rows =
    selected === null
      ? []
      : visible.flatMap((item) => [
          {
            label: `${item.label}累计`,
            value: formatValue(item.values.slice(0, selected + 1).reduce((sum, value) => sum + value, 0)),
            strong: true,
          },
          { label: "当期", value: formatValue(item.values[selected] ?? 0) },
        ]);

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
            <line
              x1={toX(selected)}
              x2={toX(selected)}
              y1={top}
              y2={top + plotHeight}
              stroke="var(--brand)"
              strokeDasharray="3 3"
              strokeWidth={1}
              opacity={0.6}
            />
          )}

          {visible.map((item, seriesIndex) => {
            const points = (cumulative[seriesIndex] ?? [])
              .map((value, index) => `${toX(index)},${toY(value)}`)
              .join(" ");
            return (
              <g key={item.key}>
                <polyline
                  points={points}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={selected === null ? 1 : 0.85}
                />
                {(cumulative[seriesIndex] ?? []).map((value, index) => (
                  <circle
                    key={`${item.key}-${index}`}
                    cx={toX(index)}
                    cy={toY(value)}
                    r={selected === index ? 3.4 : 2}
                    fill="var(--surface)"
                    stroke={item.color}
                    strokeWidth={1.8}
                  />
                ))}
              </g>
            );
          })}

          {labels.map((label, index) => (
            <g key={`${label}-${index}`}>
              <rect
                x={toX(index) - stepX / 2}
                y={top}
                width={Math.max(stepX, 12)}
                height={plotHeight}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => setSelected((prev) => (prev === index ? null : index))}
              >
                <title>
                  {`${label}：${visible
                    .map((item) => `${item.label}累计 ${formatValue(item.values.slice(0, index + 1).reduce((sum, value) => sum + value, 0))}`)
                    .join("，")}`}
                </title>
              </rect>
              {labelIndexes.has(index) && (
                <text x={toX(index)} y={height - 6} fontSize={9} fill="var(--muted)" textAnchor="middle">
                  {label}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}

      {visible.length === 0 && count > 0 && (
        <p className="text-center text-[11px] text-muted">已隐藏全部系列，点按上方图例恢复</p>
      )}

      {selected !== null && count > 0 && (
        <ChartDetail title={labels[selected] ?? ""} rows={rows} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
