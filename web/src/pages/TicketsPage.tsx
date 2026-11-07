/** 交易工单：待付款 / 已支付 / 已完成订单可以进行中沟通，列表按最后消息时间倒序。 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { getTickets } from "../lib/api";
import { cn, formatCents, formatFriendlyTime, maskPersonName } from "../lib/format";
import { useAsync, useInterval, useVisible } from "../lib/hooks";
import { errorMessage } from "../lib/http";
import { useTicketEvents } from "../lib/ticket-events";
import type { TicketSummary } from "../lib/types";

const FILTERS: { value: "open" | "closed"; label: string }[] = [
  { value: "open", label: "进行中" },
  { value: "closed", label: "已结束" },
];

function UnreadBadge({ count }: { count: number }): ReactNode {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function TicketCard({ item, onOpen }: { item: TicketSummary; onOpen: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card card-interactive block w-full px-4 py-3.5 text-left watch:rounded-2xl watch:px-3 watch:py-2.5 md:px-4 md:py-4 md:hover:-translate-y-px md:hover:shadow-[0_18px_36px_-28px_rgba(0,0,0,0.65)]"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-muted watch:h-7 watch:w-7">
          {item.categoryLabel.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text watch:text-[13.5px]">
              {item.orderTitle || "订单"}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                item.status === "open" ? "bg-brand-soft text-brand" : "bg-surface-2 text-muted",
              )}
            >
              {item.status === "open" ? "进行中" : "已结束"}
            </span>
            <UnreadBadge count={item.unreadCount} />
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            <span>{item.categoryLabel}</span>
            <span>¥{formatCents(item.amountCents)}</span>
            <span>与 {maskPersonName(item.counterparty.displayName)}</span>
            <span>单号 {item.orderNo}</span>
          </span>
          <span className="mt-1 flex items-center justify-between text-[11px] text-muted/85">
            <span>{formatFriendlyTime(item.lastMessageAt)}</span>
            <span>{item.messageCount} 条消息</span>
          </span>
        </span>
      </div>
    </button>
  );
}

export function TicketsPage(): ReactNode {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"open" | "closed">("open");
  const visible = useVisible();
  const tickets = useAsync(() => getTickets(filter), [filter]);
  const items = useMemo(() => tickets.data?.items ?? [], [tickets.data]);

  // 页面可见时每 8 秒刷新一次未读与列表（SSE 断线时的兜底）
  useInterval(() => {
    if (visible) tickets.reload();
  }, 8000);

  // 有新消息 / 工单状态变化时立即刷新列表与未读
  useTicketEvents(() => {
    if (visible) tickets.reload();
  });

  useEffect(() => {
    if (visible) tickets.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="交易工单" back containerClassName="md:max-w-[860px]" />

      <main className="page page-with-nav space-y-4 pt-4 watch:space-y-3 watch:pt-3 md:max-w-[860px]">
        <div className="chip-group flex w-full gap-1.5 md:w-auto md:gap-2">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              className={cn("chip flex-1 md:flex-none md:px-6", filter === option.value && "chip-active")}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="px-1 text-xs text-muted watch:text-[11px]">
          共 {items.length} 个工单
        </p>

        {tickets.loading && !tickets.data ? (
          <LoadingBlock text="正在加载工单…" />
        ) : tickets.error && !tickets.data ? (
          <ErrorBlock message={tickets.error} onRetry={() => tickets.reload()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={filter === "open" ? "暂无进行中的工单" : "暂无已结束的工单"}
            description={
              filter === "open"
                ? "在订单详情里发起工单"
                : "工单关闭后显示在这里"
            }
          />
        ) : (
          <div className="space-y-2.5 watch:space-y-2 md:grid md:grid-cols-2 md:gap-2.5 md:space-y-0 xl:grid-cols-3">
            {items.map((item) => (
              <TicketCard key={item.id} item={item} onOpen={() => navigate(`/tickets/${item.id}`)} />
            ))}
          </div>
        )}

        {tickets.error && tickets.data ? (
          <p className="pt-1 text-center text-xs text-danger">
            {errorMessage(tickets.error)}
            <button type="button" className="ml-2 font-semibold text-brand" onClick={() => tickets.reload()}>
              重试
            </button>
          </p>
        ) : null}
      </main>

      <BottomNav />
    </div>
  );
}
