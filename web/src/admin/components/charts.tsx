/**
 * 管理后台图表组件（纯 SVG / CSS 手写，无第三方图表库）。
 * - BarChart：单指标柱状图（月交易额、每日交易额等）
 * - DualAxisTrendChart：交易额柱 + 订单数折线（双轴）
 * - DonutChart：支付方式占比环形图
 * - AmountDistributionChart：金额区间分布柱状图
 * - HourlyChart：0–23 时时段分布柱状图
 * - FunnelBars：转化漏斗（HTML 条形）
 * 宽度通过 ResizeObserver 自适应容器。
 * 交互：点击图例隐藏/显示系列或扇区，点击柱子 / 折线圆点 / 环形扇区查看该点明细；
 * 所有命中区同时支持键盘 Enter/Space 与 aria-label，选中项在图表下方展示明细卡。
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { formatCents, formatCentsCompact, formatNumber } from "../format";
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

/** 两位补零（时段标签用） */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/* ------------------------------------------------------------ 交互与明细 */

/** 选中项明细的一行 */
export interface ChartDetailRow {
  label: string;
  value: ReactNode;
}

/** 选中项明细内容 */
export interface ChartDetailContent {
  title: string;
  rows: ChartDetailRow[];
}

/** 命中区键盘激活（Enter / Space） */
function keyActivate<T extends Element>(handler: () => void) {
  return (event: KeyboardEvent<T>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  };
}

