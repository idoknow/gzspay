/**
 * 管理后台图表组件（纯 SVG / CSS 手写，无第三方图表库）。
 * - BarChart：单指标柱状图（月交易额、每日交易额等）
 * - DualAxisTrendChart：交易额柱 + 订单数折线（双轴）
 * - DonutChart：支付方式占比环形图
 * - FunnelBars：转化漏斗（HTML 条形）
 * 宽度通过 ResizeObserver 自适应容器。
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { formatCentsCompact } from "../format";
import { cx } from "./ui";

export interface ChartPoint {
  key: string;
  label: string;
  value: number;
  /** 第二指标（如订单数），用于双轴图 */
  secondary?: number;
}

/* -------------------------------------------------------------- 尺寸测量 */

function useElementWidth<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  width: number;
} {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const next = element.clientWidth;
      if (next > 0) setWidth(next);
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/** 把最大值抬升到「好看」的刻度上限 */
function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const normalized = value / base;
  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 2.5) nice = 2.5;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

function tickCount(total: number): number {
  return total <= 0 ? 1 : Math.min(total, 4);
}

/* ------------------------------------------------------------------ 柱状图 */

export interface BarChartProps {
  points: ChartPoint[];
  height?: number;
  /** 数值格式化（默认金额紧凑格式） */
  valueFormat?: (value: number) => string;
  onSelect?: (point: ChartPoint) => void;
  selectedKey?: string | null;
  emptyText?: string;
  ariaLabel?: string;
}

