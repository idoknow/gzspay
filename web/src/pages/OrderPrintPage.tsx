/**
 * 账单打印页：把当前筛选（或指定订单）的账单渲染成适合打印的表格，
 * 浏览器「打印 → 另存为 PDF」即可导出 PDF（中文字体随系统，不需要服务端字体）。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import { exportOrdersBlob } from "../lib/api";
import { errorMessage } from "../lib/http";
import { useAuth } from "../lib/session";

interface ExportRecord {
  orderNo: string;
  title: string;
  amount: string;
  amountCents: number;
  status: string;
  channel: string;
  merchant: string;
  payer: string;
  createdAt: string;
  paidAt: string;
  completedAt: string;
  cancelReason: string;
  note: string;
}

interface ExportPayload {
  exportedAt: string;
  count: number;
  orders: ExportRecord[];
}

const STATUS_FILTER_VALUES = ["pending", "paid", "closed", "settled", "all"] as const;
type StatusFilter = (typeof STATUS_FILTER_VALUES)[number];

function money(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function OrderPrintPage(): ReactNode {
  const toast = useToast();
  const { session } = useAuth();
  const [params] = useSearchParams();
  const [payload, setPayload] = useState<ExportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const scope = params.get("scope") === "receive" ? "receive" : "pay";
  const statusParam = params.get("status") ?? "all";
  const status: StatusFilter = (STATUS_FILTER_VALUES as readonly string[]).includes(statusParam)
    ? (statusParam as StatusFilter)
    : "all";
  const keyword = params.get("q") ?? "";
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  const ids = useMemo(
    () => (params.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    [params],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    exportOrdersBlob({
      format: "json",
      scope,
      status,
      q: keyword || undefined,
      from,
      to,
      ids: ids.length > 0 ? ids : undefined,
    })
      .then((blob) => blob.text())
      .then((text) => JSON.parse(text) as ExportPayload)
      .then((data) => {
        if (active) setPayload(data);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, status, keyword, ids]);

  const totalCents = (payload?.orders ?? []).reduce((sum, item) => sum + item.amountCents, 0);
  const siteName = session.site?.name || "校园收付款";

  const handlePrint = (): void => {
    if (!payload || payload.count === 0) {
      toast.error("没有可打印的账单");
      return;
    }
    window.print();
  };

  return (
    <div className="min-h-[100dvh] bg-white text-black">
      <style>{`
        @media print {
          @page { margin: 12mm; }
          body { background: #fff; }
          .print-toolbar { display: none !important; }
          .print-table { font-size: 10pt; }
          .print-table thead { display: table-header-group; }
          .print-table tr { break-inside: avoid; }
        }
      `}</style>

      <div className="print-toolbar sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">账单打印</p>
          <p className="text-[11px] text-muted">
            {scope === "pay" ? "我发起的" : "我收到的"} · {ids.length > 0 ? "指定订单" : "当前筛选"} · 共 {payload?.count ?? 0} 笔
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => window.close()}>
            关闭
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handlePrint}>
            打印 / 存 PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[900px] px-4 py-6">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold">{siteName} · 交易账单</h1>
            <p className="mt-1 text-xs text-muted">
              导出时间：{payload ? new Date(payload.exportedAt).toLocaleString() : "—"}
              {keyword ? ` · 关键词：${keyword}` : ""}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-muted">合计</p>
            <p className="text-lg font-bold">{money(totalCents)}</p>
          </div>
        </div>

        {loading ? (
          <p className="py-16 text-center text-sm text-muted">正在准备账单…</p>
        ) : error ? (
          <p className="py-16 text-center text-sm text-red-600">{error}</p>
        ) : (payload?.orders ?? []).length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">没有符合条件的账单</p>
        ) : (
          <table className="print-table w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b-2 border-black/70 text-left">
                <th className="py-1.5 pr-2 font-semibold">时间</th>
                <th className="py-1.5 pr-2 font-semibold">订单号</th>
                <th className="py-1.5 pr-2 font-semibold">内容</th>
                <th className="py-1.5 pr-2 text-right font-semibold">金额</th>
                <th className="py-1.5 pr-2 font-semibold">状态</th>
                <th className="py-1.5 pr-2 font-semibold">商家</th>
                <th className="py-1.5 pr-2 font-semibold">付款人</th>
                <th className="py-1.5 font-semibold">备注</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.orders ?? []).map((item) => (
                <tr key={item.orderNo} className="border-b border-black/15 align-top">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{item.paidAt || item.createdAt}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{item.orderNo}</td>
                  <td className="py-1.5 pr-2">{item.title}</td>
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">{money(item.amountCents)}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{item.status}</td>
                  <td className="py-1.5 pr-2">{item.merchant}</td>
                  <td className="py-1.5 pr-2">{item.payer}</td>
                  <td className="py-1.5">{item.cancelReason || item.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