/** 图表下方「选中项明细」小卡（可关闭） */
function ChartDetail({
  content,
  onClose,
}: {
  content: ChartDetailContent;
  onClose: () => void;
}) {
  return (
    <div className="admin-chart-detail" role="status" aria-live="polite">
      <div className="admin-chart-detail-head">
        <span className="admin-chart-detail-title">{content.title}</span>
        <button
          type="button"
          className="admin-chart-detail-close"
          onClick={onClose}
          aria-label="关闭选中项明细"
          title="关闭明细"
        >
          ×
        </button>
      </div>
      <div className="admin-chart-detail-grid">
        {content.rows.map((row) => (
          <div className="admin-chart-detail-item" key={row.label}>
            <span className="admin-chart-detail-label">{row.label}</span>
            <span className="admin-chart-detail-value">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- 单系列柱状图内核 */

interface SingleBarChartProps {
  points: ChartPoint[];
  height: number;
  valueFormat: (value: number) => string;
  onSelect?: (point: ChartPoint) => void;
  selectedKey?: string | null;
  /** 关闭明细时回调（用于让父级清除选中态） */
  onClearSelect?: () => void;
  emptyText: string;
  ariaLabel: string;
  /** 计算 x 轴标签间隔（默认按可用宽度抽稀） */
  xLabelStep?: (plotWidth: number, total: number) => number;
  /** 是否强制显示最后一个刻度标签（默认 true） */
  showLastLabel?: boolean;
  /** 图表下方的坐标轴 / 口径说明 */
  axisNote?: ReactNode;
  /** 明细内容生成函数；不传则不展示明细卡 */
  detail?: (point: ChartPoint) => ChartDetailContent;
}

function SingleBarChart({
  points,
  height,
  valueFormat,
  onSelect,
  selectedKey,
  onClearSelect,
  emptyText,
  ariaLabel,
  xLabelStep,
  showLastLabel = true,
  axisNote,
  detail,
}: SingleBarChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const chartWidth = Math.max(width || 640, 300);
  const margin = { top: 18, right: 14, bottom: 30, left: 62 };
  const plotWidth = Math.max(chartWidth - margin.left - margin.right, 10);
  const plotHeight = Math.max(height - margin.top - margin.bottom, 10);

  if (points.length === 0) {
    return (
      <div
        className="admin-chart admin-empty"
        ref={ref}
        style={{ color: "var(--admin-text-muted)", padding: 36 }}
      >
        {emptyText}
      </div>
    );
  }

  const maxValue = niceCeil(Math.max(...points.map((point) => point.value), 1));
  const ticks = tickCount(4);
  const slot = plotWidth / points.length;
  const barWidth = Math.max(4, Math.min(42, slot * 0.56));
  const labelStep = Math.max(
    1,
    Math.floor(
      xLabelStep
        ? xLabelStep(plotWidth, points.length)
        : Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 52))),
    ),
  );
  const clickable = typeof onSelect === "function";
  const selectedPoint = points.find((point) => point.key === selectedKey) ?? null;
  const detailContent =
    selectedPoint !== null &&
    detail !== undefined &&
    dismissedKey !== selectedPoint.key
      ? detail(selectedPoint)
      : null;
  const closeDetail = () => {
    setDismissedKey(selectedPoint?.key ?? null);
    onClearSelect?.();
  };
  // 再次点击同一点时重新展开明细
  const activate = (point: ChartPoint) => {
    setDismissedKey(null);
    onSelect?.(point);
  };

  return (
    <div className="admin-chart" ref={ref}>
      <svg
        width={chartWidth}
        height={height}
        role={clickable ? "group" : "img"}
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
                className={cx(
                  "admin-chart-hit",
                  clickable && "admin-bar-clickable",
                )}
                onClick={clickable ? () => activate(point) : undefined}
                tabIndex={clickable ? 0 : undefined}
                role={clickable ? "button" : undefined}
                aria-label={
                  clickable
                    ? `查看 ${point.label}：${valueFormat(point.value)}`
                    : undefined
                }
                onKeyDown={
                  clickable ? keyActivate(() => activate(point)) : undefined
                }
              >
                <title>
                  {point.label}：{valueFormat(point.value)}
                  {typeof point.secondary === "number"
                    ? `／订单 ${point.secondary} 单`
                    : ""}
                </title>
              </rect>
              {index % labelStep === 0 ||
              (showLastLabel && index === points.length - 1) ? (
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
      {axisNote !== undefined ? (
        <div className="admin-chart-axis-note">{axisNote}</div>
      ) : null}
      {detailContent !== null ? (
        <ChartDetail content={detailContent} onClose={closeDetail} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 柱状图 */

export interface BarChartProps {
  points: ChartPoint[];
  height?: number;
  /** 数值格式化（默认金额紧凑格式） */
  valueFormat?: (value: number) => string;
  onSelect?: (point: ChartPoint) => void;
  selectedKey?: string | null;
  /** 关闭明细时回调（用于让父级清除选中态） */
  onClearSelect?: () => void;
  emptyText?: string;
  ariaLabel?: string;
}

export function BarChart({
  points,
  height = 230,
  valueFormat = formatCentsCompact,
  onSelect,
  selectedKey,
  onClearSelect,
  emptyText = "暂无数据",
  ariaLabel = "柱状图",
}: BarChartProps) {
  return (
    <SingleBarChart
      points={points}
      height={height}
      valueFormat={valueFormat}
      onSelect={onSelect}
      selectedKey={selectedKey}
      onClearSelect={onClearSelect}
      emptyText={emptyText}
      ariaLabel={ariaLabel}
      detail={(point) => ({
        title: point.label,
        rows: [
          { label: "数值", value: valueFormat(point.value) },
          ...(typeof point.secondary === "number"
            ? [
                {
                  label: "订单数",
                  value: `${formatNumber(point.secondary)} 单`,
                },
              ]
            : []),
        ],
      })}
    />
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
  /** 关闭明细时回调（用于让父级清除选中态） */
  onClearSelect?: () => void;
  emptyText?: string;
  ariaLabel?: string;
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
  onClearSelect,
  emptyText = "暂无数据",
  ariaLabel = "交易额与订单数双轴趋势图",
}: DualAxisTrendChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState({
    primary: false,
    secondary: false,
  });
  const showPrimary = !hidden.primary;
  const showSecondary = !hidden.secondary;
  const chartWidth = Math.max(width || 640, 300);
  const margin = { top: 18, right: 48, bottom: 30, left: 66 };
  const plotWidth = Math.max(chartWidth - margin.left - margin.right, 10);
  const plotHeight = Math.max(height - margin.top - margin.bottom, 10);

  if (points.length === 0) {
    return (
      <div
        className="admin-chart admin-empty"
        ref={ref}
        style={{ padding: 36, color: "var(--admin-text-muted)" }}
      >
        {emptyText}
      </div>
    );
  }

  // 最大值按可见系列重算：系列隐藏后其刻度不再显示
  const maxPrimary = showPrimary
    ? niceCeil(Math.max(...points.map((point) => point.value), 1))
    : 1;
  const maxSecondary = showSecondary
    ? niceCeil(Math.max(...points.map((point) => point.secondary ?? 0), 1))
    : 1;
  const ticks = tickCount(4);
  const slot = plotWidth / points.length;
  const barWidth = Math.max(4, Math.min(36, slot * 0.5));
  const labelStep = Math.max(
    1,
    Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 52))),
  );
  const clickable = typeof onSelect === "function";
  const selectedPoint = points.find((point) => point.key === selectedKey) ?? null;
  const detailContent =
    selectedPoint !== null && dismissedKey !== selectedPoint.key
      ? {
          title: selectedPoint.label,
          rows: [
            { label: "交易额", value: formatCents(selectedPoint.value) },
            {
              label: "订单数",
              value: `${formatNumber(selectedPoint.secondary ?? 0)} 单`,
            },
            {
              label: "客单价",
              value:
                (selectedPoint.secondary ?? 0) > 0
                  ? formatCents(selectedPoint.value / (selectedPoint.secondary ?? 1))
                  : "—",
            },
          ],
        }
      : null;
  const closeDetail = () => {
    setDismissedKey(selectedPoint?.key ?? null);
    onClearSelect?.();
  };
  // 再次点击同一点时重新展开明细
  const activate = (point: ChartPoint) => {
    setDismissedKey(null);
    onSelect?.(point);
  };

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
        role={clickable ? "group" : "img"}
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
              {showPrimary ? (
                <text x={margin.left - 8} y={y + 3.5} textAnchor="end">
                  {primaryFormat(maxPrimary * ratio)}
                </text>
              ) : null}
              {showSecondary ? (
                <text
                  x={chartWidth - margin.right + 8}
                  y={y + 3.5}
                  textAnchor="start"
                >
                  {secondaryFormat(maxSecondary * ratio)}
                </text>
              ) : null}
            </g>
          );
        })}

        {showPrimary
          ? points.map((point, index) => {
              const barHeight = (point.value / maxPrimary) * plotHeight;
              const x = margin.left + slot * index + (slot - barWidth) / 2;
              const y = margin.top + plotHeight - barHeight;
              const isSelected = selectedKey === point.key;
              return (
                <g key={`bar-${point.key}`}>
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
                    className={cx(
                      "admin-chart-hit",
                      clickable && "admin-bar-clickable",
                    )}
                    onClick={clickable ? () => activate(point) : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    role={clickable ? "button" : undefined}
                    aria-label={
                      clickable
                        ? `查看 ${point.label}：交易额 ${primaryFormat(point.value)}，订单 ${point.secondary ?? 0} 单`
                        : undefined
                    }
                    onKeyDown={
                      clickable ? keyActivate(() => activate(point)) : undefined
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
            })
          : points.map((point, index) =>
              index % labelStep === 0 || index === points.length - 1 ? (
                <text
                  key={`xlabel-${point.key}`}
                  x={margin.left + slot * index + slot / 2}
                  y={height - 9}
                  textAnchor="middle"
                >
                  {point.label}
                </text>
              ) : null,
            )}

        {showSecondary ? (
          <polyline
            points={linePoints}
            fill="none"
            style={{ stroke: "var(--admin-accent)" }}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {showSecondary
          ? points.map((point, index) => {
              const ratio = (point.secondary ?? 0) / maxSecondary;
              const x = margin.left + slot * index + slot / 2;
              const y = margin.top + plotHeight - ratio * plotHeight;
              const isSelected = selectedKey === point.key;
              return (
                <g key={`dot-${point.key}`}>
                  <circle
                    cx={x}
                    cy={y}
                    r={isSelected ? 4.2 : 2.6}
                    style={{
                      fill: "var(--admin-accent)",
                      stroke: "var(--admin-bg-elevated)",
                    }}
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={9}
                    className={cx(
                      "admin-chart-hit",
                      clickable && "admin-bar-clickable",
                    )}
                    onClick={clickable ? () => activate(point) : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    role={clickable ? "button" : undefined}
                    aria-label={
                      clickable
                        ? `查看 ${point.label}：订单 ${point.secondary ?? 0} 单`
                        : undefined
                    }
                    onKeyDown={
                      clickable ? keyActivate(() => activate(point)) : undefined
                    }
                  >
                    <title>
                      {point.label}：订单 {point.secondary ?? 0} 单／
                      {primaryFormat(point.value)}
                    </title>
                  </circle>
                </g>
              );
            })
          : null}
      </svg>
      <div className="admin-chart-legend">
        <button
          type="button"
          className={cx(
            "admin-legend-item",
            "admin-legend-toggle",
            hidden.primary && "is-off",
          )}
          onClick={() =>
            setHidden((prev) => ({ ...prev, primary: !prev.primary }))
          }
          aria-pressed={showPrimary}
          aria-label={`${showPrimary ? "隐藏" : "显示"}${primaryLabel}系列`}
        >
          <span
            className="admin-legend-swatch"
            style={{ background: "var(--admin-primary)" }}
          />
          {primaryLabel}
        </button>
        <button
          type="button"
          className={cx(
            "admin-legend-item",
            "admin-legend-toggle",
            hidden.secondary && "is-off",
          )}
          onClick={() =>
            setHidden((prev) => ({ ...prev, secondary: !prev.secondary }))
          }
          aria-pressed={showSecondary}
          aria-label={`${showSecondary ? "隐藏" : "显示"}${secondaryLabel}系列`}
        >
          <span
            className="admin-legend-swatch is-line"
            style={{ background: "var(--admin-accent)" }}
          />
          {secondaryLabel}
        </button>
      </div>
      {detailContent !== null ? (
        <ChartDetail content={detailContent} onClose={closeDetail} />
      ) : null}
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
  /** 图例行副标题（如「62 单 · ¥1,234.00」） */
  hint?: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
  /** 点击扇区回调（index 为原始 slices 下标） */
  onSelect?: (slice: DonutSlice, index: number) => void;
  selectedIndex?: number | null;
  emptyText?: string;
}

export function DonutChart({
  slices,
  size = 176,
  thickness = 26,
  centerLabel,
  centerValue,
  onSelect,
  selectedIndex = null,
  emptyText = "暂无支付方式数据",
}: DonutChartProps) {
  const [hiddenIndexes, setHiddenIndexes] = useState<number[]>([]);
  const total = slices.reduce(
    (sum, slice) => sum + (Number.isFinite(slice.value) ? slice.value : 0),
    0,
  );
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const clickable = typeof onSelect === "function";
  const isHidden = (index: number) => hiddenIndexes.includes(index);
  const visibleSlices = slices
    .map((slice, index) => ({ slice, index }))
    .filter(({ index }) => !isHidden(index));
  const visibleTotal = visibleSlices.reduce(
    (sum, { slice }) =>
      sum + (Number.isFinite(slice.value) ? slice.value : 0),
    0,
  );
  const selectedSlice =
    selectedIndex !== null &&
    selectedIndex >= 0 &&
    selectedIndex < slices.length &&
    !isHidden(selectedIndex)
      ? slices[selectedIndex]
      : undefined;
  const selectedRatio =
    selectedSlice !== undefined && visibleTotal > 0
      ? (selectedSlice.value / visibleTotal) * 100
      : 0;
  const toggleSlice = (index: number) => {
    setHiddenIndexes((prev) =>
      prev.includes(index)
        ? prev.filter((item) => item !== index)
        : [...prev, index],
    );
  };

  if (total <= 0) {
    return (
      <div
        className="admin-empty"
        style={{ padding: 30, color: "var(--admin-text-muted)" }}
      >
        {emptyText}
      </div>
    );
  }

  let offset = 0;

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
        role={clickable ? "group" : "img"}
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
        {visibleSlices.map(({ slice, index }) => {
          const ratio = visibleTotal > 0 ? slice.value / visibleTotal : 0;
          const length = ratio * circumference;
          const dashOffset = -offset;
          offset += length;
          const isSelected = selectedIndex === index;
          return (
            <circle
              key={`${slice.label}-${index}`}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              className={cx(
                "admin-donut-sector",
                clickable && "admin-bar-clickable",
              )}
              style={{
                stroke: slice.color ?? DONUT_COLORS[index % DONUT_COLORS.length],
                opacity: isSelected ? 1 : 0.9,
                transition: "stroke-dasharray .35s ease, stroke-width .18s ease",
              }}
              strokeWidth={isSelected ? thickness + 4 : thickness}
              strokeDasharray={`${Math.max(length, 0)} ${Math.max(
                circumference - length,
                0,
              )}`}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${center} ${center})`}
              onClick={clickable ? () => onSelect?.(slice, index) : undefined}
              tabIndex={clickable ? 0 : undefined}
              role={clickable ? "button" : undefined}
              aria-label={
                clickable
                  ? `${slice.label}：${slice.value} 单，占比 ${(
                      visibleTotal > 0
                        ? (slice.value / visibleTotal) * 100
                        : 0
                    ).toFixed(1)}%`
                  : undefined
              }
              onKeyDown={
                clickable ? keyActivate(() => onSelect?.(slice, index)) : undefined
              }
            >
              <title>
                {slice.label}：{slice.value} 单
              </title>
            </circle>
          );
        })}
        {selectedSlice !== undefined ? (
          <>
            <text
              x={center}
              y={center + 1}
              textAnchor="middle"
              style={{
                fill: "var(--admin-text)",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {selectedSlice.label}
            </text>
            <text
              x={center}
              y={center + 19}
              textAnchor="middle"
              style={{ fill: "var(--admin-text-muted)", fontSize: 11 }}
            >
              {`${selectedRatio.toFixed(1)}% · ${selectedSlice.value} 单`}
            </text>
          </>
        ) : (
          <>
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
          </>
        )}
      </svg>

      <div className="admin-donut-legend">
        {slices.map((slice, index) => {
          const hidden = isHidden(index);
          const ratio =
            visibleTotal > 0 && !hidden ? (slice.value / visibleTotal) * 100 : 0;
          return (
            <button
              type="button"
              className={cx(
                "admin-donut-legend-row",
                "admin-legend-item",
                "admin-legend-toggle",
                hidden && "is-off",
              )}
              key={`${slice.label}-${index}`}
              onClick={() => toggleSlice(index)}
              aria-pressed={!hidden}
              aria-label={`${hidden ? "显示" : "隐藏"} ${slice.label}`}
              title={`${hidden ? "显示" : "隐藏"} ${slice.label}`}
            >
              <span
                className="admin-legend-swatch"
                style={{
                  background:
                    slice.color ?? DONUT_COLORS[index % DONUT_COLORS.length],
                }}
              />
              <span className="admin-legend-text">
                <span>{slice.label}</span>
                {slice.hint !== undefined ? (
                  <span className="admin-legend-hint">{slice.hint}</span>
                ) : null}
              </span>
              <span className="admin-num">
                {hidden
                  ? "已隐藏"
                  : `${ratio.toFixed(1)}% · ${slice.value} 单`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ 金额区间分布图 */

/** 金额区间分布数据（与 AdminStats["amountDistribution"] 结构一致） */
export interface AmountDistributionItem {
  key: string;
  label: string;
  count: number;
  amountCents: number;
}

export interface AmountDistributionChartProps {
  items: AmountDistributionItem[];
  height?: number;
  onSelect?: (item: AmountDistributionItem) => void;
  selectedKey?: string | null;
  onClearSelect?: () => void;
  emptyText?: string;
}

export function AmountDistributionChart({
  items,
  height = 230,
  onSelect,
  selectedKey,
  onClearSelect,
  emptyText = "暂无金额分布数据",
}: AmountDistributionChartProps) {
  const points = items.map((item) => ({
    key: item.key,
    label: item.label,
    value: item.amountCents,
    secondary: item.count,
  }));
  const itemByKey = new Map(items.map((item) => [item.key, item]));

  return (
    <SingleBarChart
      points={points}
      height={height}
      valueFormat={formatCentsCompact}
      onSelect={
        onSelect === undefined
          ? undefined
          : (point) => {
              const item = itemByKey.get(point.key);
              if (item) onSelect(item);
            }
      }
      selectedKey={selectedKey}
      onClearSelect={onClearSelect}
      emptyText={emptyText}
      ariaLabel="金额区间分布"
      axisNote="柱高为该区间交易额；点击柱体查看该区间的单数与金额"
      detail={(point) => {
        const item = itemByKey.get(point.key);
        const count = item?.count ?? point.secondary ?? 0;
        const amount = item?.amountCents ?? point.value;
        return {
          title: point.label,
          rows: [
            { label: "订单数", value: `${formatNumber(count)} 单` },
            { label: "交易额", value: formatCents(amount) },
            {
              label: "客单价",
              value: count > 0 ? formatCents(amount / count) : "—",
            },
          ],
        };
      }}
    />
  );
}

/* ---------------------------------------------------------- 时段分布图 */

/** 时段分布数据（与 AdminStats["hourly"] 结构一致） */
export interface HourlyItem {
  hour: number;
  count: number;
  amountCents: number;
}

export interface HourlyChartProps {
  items: HourlyItem[];
  height?: number;
  onSelect?: (item: HourlyItem) => void;
  selectedHour?: number | null;
  onClearSelect?: () => void;
  emptyText?: string;
}

export function HourlyChart({
  items,
  height = 230,
  onSelect,
  selectedHour = null,
  onClearSelect,
  emptyText = "暂无时段分布数据",
}: HourlyChartProps) {
  const ordered = [...items].sort((a, b) => a.hour - b.hour);
  const points = ordered.map((item) => ({
    key: `hour-${item.hour}`,
    label: String(item.hour),
    value: item.amountCents,
    secondary: item.count,
  }));
  const itemByKey = new Map<string, HourlyItem>(
    ordered.map((item) => [`hour-${item.hour}`, item] as const),
  );
  const selectedKey = selectedHour === null ? null : `hour-${selectedHour}`;

  return (
    <SingleBarChart
      points={points}
      height={height}
      valueFormat={formatCentsCompact}
      onSelect={
        onSelect === undefined
          ? undefined
          : (point) => {
              const item = itemByKey.get(point.key);
              if (item) onSelect(item);
            }
      }
      selectedKey={selectedKey}
      onClearSelect={onClearSelect}
      emptyText={emptyText}
      ariaLabel="0 至 23 时交易时段分布"
      xLabelStep={() => 3}
      showLastLabel={false}
      axisNote="柱高为该时段交易额 · 横轴每 3 小时标一次"
      detail={(point) => {
        const item = itemByKey.get(point.key);
        const hour = item?.hour ?? Number(point.label);
        const count = item?.count ?? point.secondary ?? 0;
        const amount = item?.amountCents ?? point.value;
        return {
          title: `${pad2(hour)}:00–${pad2(hour)}:59`,
          rows: [
            { label: "订单数", value: `${formatNumber(count)} 单` },
            { label: "交易额", value: formatCents(amount) },
            {
              label: "客单价",
              value: count > 0 ? formatCents(amount / count) : "—",
            },
          ],
        };
      }}
    />
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
