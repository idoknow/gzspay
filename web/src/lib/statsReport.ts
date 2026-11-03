/** 交易统计报告画布：把汇总与两张图表画成一张图，用于导出 PNG / PDF（浏览器端）。 */

import { formatCents } from "./format";
import type { StatsBucket, StatsSummary } from "./types";

export interface StatsReportInput {
  rangeLabel: string;
  granularity: "day" | "month";
  includePending: boolean;
  summary: StatsSummary;
  buckets: StatsBucket[];
}

export interface StatsReportCanvas {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

const WIDTH = 880;
const SCALE = 2;
const PAD = 36;

const COLOR = {
  bg: "#f5f5f2",
  card: "#ffffff",
  line: "#e6e6e0",
  text: "#171a20",
  muted: "#6b6f7a",
  brand: "#1e6bff",
  accent: "#f0b21f",
  success: "#17996b",
  danger: "#d64545",
};

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif';

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

interface TextOptions {
  size?: number;
  weight?: number | string;
  color?: string;
  align?: CanvasTextAlign;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: TextOptions = {},
): void {
  ctx.font = `${options.weight ?? 400} ${options.size ?? 14}px ${FONT_STACK}`;
  ctx.fillStyle = options.color ?? COLOR.text;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

function card(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  roundedRect(ctx, x, y, width, height, 18);
  ctx.fillStyle = COLOR.card;
  ctx.fill();
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 紧凑金额：1.2万 / 3.4k / 88 */
function compactAmount(cents: number): string {
  const yuan = cents / 100;
  if (yuan >= 10000) return `${(yuan / 10000).toFixed(yuan >= 100000 ? 0 : 1)}万`;
  if (yuan >= 1000) return `${(Math.round(yuan / 100) / 10).toFixed(1)}k`;
  if (yuan >= 10) return String(Math.round(yuan));
  return yuan.toFixed(1);
}

function bucketLabel(key: string, granularity: "day" | "month"): string {
  if (granularity === "month") {
    const [, monthPart = ""] = key.split("-");
    return monthPart ? `${monthPart}月` : key;
  }
  const parts = key.split("-");
  if (parts.length >= 3) return `${parts[1]}-${parts[2]}`;
  return key;
}

function drawSummary(
  ctx: CanvasRenderingContext2D,
  top: number,
  summary: StatsSummary,
): number {
  const gap = 12;
  const cardHeight = 92;
  const cardWidth = (WIDTH - PAD * 2 - gap * 3) / 4;
  const items: { label: string; value: string; color: string }[] = [
    { label: "支出", value: `¥${formatCents(summary.expenseCents)}`, color: COLOR.text },
    { label: "收入", value: `¥${formatCents(summary.incomeCents)}`, color: COLOR.text },
    {
      label: "净额",
      value: `${summary.netCents < 0 ? "-" : "+"}¥${formatCents(Math.abs(summary.netCents))}`,
      color: summary.netCents >= 0 ? COLOR.success : COLOR.danger,
    },
    { label: "订单数", value: `${summary.orderCount} 笔`, color: COLOR.text },
  ];
  items.forEach((item, index) => {
    const x = PAD + index * (cardWidth + gap);
    card(ctx, x, top, cardWidth, cardHeight);
    drawText(ctx, item.label, x + 16, top + 32, { size: 13, color: COLOR.muted });
    drawText(ctx, item.value, x + 16, top + 66, { size: 21, weight: 700, color: item.color });
  });
  return top + cardHeight;
}

function drawBarChart(
  ctx: CanvasRenderingContext2D,
  top: number,
  buckets: StatsBucket[],
  granularity: "day" | "month",
): number {
  const height = 292;
  card(ctx, PAD, top, WIDTH - PAD * 2, height);
  const innerX = PAD + 20;
  const innerRight = WIDTH - PAD - 20;
  drawText(ctx, "收支对比", innerX, top + 34, { size: 16, weight: 700 });

  // 图例
  const legendY = top + 32;
  let legendX = innerRight - 150;
  ctx.fillStyle = COLOR.brand;
  roundedRect(ctx, legendX, legendY - 9, 10, 10, 3);
  ctx.fill();
  drawText(ctx, "支出", legendX + 16, legendY, { size: 12, color: COLOR.muted });
  legendX += 74;
  ctx.fillStyle = COLOR.accent;
  roundedRect(ctx, legendX, legendY - 9, 10, 10, 3);
  ctx.fill();
  drawText(ctx, "收入", legendX + 16, legendY, { size: 12, color: COLOR.muted });

  const plotX = innerX + 44;
  const plotY = top + 62;
  const plotWidth = innerRight - plotX;
  const plotHeight = height - 62 - 42;

  if (buckets.length === 0) {
    drawText(ctx, "该区间暂无交易", innerX, plotY + plotHeight / 2, { size: 14, color: COLOR.muted });
    return top + height;
  }

  const max = Math.max(1, ...buckets.flatMap((bucket) => [bucket.expenseCents, bucket.incomeCents]));
  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 1;
  for (const ratio of gridLines) {
    const y = plotY + plotHeight * (1 - ratio);
    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotWidth, y);
    ctx.stroke();
    drawText(ctx, compactAmount(max * ratio), plotX - 10, y + 4, {
      size: 11,
      color: COLOR.muted,
      align: "right",
    });
  }

  const groupWidth = plotWidth / buckets.length;
  const barWidth = Math.max(4, Math.min(18, groupWidth * 0.28));
  const labelStep = Math.max(1, Math.ceil(buckets.length / 7));
  buckets.forEach((bucket, index) => {
    const center = plotX + groupWidth * (index + 0.5);
    const expenseHeight = (bucket.expenseCents / max) * plotHeight;
    const incomeHeight = (bucket.incomeCents / max) * plotHeight;
    ctx.fillStyle = COLOR.brand;
    roundedRect(ctx, center - barWidth - 1.5, plotY + plotHeight - expenseHeight, barWidth, expenseHeight, 3);
    ctx.fill();
    ctx.fillStyle = COLOR.accent;
    roundedRect(ctx, center + 1.5, plotY + plotHeight - incomeHeight, barWidth, incomeHeight, 3);
    ctx.fill();
    if (index % labelStep === 0) {
      drawText(ctx, bucketLabel(bucket.key, granularity), center, plotY + plotHeight + 22, {
        size: 11,
        color: COLOR.muted,
        align: "center",
      });
    }
  });

  return top + height;
}

function drawLineChart(
  ctx: CanvasRenderingContext2D,
  top: number,
  buckets: StatsBucket[],
  granularity: "day" | "month",
): number {
  const height = 272;
  card(ctx, PAD, top, WIDTH - PAD * 2, height);
  const innerX = PAD + 20;
  const innerRight = WIDTH - PAD - 20;
  drawText(ctx, "累计趋势", innerX, top + 34, { size: 16, weight: 700 });

  const legendY = top + 32;
  let legendX = innerRight - 150;
  ctx.fillStyle = COLOR.brand;
  roundedRect(ctx, legendX, legendY - 9, 10, 10, 3);
  ctx.fill();
  drawText(ctx, "累计支出", legendX + 16, legendY, { size: 12, color: COLOR.muted });
  legendX += 96;
  ctx.fillStyle = COLOR.accent;
  roundedRect(ctx, legendX, legendY - 9, 10, 10, 3);
  ctx.fill();
  drawText(ctx, "累计收入", legendX + 16, legendY, { size: 12, color: COLOR.muted });

  const plotX = innerX + 44;
  const plotY = top + 62;
  const plotWidth = innerRight - plotX;
  const plotHeight = height - 62 - 38;

  if (buckets.length === 0) {
    drawText(ctx, "该区间暂无交易", innerX, plotY + plotHeight / 2, { size: 14, color: COLOR.muted });
    return top + height;
  }

  let expenseAcc = 0;
  let incomeAcc = 0;
  const expensePoints: { x: number; y: number }[] = [];
  const incomePoints: { x: number; y: number }[] = [];
  const totals = buckets.map((bucket) => {
    expenseAcc += bucket.expenseCents;
    incomeAcc += bucket.incomeCents;
    return { expense: expenseAcc, income: incomeAcc };
  });
  const max = Math.max(1, ...totals.flatMap((item) => [item.expense, item.income]));
  const stepX = buckets.length > 1 ? plotWidth / (buckets.length - 1) : 0;

  totals.forEach((item, index) => {
    const x = plotX + stepX * index;
    expensePoints.push({ x, y: plotY + plotHeight - (item.expense / max) * plotHeight });
    incomePoints.push({ x, y: plotY + plotHeight - (item.income / max) * plotHeight });
  });

  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 1;
  for (const ratio of [0, 0.5, 1]) {
    const y = plotY + plotHeight * (1 - ratio);
    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotWidth, y);
    ctx.stroke();
    drawText(ctx, compactAmount(max * ratio), plotX - 10, y + 4, {
      size: 11,
      color: COLOR.muted,
      align: "right",
    });
  }

  const strokeLine = (points: { x: number; y: number }[], color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    const last = points[points.length - 1];
    if (last) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  strokeLine(expensePoints, COLOR.brand);
  strokeLine(incomePoints, COLOR.accent);

  const labelStep = Math.max(1, Math.ceil(buckets.length / 7));
  buckets.forEach((bucket, index) => {
    if (index % labelStep !== 0) return;
    drawText(ctx, bucketLabel(bucket.key, granularity), plotX + stepX * index, plotY + plotHeight + 22, {
      size: 11,
      color: COLOR.muted,
      align: "center",
    });
  });

  return top + height;
}

/** 把统计结果画成一张报告图（2 倍像素密度，宽度 880 逻辑像素） */
export function renderStatsReport(input: StatsReportInput): StatsReportCanvas {
  // 先按固定高度估算，画完再按实际内容截取
  const headerHeight = 84;
  const summaryHeight = 92;
  const barHeight = 292;
  const lineHeight = 272;
  const footerHeight = 56;
  const gap = 16;
  const height =
    PAD + headerHeight + gap + summaryHeight + gap + barHeight + gap + lineHeight + gap + footerHeight + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(WIDTH * SCALE);
  canvas.height = Math.round(height * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持 Canvas 绘图");
  ctx.scale(SCALE, SCALE);

  // 背景
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, WIDTH, height);

  // 头部
  const markSize = 40;
  ctx.fillStyle = COLOR.brand;
  roundedRect(ctx, PAD, PAD, markSize, markSize, 11);
  ctx.fill();
  drawText(ctx, "g", PAD + markSize / 2, PAD + 28, {
    size: 26,
    weight: 800,
    color: "#ffffff",
    align: "center",
  });
  drawText(ctx, "gzspay 交易统计", PAD + markSize + 14, PAD + 26, { size: 24, weight: 700 });
  drawText(ctx, input.rangeLabel, PAD + markSize + 14, PAD + 46, { size: 13, color: COLOR.muted });
  const scope = input.includePending ? "含待确认订单" : "仅已完成订单";
  drawText(ctx, `${scope} · 按${input.granularity === "month" ? "月" : "日"}统计`, WIDTH - PAD, PAD + 46, {
    size: 12,
    color: COLOR.muted,
    align: "right",
  });

  let cursor = PAD + headerHeight + gap;
  cursor = drawSummary(ctx, cursor, input.summary) + gap;
  cursor = drawBarChart(ctx, cursor, input.buckets, input.granularity) + gap;
  cursor = drawLineChart(ctx, cursor, input.buckets, input.granularity) + gap;

  // 页脚
  drawText(ctx, "由 gzspay 校园收付款自动生成 · 统计口径以订单金额为准", PAD, cursor + 20, {
    size: 11,
    color: COLOR.muted,
  });
  drawText(ctx, new Date().toLocaleString("zh-CN", { hour12: false }), WIDTH - PAD, cursor + 20, {
    size: 11,
    color: COLOR.muted,
    align: "right",
  });

  return { canvas, width: WIDTH, height };
}

/** 画布 → PNG Blob */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("导出图片失败，请重试"));
    }, "image/png");
  });
}

/** 画布 → JPEG 字节（PDF 内嵌用） */
export function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.94): Uint8Array {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
