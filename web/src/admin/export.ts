/**
 * 管理后台图表导出：把页面上的手写 SVG 图表导出为 PNG / SVG / CSV / JSON。
 *
 * 图表样式大量使用 CSS 变量与类名（`var(--admin-primary)` 等），直接序列化 SVG
 * 离开文档后会丢样式，因此导出前会把计算样式内联到克隆节点上。
 * 不引入第三方依赖：PNG 走 canvas，CSV 手写转义并加 BOM（Excel 打开不乱码）。
 */

export type ExportFormat = "png" | "svg" | "csv" | "json";

export interface ChartCsv {
  headers: string[];
  rows: Array<Array<string | number>>;
}

/** 需要从计算样式复制到 SVG 的内联属性 */
const SVG_STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "paint-order",
];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 文件名后缀：20261103 */
export function dateStamp(date = new Date()): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function withStamp(filename: string): string {
  const clean = filename.replace(/[\\/:*?"<>|]+/g, "-").trim() || "chart";
  return `${clean}-${dateStamp()}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 部分浏览器会在 click 后才真正读取，延迟回收
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 把图表 SVG 克隆出来，并把当前计算样式内联，保证独立打开时样式正确 */
export function cloneSvgWithStyles(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const copies = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const removable: Element[] = [];

  originals.forEach((element, index) => {
    const target = copies[index];
    if (!target) return;
    // 透明点击热区不进入导出图片
    if (target.classList.contains("admin-chart-hit")) {
      removable.push(target);
      return;
    }
    const computed = window.getComputedStyle(element);
    const declarations = SVG_STYLE_PROPS.map((prop) => {
      const value = computed.getPropertyValue(prop);
      return value ? `${prop}:${value}` : "";
    })
      .filter(Boolean)
      .join(";");
    if (declarations) target.setAttribute("style", declarations);
    target.removeAttribute("class");
    target.removeAttribute("tabindex");
  });

  removable.forEach((element) => element.remove());

  const rect = svg.getBoundingClientRect();
  const width = Math.max(Math.round(rect.width || svg.clientWidth || 720), 1);
  const height = Math.max(Math.round(rect.height || svg.clientHeight || 260), 1);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return clone;
}

function svgToDataUrl(svg: SVGSVGElement): string {
  const xml = new XMLSerializer().serializeToString(svg);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}

/** 导出 PNG 图片（默认 2 倍图，白底，避免深色主题导出透明底） */
export async function exportChartPng(
  svg: SVGSVGElement,
  filename: string,
  scale = 2,
): Promise<void> {
  const clone = cloneSvgWithStyles(svg);
  const width = Number(clone.getAttribute("width")) || 720;
  const height = Number(clone.getAttribute("height")) || 260;

  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图表渲染失败"));
    image.src = svgToDataUrl(clone);
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持导出图片");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/png");
  });
  if (!blob) throw new Error("图表导出失败，请重试");
  downloadBlob(blob, `${withStamp(filename)}.png`);
}

/** 导出 SVG 矢量图 */
export function exportChartSvg(svg: SVGSVGElement, filename: string): void {
  const clone = cloneSvgWithStyles(svg);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
  downloadBlob(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }), `${withStamp(filename)}.svg`);
}

function escapeCsvCell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 导出 CSV 表格（带 BOM，Excel 打开不乱码） */
export function exportChartCsv(csv: ChartCsv, filename: string): void {
  const lines = [csv.headers, ...csv.rows].map((row) => row.map(escapeCsvCell).join(","));
  downloadBlob(
    new Blob([`\ufeff${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" }),
    `${withStamp(filename)}.csv`,
  );
}

/** 导出 JSON 原始数据 */
export function exportChartJson(data: unknown, filename: string): void {
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }),
    `${withStamp(filename)}.json`,
  );
}
