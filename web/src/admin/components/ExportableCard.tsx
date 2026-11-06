import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  exportChartCsv,
  exportChartJson,
  exportChartPng,
  exportChartSvg,
  type ChartCsv,
} from "../export";
import { Button, Card, cx } from "./ui";

interface ExportMenuProps {
  /** 图表容器，导出时在内部查找 <svg> */
  targetRef: RefObject<HTMLElement | null>;
  /** 导出文件名（不含扩展名与日期） */
  filename: string;
  /** CSV 数据；为空时不提供 CSV 导出 */
  csv?: ChartCsv;
  /** JSON 原始数据；为空时不提供 JSON 导出 */
  json?: unknown;
}

const DOWNLOAD_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M12 4v10m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2" strokeLinecap="round" />
  </svg>
);

/** 图表卡片右上角的导出菜单：PNG / SVG / CSV / JSON */
export function ChartExport({ targetRef, filename, csv, json }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const run = async (action: () => Promise<void> | void): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const svgOf = (): SVGSVGElement | null =>
    targetRef.current?.querySelector("svg") ?? null;

  const handle = (format: "png" | "svg" | "csv" | "json"): void => {
    if (format === "csv") {
      if (!csv) return;
      void run(() => exportChartCsv(csv, filename));
      return;
    }
    if (format === "json") {
      if (json === undefined) return;
      void run(() => exportChartJson(json, filename));
      return;
    }
    const svg = svgOf();
    if (!svg) {
      setError("没有找到图表，稍后再试");
      return;
    }
    void run(() =>
      format === "png" ? exportChartPng(svg, filename) : exportChartSvg(svg, filename),
    );
  };

  const items: Array<{ format: "png" | "svg" | "csv" | "json"; label: string; hint: string; disabled: boolean }> = [
    { format: "png", label: "PNG 图片", hint: "2 倍图", disabled: false },
    { format: "svg", label: "SVG 矢量图", hint: "矢量，可无损放大", disabled: false },
    { format: "csv", label: "CSV 表格", hint: "Excel 可直接打开", disabled: !csv },
    { format: "json", label: "JSON 数据", hint: "原始数据", disabled: json === undefined },
  ];

  return (
    <div className="admin-export" ref={rootRef}>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="导出图表"
      >
        {DOWNLOAD_ICON}
        导出
      </Button>
      {open ? (
        <div className="admin-export-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.format}
              type="button"
              role="menuitem"
              className={cx("admin-export-item", item.disabled && "is-disabled")}
              disabled={item.disabled || busy}
              onClick={() => handle(item.format)}
            >
              <span className="admin-export-item-label">{item.label}</span>
              <span className="admin-export-item-hint">{item.hint}</span>
            </button>
          ))}
          {error ? <div className="admin-export-error">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

interface ExportableCardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** 卡片原本的右上角内容（导出按钮会排在它前面） */
  extra?: ReactNode;
  flush?: boolean;
  className?: string;
  /** 导出文件名（不含扩展名与日期） */
  filename: string;
  csv?: ChartCsv;
  json?: unknown;
  children: ReactNode;
}

/**
 * 带「导出」菜单的图表卡片：自动包一层容器找到内部 <svg>，
 * 并把 CSV / JSON 数据传给导出菜单。
 */
export function ExportableCard({
  title,
  subtitle,
  extra,
  flush,
  className,
  filename,
  csv,
  json,
  children,
}: ExportableCardProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <Card
      title={title}
      subtitle={subtitle}
      flush={flush}
      className={className}
      extra={
        <div className="admin-card-tools">
          {extra}
          <ChartExport targetRef={bodyRef} filename={filename} csv={csv} json={json} />
        </div>
      }
    >
      <div ref={bodyRef}>{children}</div>
    </Card>
  );
}
