/**
 * 环形占比图（纯 SVG）。
 * 交互：点按图例隐藏 / 恢复分类（占比按可见合计重新计算），点按扇区查看明细。
 */

import { useState, type ReactNode } from "react";

import { ChartLegend } from "./chartUi";

export interface DonutItem {
  key: string;
  label: string;
  color: string;
  /** 用于计算占比的数值 */
  value: number;
  /** 明细里的补充说明（例如「N 笔」） */
  note?: string;
}

export interface ChartDonutProps {
  items: DonutItem[];
  formatValue: (value: number) => string;
  centerLabel?: string;
  ariaLabel?: string;
  emptyText?: string;
  className?: string;
}

const SIZE = 168;
const THICKNESS = 26;
const RADIUS = (SIZE - THICKNESS) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ChartDonut({
  items,
  formatValue,
  centerLabel = "合计",
  ariaLabel = "占比图",
  emptyText = "该区间暂无数据",
  className,
}: ChartDonutProps): ReactNode {
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const visible = items.filter((item) => !hiddenKeys.includes(item.key));
  const total = visible.reduce((sum, item) => sum + item.value, 0);
  const selected = items.find((item) => item.key === selectedKey) ?? null;
  const selectedPercent = selected && total > 0 ? (selected.value / total) * 100 : 0;

  const toggle = (key: string): void => {
    setHiddenKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
    setSelectedKey(null);
  };

  let offset = 0;
  const arcs = visible.map((item) => {
    const ratio = total > 0 ? item.value / total : 0;
    const length = Math.max(0, ratio * CIRCUMFERENCE - 2);
    const arc = { item, ratio, length, offset };
    offset += ratio * CIRCUMFERENCE;
    return arc;
  });

  return (
    <div className={className}>
      <ChartLegend
        items={items.map((item) => ({
          key: item.key,
          label: item.label,
          color: item.color,
          hidden: hiddenKeys.includes(item.key),
        }))}
        onToggle={toggle}
      />

      {total <= 0 ? (
        <p className="py-8 text-center text-xs text-muted">{emptyText}</p>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <svg
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              role="img"
              aria-label={ariaLabel}
              className="h-[168px] w-[168px]"
            >
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="var(--surface-2)"
                strokeWidth={THICKNESS}
              />
              {arcs.map(({ item, length, offset: arcOffset }) => (
                <circle
                  key={item.key}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={selected?.key === item.key ? THICKNESS + 5 : THICKNESS}
                  strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                  strokeDashoffset={-arcOffset}
                  strokeLinecap="butt"
                  transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                  opacity={selected === null || selected.key === item.key ? 1 : 0.45}
                  style={{ cursor: "pointer", transition: "stroke-width 160ms ease, opacity 160ms ease" }}
                  onClick={() => setSelectedKey((prev) => (prev === item.key ? null : item.key))}
                >
                  <title>{`${item.label}：${formatValue(item.value)}`}</title>
                </circle>
              ))}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] text-muted">
                {selected ? `${selectedPercent.toFixed(1)}%` : centerLabel}
              </span>
              <span className="text-[13px] font-semibold text-text">
                {formatValue(selected ? selected.value : total)}
              </span>
            </div>
          </div>

          <div className="w-full space-y-1">
            {items.map((item) => {
              const isHidden = hiddenKeys.includes(item.key);
              const percent = total > 0 && !isHidden ? (item.value / total) * 100 : 0;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggle(item.key)}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-surface-2 active:scale-[0.995]"
                  aria-pressed={!isHidden}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ background: item.color, opacity: isHidden ? 0.35 : 1 }}
                  />
                  <span className={isHidden ? "text-[11.5px] text-muted line-through" : "text-[11.5px] text-text"}>
                    {item.label}
                  </span>
                  {item.note && <span className="text-[10px] text-muted">{item.note}</span>}
                  <span className="ml-auto text-[11.5px] font-medium text-text">
                    {formatValue(item.value)}
                  </span>
                  <span className="w-11 text-right text-[10.5px] text-muted">
                    {isHidden ? "已隐藏" : `${percent.toFixed(1)}%`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
