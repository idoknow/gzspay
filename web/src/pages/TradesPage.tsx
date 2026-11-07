/** 交易页：我发起的 / 我收到的 + 关键词搜索 + 状态筛选（全部 / 进行中 / 已结束，点按钮弹出菜单）+ 订单列表 + 公告红点 + 空态。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnnouncementBell } from "../components/AnnouncementBell";
import { Avatar } from "../components/Avatar";
import { BottomNav } from "../components/BottomNav";
import { useCopy, useContextMenus, type ContextMenuItem } from "../components/ContextMenu";
import { CopyIcon, DownloadIcon, OpenIcon, PrintIcon } from "../components/ContextMenuIcons";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock, Spinner } from "../components/Loading";
import { Logo } from "../components/Logo";
import { OrderCard } from "../components/OrderCard";
import { useToast } from "../components/Toast";
import {
  exportOrdersBlob,
  listOrders,
  subscribeEvents,
  uploadMerchantBill,
} from "../lib/api";
import { downloadBlob, safeFilename } from "../lib/download";
import { errorMessage } from "../lib/http";
import {
  EXPORT_RANGE_OPTIONS,
  cn,
  exportRangeBounds,
  exportRangeLabel,
  formatCents,
  formatDateTime,
  type ExportDateRange,
} from "../lib/format";
import { useDebouncedValue, useWatchLayout } from "../lib/hooks";
import { useAuth } from "../lib/session";
import type { BillImportDetail, Order } from "../lib/types";

type Scope = "pay" | "receive";
type StatusFilter = "all" | "pending" | "settled";

const PAGE_SIZE = 20;

const SCOPE_LABELS: Record<Scope, string> = { pay: "我发起的", receive: "我收到的" };
/** 「我发起的 / 我收到的」下面分三项，点按钮才展开菜单选择 */
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "进行中" },
  { value: "settled", label: "已结束" },
];
const STATUS_LABELS: Record<StatusFilter, string> = { all: "全部", pending: "进行中", settled: "已结束" };
const EMPTY_TEXT: Record<Scope, Record<StatusFilter, string>> = {
  pay: { all: "暂无订单", pending: "暂无进行中的订单", settled: "暂无已结束的订单" },
  receive: { all: "暂无订单", pending: "暂无进行中的订单", settled: "暂无已结束的订单" },
};

