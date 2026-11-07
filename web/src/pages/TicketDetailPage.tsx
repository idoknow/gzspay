/** 工单详情：双方在同一个对话里沟通，任何一方都可以关闭工单。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/EmptyState";
import { EyeIcon } from "../components/EyeIcon";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";
import {
  closeTicket,
  getTicket,
  markTicketRead,
  requestPartiesReveal,
  sendTicketMessage,
} from "../lib/api";
import { cn, formatCents, formatDateTime, maskPersonName } from "../lib/format";
import { useAsync, useInterval, useVisible } from "../lib/hooks";
import { useTicketEvents } from "../lib/ticket-events";
import { errorMessage } from "../lib/http";
import type { PartiesReveal, TicketMessage, TicketParty } from "../lib/types";

const CLOSED_REASON_TEXT: Record<string, string> = {
  user: "双方已结束沟通",
  admin: "平台客服已结束",
  timeout: "7 天无新消息，已自动关闭",
};

/** 平台客服留言用站点 logo 代替头像 */
function PlatformLogo({ size = 28 }: { size?: number }): ReactNode {
  return (
    <span
      className="mt-1 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src="/logo.svg" alt="" className="h-[68%] w-[68%] object-contain" />
    </span>
  );
}

function MessageBubble({ message, mine }: { message: TicketMessage; mine: boolean }): ReactNode {
  const isAdmin = message.senderRole === "admin";
  // 平台系统提示（如资料披露审核结果）居中显示，不算任何一方的气泡
  if (message.senderRole === "system") {
    return (
      <div className="flex w-full justify-center">
        <p className="max-w-[86%] whitespace-pre-wrap break-words rounded-full bg-surface-2/80 px-3.5 py-1.5 text-center text-[11.5px] leading-relaxed text-muted md:max-w-[70%]">
          {message.body}
        </p>
      </div>
    );
  }
  return (
    <div className={cn("flex w-full gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine ? (
        isAdmin ? (
          <PlatformLogo />
        ) : (
          <Avatar name={message.senderName} avatarUrl={message.senderAvatarUrl} size={28} rounded />
        )
      ) : null}
      <div className={cn("max-w-[78%] min-w-0 md:max-w-[64%]", mine && "items-end")}>
        {!mine ? (
          <p className="mb-1 text-[10.5px] text-muted">
            {isAdmin ? "平台客服" : message.senderName}
          </p>
        ) : null}
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed watch:text-[12.5px]",
            mine
              ? "rounded-br-md bg-brand text-white"
              : isAdmin
                ? "rounded-bl-md border border-brand/30 bg-brand-soft/60 text-text"
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

function PartyRow({ party, self }: { party: TicketParty; self: boolean }): ReactNode {
  return (
    <div className="flex items-start gap-3">
      <Avatar name={party.displayName} avatarUrl={party.avatarUrl} size={38} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-text">
          <span className="truncate">{party.displayName}</span>
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              party.role === "merchant" ? "bg-brand-soft text-brand" : "bg-surface-2 text-muted",
            )}
          >
            {party.role === "merchant" ? "商家" : "付款人"}
          </span>
          {self ? <span className="text-[10px] text-muted">（我）</span> : null}
        </p>
        <p className="mt-1 text-[11.5px] text-muted">学号 {party.studentNo ?? "未填写"}</p>
        <p className="text-[11.5px] text-muted">
          QQ {party.qq ?? "未填写"} · 邮箱 {party.email ?? "未填写"}
        </p>
      </div>
    </div>
  );
}

