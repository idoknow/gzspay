/** 工单详情：双方在同一个对话里沟通，任何一方都可以关闭工单。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";
import { closeTicket, getTicket, markTicketRead, sendTicketMessage } from "../lib/api";
import { cn, formatCents, formatDateTime, maskPersonName } from "../lib/format";
import { useAsync, useInterval, useVisible } from "../lib/hooks";
import { errorMessage } from "../lib/http";
import type { TicketMessage } from "../lib/types";

const CLOSED_REASON_TEXT: Record<string, string> = {
  user: "双方已经结束沟通，工单已关闭",
  admin: "管理员关闭了工单",
  timeout: "超过 7 天没有新消息，工单已自动关闭",
};

function MessageBubble({ message, mine }: { message: TicketMessage; mine: boolean }): ReactNode {
  return (
    <div className={cn("flex w-full gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine ? (
        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted">
          {message.senderName.slice(0, 1)}
        </span>
      ) : null}
      <div className={cn("max-w-[78%] min-w-0", mine && "items-end")}>
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed watch:text-[12.5px]",
            mine
              ? "rounded-br-md bg-brand text-white"
              : "rounded-bl-md border border-line/70 bg-surface text-text",
          )}
        >
          {message.body}
        </div>
        <p className={cn("mt-1 text-[10px] text-muted/80", mine ? "text-right" : "text-left")}>
          {formatDateTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

export function TicketDetailPage(): ReactNode {
  const { id = "" } = useParams<{ id: string }>();
  const toast = useToast();
  const navigate = useNavigate();
  const visible = useVisible();
  const ticket = useAsync(() => getTicket(id), [id]);
  const data = ticket.data;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedRef = useRef<string>("");

  // 打开/刷新后把工单标记为已读（同一时刻只发一次）
  useEffect(() => {
    if (!data || lastMarkedRef.current === `${data.id}:${data.messageCount}`) return;
    lastMarkedRef.current = `${data.id}:${data.messageCount}`;
    void markTicketRead(data.id).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.messageCount]);

  // 页面可见时每 5 秒刷新一次对话
  useInterval(() => {
    if (visible && !closing) ticket.reload();
  }, 5000);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [data?.messageCount]);

  const submit = async (): Promise<void> => {
    const body = text.trim();
    if (!body || !data || sending) return;
    setSending(true);
    try {
      const updated = await sendTicketMessage(data.id, body);
      ticket.setData(updated);
      setText("");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSending(false);
    }
  };

  const confirmClose = async (): Promise<void> => {
    if (!data) return;
    setClosing(true);
    try {
      const updated = await closeTicket(data.id);
      ticket.setData(updated);
      toast.success("工单已关闭");
      setCloseOpen(false);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setClosing(false);
    }
  };

  if (ticket.loading && !data) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="工单详情" back />
        <main className="page pt-4">
          <LoadingBlock text="正在加载工单…" />
        </main>
      </div>
    );
  }

  if (ticket.error && !data) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="工单详情" back />
        <main className="page pt-4">
          <ErrorBlock message={ticket.error} onRetry={() => ticket.reload()} />
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="工单详情" back />
        <main className="page pt-4">
          <EmptyState title="工单不存在" description="工单可能已被删除，或者你没有权限查看" />
        </main>
      </div>
    );
  }

  const closed = data.status === "closed";
  const counterpart = maskPersonName(data.counterparty.displayName) || "对方";

  return (
    <div className="bg-app min-h-[100dvh] flex flex-col">
      <PageHeader
        title={`与 ${counterpart} 的工单`}
        subtitle={`${data.categoryLabel} · ¥${formatCents(data.amountCents)} · ${data.orderTitle}`}
        back
        right={
          closed ? null : (
            <button
              type="button"
              className="rounded-full px-2.5 py-1 text-[11px] font-medium text-muted transition active:bg-surface-2"
              onClick={() => setCloseOpen(true)}
            >
              结束工单
            </button>
          )
        }
      />

      <button
        type="button"
        className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-line/70 bg-surface px-3.5 py-2.5 text-left"
        onClick={() => navigate(`/orders/${data.orderId}`)}
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-text">{data.orderTitle || "订单"}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted">
            订单号 {data.orderNo} · 点击查看订单
          </span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-muted">
          <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {closed ? (
        <p className="mx-4 mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted">
          {CLOSED_REASON_TEXT[data.closedReason ?? "user"] ?? "工单已关闭"}
          {data.closedAt ? `（${formatDateTime(data.closedAt)}）` : ""}
        </p>
      ) : null}

      <main className={cn("page flex-1 space-y-4 pt-4", closed ? "pb-10" : "pb-[132px]")}>
        <div className="rounded-xl border border-line/70 bg-surface px-3.5 py-2.5 text-[12px] leading-relaxed text-muted">
          <span className="font-medium text-text">问题描述：</span>
          {data.messages[0]?.body ?? "—"}
        </div>

        <div className="space-y-3">
          {data.messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              mine={message.senderRole === data.role && index > 0}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {ticket.error ? (
          <p className="text-center text-xs text-danger">
            {errorMessage(ticket.error)}
            <button type="button" className="ml-2 font-semibold text-brand" onClick={() => ticket.reload()}>
              重试
            </button>
          </p>
        ) : null}
      </main>

      {closed ? null : (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-app/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[520px] items-end gap-2">
            <textarea
              className="input min-h-[42px] max-h-32 flex-1 resize-none py-2.5 text-[13.5px]"
              rows={1}
              maxLength={1000}
              placeholder="输入消息，和对方沟通…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm h-[42px] shrink-0 px-4"
              disabled={sending || text.trim().length === 0}
              onClick={() => void submit()}
            >
              {sending ? "发送中" : "发送"}
            </button>
          </div>
          <p className="mx-auto mt-1.5 w-full max-w-[520px] text-[10px] text-muted/80">
            工单仅订单双方可见；超过 7 天没有新消息会自动关闭。
          </p>
        </div>
      )}

      <ConfirmDialog
        open={closeOpen}
        title="结束工单"
        description="关闭后双方都不能再在这个工单里发消息。如果还有问题，可以重新发起一个工单。确认结束？"
        confirmText="结束工单"
        danger
        loading={closing}
        onConfirm={() => void confirmClose()}
        onClose={() => {
          if (!closing) setCloseOpen(false);
        }}
      />
    </div>
  );
}