function ChevronIcon({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("transition-transform", open && "rotate-180")}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("mt-0.5 shrink-0", className)}
    >
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function TradesPage(): ReactNode {
  const navigate = useNavigate();
  const watch = useWatchLayout();
  const toast = useToast();
  const { me } = useAuth();
  const [scope, setScope] = useState<Scope>("pay");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState<"csv" | "xlsx" | "json" | null>(null);
  const [exportRange, setExportRange] = useState<ExportDateRange>("today");
  const [search, setSearch] = useState("");
  const keyword = useDebouncedValue(search.trim(), 300);
  const [billUploading, setBillUploading] = useState(false);
  const [billDetail, setBillDetail] = useState<BillImportDetail | null>(null);
  const [billDetailOpen, setBillDetailOpen] = useState(false);
  const billInputRef = useRef<HTMLInputElement | null>(null);

  const handleBillFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBillUploading(true);
    try {
      const detail = await uploadMerchantBill(file);
      setBillDetail(detail);
      setBillDetailOpen(true);
      toast.success(
        `已解析 ${detail.transactionCount} 笔，匹配 ${detail.matchedCount} 笔`,
      );
      setOrders([]);
      setPage(1);
      setReloadKey((value) => value + 1);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBillUploading(false);
      if (billInputRef.current) billInputRef.current.value = "";
    }
  };

  const handleExport = async (format: "csv" | "xlsx" | "json"): Promise<void> => {
    setExportBusy(format);
    try {
      const range = exportRangeBounds(exportRange);
      const blob = await exportOrdersBlob({
        format,
        scope,
        status,
        q: keyword || undefined,
        ...range,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const rangeText = `-${exportRangeLabel(exportRange)}`;
      downloadBlob(blob, safeFilename(`gzspay-账单-${stamp}${rangeText}.${format}`));
      toast.success("账单已导出");
      setExportOpen(false);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setExportBusy(null);
    }
  };

  /** PDF 用浏览器打印生成：中文可正常显示，也不留服务端临时文件 */
  const handlePrintPdf = (): void => {
    setExportOpen(false);
    const params = new URLSearchParams({ scope, status });
    if (keyword) params.set("q", keyword);
    const range = exportRangeBounds(exportRange);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    navigate(`/orders/print?${params.toString()}`);
  };

  const copy = useCopy();

  // 右键 / 长按菜单：订单卡片、导出按钮、对账上传卡
  useContextMenus({
    "trades.order": (element) => {
      const order = orders.find((item) => item.id === element.dataset.menuId);
      if (!order) return null;
      const name =
        order.counterparty?.displayName ||
        (order.role === "payer" ? order.merchantName : order.payerNameSnapshot) ||
        "对方";
      const items: ContextMenuItem[] = [
        { label: "查看订单详情", icon: <OpenIcon />, onSelect: () => navigate(`/orders/${order.id}`) },
        { type: "separator" },
        { label: "复制订单号", icon: <CopyIcon />, onSelect: () => void copy(order.orderNo, "订单号") },
        {
          label: "复制金额",
          icon: <CopyIcon />,
          onSelect: () => void copy(`¥${formatCents(order.amountCents)}`, "金额"),
        },
        { label: "复制对方姓名", icon: <CopyIcon />, onSelect: () => void copy(name, "姓名") },
      ];
      if (order.reservedNote) {
        items.push({
          label: "复制商家备注",
          icon: <CopyIcon />,
          onSelect: () => void copy(order.reservedNote ?? "", "备注"),
        });
      }
      return items;
    },
    "trades.export": () => [
      { label: "导出 CSV", icon: <DownloadIcon />, hint: exportRangeLabel(exportRange), onSelect: () => void handleExport("csv") },
      { label: "导出 Excel", icon: <DownloadIcon />, onSelect: () => void handleExport("xlsx") },
      { label: "导出 JSON", icon: <DownloadIcon />, onSelect: () => void handleExport("json") },
      { type: "separator" },
      { label: "打印为 PDF", icon: <PrintIcon />, onSelect: handlePrintPdf },
    ],
    "trades.bill": () => [
      { label: "上传账单对账", icon: <DownloadIcon />, onSelect: () => billInputRef.current?.click() },
      ...(billDetail
        ? [
            {
              label: "查看本次对账结果",
              icon: <OpenIcon />,
              onSelect: () => setBillDetailOpen(true),
            } satisfies ContextMenuItem,
          ]
        : []),
    ],
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listOrders({ scope, status, q: keyword || undefined, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (!active) return;
        setOrders((previous) => (page === 1 ? result.items : [...previous, ...result.items]));
        setTotal(result.total);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, status, page, reloadKey, keyword]);

  // 关键词变化时回到第一页并清空当前列表
  useEffect(() => {
    setOrders([]);
    setTotal(0);
    setPage(1);
  }, [keyword]);

  // 服务端事件：订单状态变化后刷新列表（回到第一页）
  useEffect(() => {
    return subscribeEvents({
      onOrderUpdate: () => {
        setOrders([]);
        setPage(1);
        setReloadKey((value) => value + 1);
      },
    });
  }, []);

  const changeScope = (next: Scope): void => {
    setFilterOpen(false);
    if (next === scope) return;
    setOrders([]);
    setTotal(0);
    setPage(1);
    setScope(next);
  };

  const changeStatus = (next: StatusFilter): void => {
    setFilterOpen(false);
    if (next === status) return;
    setOrders([]);
    setTotal(0);
    setPage(1);
    setStatus(next);
  };

  const hasMore = orders.length < total;

  return (
    <div className="bg-app min-h-[100dvh] overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-line glass safe-top">
        <div className="page flex items-center justify-between py-3 watch:py-2">
          <Logo size={watch ? 26 : 30} wordmark />
          <div className="flex items-center gap-2 watch:gap-1.5">
            <AnnouncementBell />
            <button type="button" aria-label="我的" className="rounded-full" onClick={() => navigate("/me")}>
              <Avatar name={me?.displayName ?? "我"} avatarUrl={me?.avatarUrl ?? null} size={watch ? 28 : 34} />
            </button>
          </div>
        </div>
      </header>

      <main className="page page-with-nav pt-4 watch:pt-3">
        <div className="segmented" role="tablist" aria-label="订单方向">
          <span
            aria-hidden="true"
            className="segmented-thumb left-1"
            style={{
              width: "calc(50% - 4px)",
              transform: scope === "pay" ? "translateX(0%)" : "translateX(100%)",
            }}
          />
          {(Object.keys(SCOPE_LABELS) as Scope[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={scope === item}
              onClick={() => changeScope(item)}
              className={cn("segmented-item", scope === item && "segmented-item-active")}
            >
              {SCOPE_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2 watch:mt-2.5">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted watch:left-2.5" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题、订单号或姓名"
              aria-label="搜索订单"
              className="input h-[34px] w-full rounded-full pr-9 pl-9 text-sm watch:h-[30px] watch:pr-8 watch:pl-8 watch:text-[12px]"
            />
            {search ? (
              <button
                type="button"
                aria-label="清除搜索"
                onClick={() => setSearch("")}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-1 text-muted transition hover:text-text"
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
              className={cn(
                "inline-flex min-h-[34px] items-center gap-1.5 rounded-full border bg-surface px-3.5 py-1.5 text-sm font-medium text-text transition watch:min-h-[30px] watch:px-2.5 watch:py-1 watch:text-[12px]",
                filterOpen ? "border-[color:var(--text)]" : "border-line",
                "shadow-[var(--shadow-xs)]",
              )}
            >
              {STATUS_LABELS[status]}
              <ChevronIcon open={filterOpen} />
            </button>
            {filterOpen ? (
              <>
                <button
                  type="button"
                  aria-label="关闭筛选菜单"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setFilterOpen(false)}
                />
                <div
                  role="menu"
                  aria-label="订单状态筛选"
                  className="absolute top-full right-0 z-40 mt-2 w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-surface p-1 shadow-[var(--shadow-float)] watch:mt-1.5 watch:w-44 watch:p-0.5"
                >
                  {STATUS_OPTIONS.map((option) => {
                    const active = option.value === status;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => changeStatus(option.value)}
                        className={cn(
                          "flex w-full items-start justify-between gap-2 rounded-xl px-3 py-2 text-left text-text transition watch:px-2.5 watch:py-1.5",
                          active ? "bg-surface-2" : "hover:bg-surface-2",
                        )}
                      >
                        <span className="block text-sm font-semibold watch:text-[13px]">{option.label}</span>
                        {active ? <CheckIcon className="text-brand" /> : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            data-menu="trades.export"
            className="inline-flex min-h-[34px] shrink-0 items-center rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-text shadow-[var(--shadow-xs)] transition watch:min-h-[30px] watch:px-2.5 watch:text-[12px]"
          >
            导出
          </button>
        </div>

        {scope === "receive" ? (
          <section className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-[var(--shadow-xs)] watch:mt-3 watch:px-3 watch:py-2">
            <h2 className="text-sm font-semibold text-text watch:text-[13px]">收款自动对账</h2>
            <button
              type="button"
              disabled={billUploading}
              onClick={() => billInputRef.current?.click()}
              data-menu="trades.bill"
              className="btn btn-secondary btn-sm shrink-0"
            >
              {billUploading ? "正在解析…" : "上传账单"}
            </button>
            <input
              ref={billInputRef}
              type="file"
              accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(event) => {
                void handleBillFile(event.target.files?.[0]);
              }}
            />
          </section>
        ) : null}

        {keyword ? (
          <p className="mt-3 text-[11px] text-muted watch:mt-2 watch:text-[10px]">
            {loading && orders.length === 0 ? "正在搜索…" : `「${keyword}」找到 ${total} 笔订单`}
          </p>
        ) : null}

        <div className="mt-4 watch:mt-3">
          {error && orders.length === 0 ? (
            <ErrorBlock
              message={error}
              onRetry={() => {
                setReloadKey((value) => value + 1);
              }}
            />
          ) : loading && orders.length === 0 ? (
            <LoadingBlock text={keyword ? "正在搜索订单…" : "正在加载订单…"} />
          ) : orders.length === 0 ? (
            keyword ? (
              <EmptyState
                title="没有找到相关订单"
                description={`没有匹配「${keyword}」的订单`}
                action={
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSearch("")}>
                    清除搜索
                  </button>
                }
              />
            ) : (
              <EmptyState
                title={EMPTY_TEXT[scope][status]}
                description="扫码创建订单后显示在这里"
                action={
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate("/pay")}>
                    去扫码
                  </button>
                }
              />
            )
          ) : (
            <div className="space-y-3 watch:space-y-2">
              {orders.map((order, index) => (
                <div
                  key={order.id}
                  className="animate-slide-up"
                  style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                >
                  <OrderCard
                    order={order}
                    menuKey="trades.order"
                    onClick={() => navigate(`/orders/${order.id}`)}
                  />
                </div>
              ))}
              {hasMore ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  disabled={loading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  {loading ? <Spinner size={18} /> : null}
                  加载更多
                </button>
              ) : orders.length > 0 ? (
                <p className="pt-1 text-center text-[11px] text-muted">没有更多了</p>
              ) : null}
              {error ? (
                <p className="pt-1 text-center text-xs text-danger">
                  {error}
                  <button
                    type="button"
                    className="ml-2 font-semibold text-brand"
                    onClick={() => setReloadKey((value) => value + 1)}
                  >
                    重试
                  </button>
                </p>
              ) : null}
            </div>
          )}
        </div>
      </main>

      <Dialog
        open={exportOpen}
        onClose={() => {
          if (!exportBusy) setExportOpen(false);
        }}
        title="导出账单"
        description={`${SCOPE_LABELS[scope]} · ${STATUS_LABELS[status]} · ${exportRangeLabel(exportRange)}${keyword ? ` · 「${keyword}」` : ""}`}
      >
        <p className="mb-2 text-xs text-muted">时间范围</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {EXPORT_RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                exportRange === option.value
                  ? "border-transparent bg-brand text-white"
                  : "border-line bg-surface-2 text-muted hover:text-text",
              )}
              disabled={exportBusy !== null}
              onClick={() => setExportRange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { format: "csv" as const, label: "CSV" },
              { format: "xlsx" as const, label: "Excel" },
              { format: "json" as const, label: "JSON" },
            ]
          ).map((item) => (
            <button
              key={item.format}
              type="button"
              className="card flex flex-col items-start gap-1 p-3 text-left"
              disabled={exportBusy !== null}
              onClick={() => void handleExport(item.format)}
            >
              <span className="text-sm font-semibold text-text">
                {exportBusy === item.format ? "正在导出…" : item.label}
              </span>
            </button>
          ))}
          <button
            type="button"
            className="card flex flex-col items-start gap-1 p-3 text-left"
            disabled={exportBusy !== null}
            onClick={handlePrintPdf}
          >
            <span className="text-sm font-semibold text-text">PDF</span>
          </button>
        </div>
      </Dialog>

      <Dialog
        open={billDetailOpen}
        onClose={() => {
          setBillDetailOpen(false);
          setBillDetail(null);
        }}
        title="账单对账结果"
        description={
          billDetail
            ? `${billDetail.providerLabel} · 共 ${billDetail.transactionCount} 笔，匹配 ${billDetail.matchedCount} 笔`
            : ""
        }
      >
        {billDetail ? (
          <div className="space-y-3">
            {billDetail.transactions.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface-2/60 px-3 py-4 text-center text-sm text-muted">
                全部收款已匹配到订单。
              </p>
            ) : (
              <>
                <p className="text-xs text-muted">
                  以下 {billDetail.transactions.length} 笔未匹配到订单，请自行核对。
                </p>
                <ul className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                  {billDetail.transactions.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-semibold text-text">
                          ¥{formatCents(item.amountCents)}
                        </span>
                        <span className="text-[11px] text-muted">
                          {item.paidAt ? formatDateTime(item.paidAt) : "时间未知"}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted">
                        备注：{item.payerNote || "无"}
                        {item.counterparty ? ` · 对方：${item.counterparty}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}
      </Dialog>

      <BottomNav />
    </div>
  );
}