/** 双方信息摘要：只显示头像、姓名与身份，点开弹窗看完整资料 */
function PartiesSummary({
  parties,
  role,
  onOpen,
}: {
  parties: { payer: TicketParty; merchant: TicketParty };
  role: "payer" | "merchant";
  onOpen: () => void;
}): ReactNode {
  const rows: { party: TicketParty }[] = [{ party: parties.payer }, { party: parties.merchant }];
  return (
    <button
      type="button"
      className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-line/70 bg-surface px-3.5 py-3 text-left transition active:bg-surface-2 md:mx-auto md:max-w-[688px]"
      onClick={onOpen}
    >
      <div className="flex shrink-0 items-center -space-x-2">
        {rows.map(({ party }) => (
          <span key={party.id} className="rounded-full ring-2 ring-surface">
            <Avatar name={party.displayName} avatarUrl={party.avatarUrl} size={30} />
          </span>
        ))}
      </div>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-text">
          <span className="truncate">{parties.payer.displayName}</span>
          <span className="text-[11px] text-muted">与</span>
          <span className="truncate">{parties.merchant.displayName}</span>
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">
          {role === "payer" ? "你是付款人" : "你是商家"} · 查看双方资料
        </span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-muted">
        <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** 双方资料还没披露：说明规则 + 申请（待审核 / 被驳回时展示对应状态） */
function PartiesLocked({
  reveal,
  closed,
  busy,
  onRequest,
}: {
  reveal: PartiesReveal;
  closed: boolean;
  busy: boolean;
  onRequest: () => void;
}): ReactNode {
  const pending = reveal.status === "pending";
  const rejected = reveal.status === "rejected";
  return (
    <div className="mx-4 mt-3 rounded-2xl border border-line/70 bg-surface px-4 py-3.5 md:mx-auto md:max-w-[688px]">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-muted">
          <EyeIcon off size={14} />
        </span>
        <p className="text-[13px] font-medium text-text">双方资料未披露</p>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
        资料默认隐藏，可向平台申请；审核通过后双方可见。
      </p>
      {pending ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          {reveal.requestedByMe ? "你已提交申请" : "对方已提交申请"}，等待审核。
        </p>
      ) : null}
      {rejected ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          平台未通过{reveal.note ? `：${reveal.note}` : ""}
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn-outline mt-2.5 h-9 w-full text-[12.5px]"
        disabled={pending || closed || busy}
        onClick={onRequest}
      >
        {busy ? "提交中…" : pending ? "等待审核" : rejected ? "重新申请" : "申请披露资料"}
      </button>
      {closed ? <p className="mt-1.5 text-[11px] text-muted">工单已结束，无法申请。</p> : null}
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
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedRef = useRef<string>("");

  // 打开/刷新后把工单标记为已读（同一时刻只发一次）
  useEffect(() => {
    if (!data || lastMarkedRef.current === `${data.id}:${data.messageCount}`) return;
    lastMarkedRef.current = `${data.id}:${data.messageCount}`;
    void markTicketRead(data.id).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.messageCount]);

  // 页面可见时每 5 秒刷新一次对话（SSE 断线时的兜底）
  useInterval(() => {
    if (visible && !closing) ticket.reload();
  }, 5000);

  // 对方发消息、平台介入或状态变化时立即刷新，不用等轮询
  useTicketEvents((payload) => {
    if (payload.ticketId === id) ticket.reload();
  });

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

  const requestReveal = async (): Promise<void> => {
    if (!data || revealing) return;
    setRevealing(true);
    try {
      const next = await requestPartiesReveal(data.id);
      ticket.setData(next);
      toast.success("已提交申请");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setRevealing(false);
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
          <EmptyState title="工单不存在" description="可能已删除或无权限查看" />
        </main>
      </div>
    );
  }

  const closed = data.status === "closed";
  const conversation = data.messages.slice(1);
  const counterpart = maskPersonName(data.counterparty.displayName) || "对方";

  return (
    <div className="bg-app min-h-[100dvh] flex flex-col">
      <PageHeader
        title={`与 ${counterpart} 的工单`}
        subtitle={`${data.categoryLabel} · ¥${formatCents(data.amountCents)} · ${data.orderTitle}`}
        back
        containerClassName="md:max-w-[720px]"
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
        className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-line/70 bg-surface px-3.5 py-2.5 text-left md:mx-auto md:max-w-[688px]"
        onClick={() => navigate(`/orders/${data.orderId}`)}
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-text">{data.orderTitle || "订单"}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted">
            订单号 {data.orderNo}
          </span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-muted">
          <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {data.parties ? (
        <PartiesSummary parties={data.parties} role={data.role} onOpen={() => setPartiesOpen(true)} />
      ) : (
        <PartiesLocked
          reveal={data.partiesReveal}
          closed={closed}
          busy={revealing}
          onRequest={() => void requestReveal()}
        />
      )}

      {closed ? (
        <p className="mx-4 mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted md:mx-auto md:max-w-[688px]">
          {CLOSED_REASON_TEXT[data.closedReason ?? "user"] ?? "工单已关闭"}
          {data.closedAt ? `（${formatDateTime(data.closedAt)}）` : ""}
        </p>
      ) : null}

      <main className={cn("page flex-1 space-y-4 pt-4 md:max-w-[720px]", closed ? "pb-10" : "pb-[132px]")}>
        <div className="rounded-2xl border border-brand/30 bg-brand-soft/70 px-4 py-3.5 shadow-[0_12px_26px_-20px_rgba(0,0,0,0.5)]">
          <p className="text-[11px] font-medium text-brand">问题描述</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text">
            {data.messages[0]?.body ?? "—"}
          </p>
        </div>

        <div className="space-y-3">
          {conversation.length === 0 ? (
            <p className="text-center text-[11.5px] text-muted">还没有新消息。</p>
          ) : null}
          {conversation.map((message) => (
            <MessageBubble key={message.id} message={message} mine={message.senderRole === data.role} />
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
          <div className="mx-auto flex w-full max-w-[520px] items-end gap-2 md:max-w-[640px]">
            <textarea
              className="input min-h-[42px] max-h-32 flex-1 resize-none py-2.5 text-[13.5px]"
              rows={1}
              maxLength={1000}
              placeholder="输入消息…"
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
          <p className="mx-auto mt-1.5 w-full max-w-[520px] text-[10px] text-muted/80 md:max-w-[640px]">
            仅双方与客服可见，7 天无新消息自动关闭。
          </p>
        </div>
      )}

      <Dialog
        open={partiesOpen}
        onClose={() => setPartiesOpen(false)}
        title="双方信息"
        description="请勿外传。"
        footer={
          <button type="button" className="btn btn-outline w-full" onClick={() => setPartiesOpen(false)}>
            知道了
          </button>
        }
      >
        {data.parties ? (
          <div className="space-y-4">
            <PartyRow party={data.parties.payer} self={data.role === "payer"} />
            <div className="h-px bg-line/60" />
            <PartyRow party={data.parties.merchant} self={data.role === "merchant"} />
          </div>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted">资料未披露，需先申请。</p>
        )}
      </Dialog>

      <ConfirmDialog
        open={closeOpen}
        title="结束工单"
        description="关闭后不能再发消息，可重新发起。"
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