export function BarChart({
  points,
  height = 230,
  valueFormat = formatCentsCompact,
  onSelect,
  selectedKey,
  emptyText = "暂无数据",
  ariaLabel = "柱状图",
}: BarChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const chartWidth = Math.max(width || 640, 300);
  const margin = { top: 18, right: 14, bottom: 30, left: 62 };
  const plotWidth = Math.max(chartWidth - margin.left - margin.right, 10);
  const plotHeight = Math.max(height - margin.top - margin.bottom, 10);

  if (points.length === 0) {
    return <div className="admin-msg admin-empty" style={{ color: "var(--admin-text-muted)", padding: 36 }}>{emptyText}</div>;
  }

  const maxValue = niceCeil(Math.max(...points.map((point) => point.value), 1));
  const ticks = tickCount(4);
  const slot = plotWidth / points.length;
  const barWidth = Math.max(4, Math.min(42, slot * 0.56));
  const labelStep = Math.max(
    1,
    Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 52))),
  );

  return (
    <div className="admin-chart" ref={ref}>
      <svg
        width={chartWidth}
        height={height}
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${chartWidth} ${height}`}
      >
        {Array.from({ length: ticks + 1 }, (_, index) => {
          const ratio = index / ticks;
          const y = margin.top + plotHeight - ratio * plotHeight;
          return (
            <g key={`grid-${index}`}>
              <line
                x1={margin.left}
                x2={chartWidth - margin.right}
                y1={y}
                y2={y}
                style={{ stroke: "var(--admin-border)" }}
                strokeWidth={1}
                strokeDasharray={index === 0 ? undefined : "3 4"}
              />
              <text x={margin.left - 8} y={y + 3.5} textAnchor="end">
                {valueFormat(maxValue * ratio)}
              </text>
            </g>
          );
        })}

        {points.map((point, index) => {
          const barHeight = (point.value / maxValue) * plotHeight;
          const x = margin.left + slot * index + (slot - barWidth) / 2;
          const y = margin.top + plotHeight - barHeight;
          const isSelected = selectedKey === point.key;
          const clickable = typeof onSelect === "function";
          return (
            <g key={point.key}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, point.value > 0 ? 2 : 0)}
                rx={Math.min(5, barWidth / 2)}
                style={{
                  fill: isSelected
                    ? "var(--admin-accent)"
                    : "var(--admin-primary)",
                  opacity: isSelected ? 1 : 0.82,
                }}
              />
              <rect
                x={margin.left + slot * index}
                y={margin.top}
                width={slot}
                height={plotHeight}
                fill="transparent"
                className={cx(clickable && "admin-bar-clickable")}
                onClick={clickable ? () => onSelect?.(point) : undefined}
                tabIndex={clickable ? 0 : undefined}
                role={clickable ? "button" : undefined}
                aria-label={clickable ? `查看 ${point.label}` : undefined}
                onKeyDown={
                  clickable
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect?.(point);
                        }
                      }
                    : undefined
                }
              >
                <title>
                  {point.label}：{valueFormat(point.value)}
                  {typeof point.secondary === "number"
                    ? `／订单 ${point.secondary} 单`
                    : ""}
                </title>
              </rect>
              {index % labelStep === 0 || index === points.length - 1 ? (
                <text
                  x={margin.left + slot * index + slot / 2}
                  y={height - 9}
                  textAnchor="middle"
                >
                  {point.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------- 双轴柱 + 折线 */

export interface DualAxisTrendChartProps {
  points: ChartPoint[];
  height?: number;
  primaryFormat?: (value: number) => string;
  secondaryFormat?: (value: number) => string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onSelect?: (point: ChartPoint) => void;
  selectedKey?: string | null;
  emptyText?: string;
}

export function DualAxisTrendChart({
  points,
  height = 250,
  primaryFormat = formatCentsCompact,
  secondaryFormat = (value) => `${Math.round(value)}`,
  primaryLabel = "交易额",
  secondaryLabel = "订单数",
  onSelect,
  selectedKey,
  emptyText = "暂无数据",
}: DualAxisTrendChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const chartWidth = Math.max(width || 640, 300);
  const margin = { top: 18, right: 48, bottom: 30, left: 66 };
  const plotWidth = Math.max(chartWidth - margin.left - margin.right, 10);
  const plotHeight = Math.max(height - margin.top - margin.bottom, 10);

  if (points.length === 0) {
    return (
      <div
        className="admin-empty"
        style={{ padding: 36, color: "var(--admin-text-muted)" }}
      >
        {emptyText}
      </div>
    );
  }

  const maxPrimary = niceCeil(
    Math.max(...points.map((point) => point.value), 1),
  );
  const maxSecondary = niceCeil(
    Math.max(...points.map((point) => point.secondary ?? 0), 1),
  );
  const ticks = tickCount(4);
  const slot = plotWidth / points.length;
  const barWidth = Math.max(4, Math.min(36, slot * 0.5));
  const labelStep = Math.max(
    1,
    Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 52))),
  );

  const linePoints = points
    .map((point, index) => {
      const ratio = (point.secondary ?? 0) / maxSecondary;
      const x = margin.left + slot * index + slot / 2;
      const y = margin.top + plotHeight - ratio * plotHeight;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="admin-chart" ref={ref}>
      <svg
        width={chartWidth}
        height={height}
        role="img"
        aria-label="交易趋势图"
        viewBox={`0 0 ${chartWidth} ${height}`}
      >
        {Array.from({ length: ticks + 1 }, (_, index) => {
          const ratio = index / ticks;
          const y = margin.top + plotHeight - ratio * plotHeight;
          return (
            <g key={`grid-${index}`}>
              <line
                x1={margin.left}
                x2={chartWidth - margin.right}
                y1={y}
                y2={y}
                style={{ stroke: "var(--admin-border)" }}
                strokeWidth={1}
                strokeDasharray={index === 0 ? undefined : "3 4"}
              />
              <text x={margin.left - 8} y={y + 3.5} textAnchor="end">
                {primaryFormat(maxPrimary * ratio)}
              </text>
              <text
                x={chartWidth - margin.right + 8}
                y={y + 3.5}
                textAnchor="start"
              >
                {secondaryFormat(maxSecondary * ratio)}
              </text>
            </g>
          );
        })}

        {points.map((point, index) => {
          const barHeight = (point.value / maxPrimary) * plotHeight;
          const x = margin.left + slot * index + (slot - barWidth) / 2;
          const y = margin.top + plotHeight - barHeight;
          const isSelected = selectedKey === point.key;
          const clickable = typeof onSelect === "function";
          return (
            <g key={point.key}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, point.value > 0 ? 2 : 0)}
                rx={Math.min(5, barWidth / 2)}
                style={{
                  fill: isSelected
                    ? "var(--admin-accent)"
                    : "var(--admin-primary)",
                  opacity: isSelected ? 1 : 0.8,
                }}
              />
              <rect
                x={margin.left + slot * index}
                y={margin.top}
                width={slot}
                height={plotHeight}
                fill="transparent"
                className={cx(clickable && "admin-bar-clickable")}
                onClick={clickable ? () => onSelect?.(point) : undefined}
                tabIndex={clickable ? 0 : undefined}
                role={clickable ? "button" : undefined}
                aria-label={clickable ? `查看 ${point.label}` : undefined}
                onKeyDown={
                  clickable
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect?.(point);
                        }
                      }
                    : undefined
                }
              >
                <title>
                  {point.label}：{primaryFormat(point.value)}／订单{" "}
                  {point.secondary ?? 0} 单
                </title>
              </rect>
              {index % labelStep === 0 || index === points.length - 1 ? (
                <text
                  x={margin.left + slot * index + slot / 2}
                  y={height - 9}
                  textAnchor="middle"
                >
                  {point.label}
                </text>
              ) : null}
            </g>
          );
        })}

        <polyline
          points={linePoints}
          fill="none"
          style={{ stroke: "var(--admin-accent)" }}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point, index) => {
          const ratio = (point.secondary ?? 0) / maxSecondary;
          const x = margin.left + slot * index + slot / 2;
          const y = margin.top + plotHeight - ratio * plotHeight;
          return (
            <circle
              key={`dot-${point.key}`}
              cx={x}
              cy={y}
              r={2.6}
              style={{ fill: "var(--admin-accent)", stroke: "var(--admin-bg-elevated)" }}
              strokeWidth={1.5}
            />
          );
        })}
      </svg>
      <div className="admin-chart-legend">
        <span className="admin-legend-item">
          <span
            className="admin-legend-swatch"
            style={{ background: "var(--admin-primary)" }}
          />
          {primaryLabel}
        </span>
        <span className="admin-legend-item">
          <span
            className="admin-legend-swatch is-line"
            style={{ background: "var(--admin-accent)" }}
          />
          {secondaryLabel}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- 环形图 */

const DONUT_COLORS = [
  "#1e6bff",
  "#f0b21f",
  "#17996b",
  "#8b5cf6",
  "#d64545",
  "#8f949d",
];

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}

export function DonutChart({
  slices,
  size = 176,
  thickness = 26,
  centerLabel,
  centerValue,
}: DonutChartProps) {
  const total = slices.reduce(
    (sum, slice) => sum + (Number.isFinite(slice.value) ? slice.value : 0),
    0,
  );
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  let offset = 0;

  if (total <= 0) {
    return (
      <div
        className="admin-empty"
        style={{ padding: 30, color: "var(--admin-text-muted)" }}
      >
        暂无支付方式数据
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
        flexWrap: "wrap",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="支付方式占比环形图"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          style={{ stroke: "var(--admin-bg-soft)" }}
          strokeWidth={thickness}
        />
        {slices.map((slice, index) => {
          const ratio = slice.value / total;
          const length = ratio * circumference;
          const dashOffset = -offset;
          offset += length;
          return (
            <circle
              key={`${slice.label}-${index}`}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              style={{
                stroke: slice.color ?? DONUT_COLORS[index % DONUT_COLORS.length],
                transition: "stroke-dasharray .35s ease",
              }}
              strokeWidth={thickness}
              strokeDasharray={`${Math.max(length, 0)} ${Math.max(
                circumference - length,
                0,
              )}`}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${center} ${center})`}
            />
          );
        })}
        {centerValue !== undefined ? (
          <text
            x={center}
            y={center + 2}
            textAnchor="middle"
            style={{
              fill: "var(--admin-text)",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {centerValue}
          </text>
        ) : null}
        {centerLabel !== undefined ? (
          <text
            x={center}
            y={center + 20}
            textAnchor="middle"
            style={{ fill: "var(--admin-text-muted)", fontSize: 11 }}
          >
            {centerLabel}
          </text>
        ) : null}
      </svg>

      <div className="admin-donut-legend">
        {slices.map((slice, index) => {
          const ratio = total > 0 ? (slice.value / total) * 100 : 0;
          return (
            <div className="admin-donut-legend-row" key={`${slice.label}-${index}`}>
              <span
                className="admin-legend-swatch"
                style={{
                  background:
                    slice.color ?? DONUT_COLORS[index % DONUT_COLORS.length],
                }}
              />
              <span>{slice.label}</span>
              <span className="admin-num">
                {ratio.toFixed(1)}% · {slice.value} 单
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- 转化漏斗 */

export interface FunnelBarItem {
  key: string;
  label: string;
  count: number;
}

export function FunnelBars({ steps }: { steps: FunnelBarItem[] }) {
  if (steps.length === 0) {
    return (
      <div
        className="admin-empty"
        style={{ padding: 30, color: "var(--admin-text-muted)" }}
      >
        暂无漏斗数据
      </div>
    );
  }
  const base = Math.max(steps[0]?.count ?? 1, 1);
  return (
    <div className="admin-funnel">
      {steps.map((step, index) => {
        const percent = (step.count / base) * 100;
        const previous = index > 0 ? steps[index - 1]?.count ?? 0 : null;
        const conversion =
          previous !== null && previous > 0
            ? (step.count / previous) * 100
            : null;
        return (
          <div className="admin-funnel-step" key={step.key}>
            <div className="admin-funnel-head">
              <span className="admin-funnel-label">{step.label}</span>
              <span className="admin-funnel-count">
                {step.count.toLocaleString("zh-CN")} 单
              </span>
              <span className="admin-funnel-rate">
                {conversion !== null
                  ? `上一步转化 ${conversion.toFixed(1)}%`
                  : "100%"}
              </span>
            </div>
            <div className="admin-funnel-track">
              <div
                className="admin-funnel-bar"
                style={{ width: `${Math.max(percent, step.count > 0 ? 2 : 0)}%` }}
                title={`${step.label}：${step.count} 单`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
