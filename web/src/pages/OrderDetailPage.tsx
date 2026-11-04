/** 订单详情：按当前用户角色与订单状态渲染付款人视角 / 商家视角。 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { ChannelIcon } from "../components/ChannelIcon";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CountdownModal } from "../components/CountdownModal";
import { Dialog } from "../components/Dialog";
import { ErrorBlock, PageLoading, Spinner } from "../components/Loading";
import { MoneyText } from "../components/MoneyText";
import { PageHeader } from "../components/PageHeader";
import { QrImage, useBlobUrl } from "../components/QrImage";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
import {
  cancelOrder,
  confirmOrder,
  createTicket,
  exportOrdersBlob,
  getOrder,
  getOrderQrBlob,
  getPaymentProofBlob,
  getTickets,
  markOrderNotReceived,
  payOrder,
  subscribeEvents,
  uploadPaymentProof,
} from "../lib/api";
import { copyText } from "../lib/clipboard";
import { downloadBlob, safeFilename } from "../lib/download";
import { cn, formatCents, formatDateTime, formatFriendlyTime, maskPersonName, payChannelLabel } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAsync } from "../lib/hooks";
import { TICKET_CATEGORY_LABELS } from "../lib/types";
import type { OrderDetail, PayChannel, TicketCategory } from "../lib/types";

const CANCEL_REASONS = ["金额有误", "已线下结清", "对方未付款", "其他"] as const;

const EVENT_LABELS: Record<string, string> = {
  created: "创建订单",
  paid: "付款人标记已支付",
  payment: "付款人标记已支付",
  payment_proof_uploaded: "付款人上传付款截图",
  proof_uploaded: "付款人上传付款截图",
  confirmed: "商家确认收款",
  confirm: "商家确认收款",
  completed: "交易完成",
  cancelled: "订单已取消",
  cancel: "订单已取消",
  not_received: "商家标记未收到款",
  notReceived: "商家标记未收到款",
  appeal: "付款人发起申诉",
  appealed: "付款人发起申诉",
  auto_confirmed: "账单自动对账确认收款",
  requirement: "备注要求",
  refunded: "订单已退款",
  timeout_closed: "订单超时关闭",
};

function statusText(order: OrderDetail): { title: string; description: string } {
  switch (order.status) {
    case "pending_payment":
      return order.role === "payer"
        ? { title: "等待付款", description: "请使用下方商家收款码付款，付款后点击「我已支付」" }
        : { title: "等待付款人付款", description: "对方付款后，你确认收款即可完成交易" };
    case "paid":
      return order.role === "payer"
        ? { title: "已标记支付", description: "等待商家确认收款，请保持联系畅通" }
        : { title: "付款人已标记支付", description: "请核对收款账户余额后确认收款" };
    case "completed":
      return { title: "交易已完成", description: "感谢使用 gzspay" };
    case "cancelled":
      return { title: "订单已取消", description: order.cancelReason ? `取消原因：${order.cancelReason}` : "该订单已取消" };
    default:
      return { title: "订单详情", description: "" };
  }
}

/** 时间线只展示中文：历史「账单自动对账」事件尾部带的十六进制账单编号在这里去掉 */
function eventDetail(event: { type: string; detail: string | null }): string | null {
  if (!event.detail) return null;
  if (event.type !== "auto_confirmed") return event.detail;
  const cleaned = event.detail.replace(/[，,]\s*账单\s*[0-9a-zA-Z-]{4,}\s*$/u, "").trim();
  return cleaned || "账单自动对账确认收款";
}

function Timeline({ order }: { order: OrderDetail }): ReactNode {
  if (order.events.length === 0) return null;
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-text">订单时间线</h2>
      <ol className="mt-3 space-y-3">
        {order.events.map((event, index) => {
          const detail = eventDetail(event);
          return (
            <li key={event.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                    index === order.events.length - 1 ? "bg-brand" : "bg-surface-3",
                  )}
                />
                {index < order.events.length - 1 ? <span className="mt-1 w-px flex-1 bg-line" /> : null}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <p className="text-sm text-text">{EVENT_LABELS[event.type] ?? "订单状态更新"}</p>
                {detail ? <p className="mt-0.5 break-words text-xs text-muted">{detail}</p> : null}
                <p className="mt-0.5 text-[11px] text-muted">{formatDateTime(event.createdAt)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function OrderQrPanel({
  title,
  channels,
  channel,
  onChannelChange,
  dataUrl,
  loading,
  error,
  onSave,
  saving,
  hint,
}: {
  title: string;
  channels: PayChannel[];
  channel: PayChannel | null;
  onChannelChange: (channel: PayChannel) => void;
  dataUrl: string | null;
  loading: boolean;
  error: string | null;
  onSave: () => void;
  saving: boolean;
  hint?: string;
}): ReactNode {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {channel ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <ChannelIcon channel={channel} size={14} />
            {payChannelLabel(channel)}
          </span>
        ) : null}
      </div>
      {channels.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-3 text-xs leading-relaxed text-muted">
          商家尚未启用任何收款方式，请与商家联系后再付款。
        </p>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            {channels.map((item) => (
              <button
                key={item}
                type="button"
                className={cn("chip", channel === item && "chip-active")}
                onClick={() => onChannelChange(item)}
              >
                <ChannelIcon channel={item} size={15} />
                {payChannelLabel(item)}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col items-center">
            {error ? (
              <p className="py-6 text-center text-xs text-danger">{error}</p>
            ) : loading ? (
              <div className="skeleton h-[220px] w-[220px] watch:h-[168px] watch:w-[168px]" />
            ) : (
              <QrImage dataUrl={dataUrl} size={220} alt={`${channel ? payChannelLabel(channel) : ""}收款码`} />
            )}
            <p className="mt-3 text-center text-xs leading-relaxed text-muted">
              {hint ?? "请核对收款方信息后再扫码付款，资金直接进入商家账户"}
            </p>
            <button
              type="button"
              className="btn btn-outline btn-sm mt-3"
              disabled={saving || !channel || !dataUrl}
              onClick={onSave}
            >
              {saving ? <Spinner size={14} /> : null}
              保存二维码
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function OrderDetailPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: order, loading, error, reload } = useAsync<OrderDetail>(
    () => (id ? getOrder(id) : Promise.reject(new Error("订单不存在"))),
    [id],
  );

  const [requirementOpen, setRequirementOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<PayChannel | null>(null);
  const [savingQr, setSavingQr] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payChannel, setPayChannel] = useState<PayChannel | null>(null);
  const [payNote, setPayNote] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payProofFile, setPayProofFile] = useState<File | null>(null);
  const [proofViewerOpen, setProofViewerOpen] = useState(false);
  /** 商家是否已经打开过付款截图核对 */
  const [proofChecked, setProofChecked] = useState(false);
  /** 交易详情默认隐藏对方完整姓名 */
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState<"csv" | "xlsx" | "json" | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<(typeof CANCEL_REASONS)[number]>("金额有误");
  const [cancelNote, setCancelNote] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [notReceivedOpen, setNotReceivedOpen] = useState(false);
  const [notReceivedBusy, setNotReceivedBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrDialogChannel, setQrDialogChannel] = useState<PayChannel | null>(null);
  /** 工单：已支付 / 已完成订单可以和对方沟通争议 */
  const [ticketOpen, setTicketOpen] = useState(false);
  const [ticketCategory, setTicketCategory] = useState<TicketCategory>("amount");
  const [ticketDescription, setTicketDescription] = useState("");
  const [ticketBusy, setTicketBusy] = useState(false);

  const isMerchantView = order?.role === "merchant";
  const channels = order?.availableChannels ?? [];

  const channel = useMemo<PayChannel | null>(() => {
    if (channels.length === 0) return null;
    if (selectedChannel && channels.includes(selectedChannel)) return selectedChannel;
    return channels[0] ?? null;
  }, [channels, selectedChannel]);

  const qrDialogChannelResolved = useMemo<PayChannel | null>(() => {
    if (channels.length === 0) return null;
    if (qrDialogChannel && channels.includes(qrDialogChannel)) return qrDialogChannel;
    return channels[0] ?? null;
  }, [channels, qrDialogChannel]);

  const pending = order?.status === "pending_payment";

  const qrFactory = order && pending && channel ? () => getOrderQrBlob(order.id, channel) : null;
  const qr = useBlobUrl(qrFactory, [order?.id ?? "", order?.status ?? "", channel]);

  const qrDialogFactory =
    order && pending && qrDialogChannelResolved ? () => getOrderQrBlob(order.id, qrDialogChannelResolved) : null;
  const qrDialog = useBlobUrl(qrDialogFactory, [order?.id ?? "", order?.status ?? "", qrDialogChannelResolved]);

  const proofFactory = order?.hasPaymentProof ? () => getPaymentProofBlob(order.id) : null;
  const proof = useBlobUrl(proofFactory, [order?.id ?? "", order?.hasPaymentProof ?? false]);

  // 只有发生过付款的订单才允许发起工单；这里顺带取出该订单进行中的那一条
  const ticketEligible = order?.status === "paid" || order?.status === "completed";
  const orderTickets = useAsync(
    () => (ticketEligible ? getTickets("open") : Promise.resolve({ items: [] })),
    [id, ticketEligible],
  );
  const currentTicket = useMemo(
    () => (orderTickets.data?.items ?? []).find((item) => item.orderId === order?.id) ?? null,
    [orderTickets.data, order?.id],
  );

  // 切换订单时重置「已核对截图」状态
  useEffect(() => {
    setProofChecked(false);
  }, [id]);

  // 首次进入待付款订单（付款人）时弹出 3 秒倒计时的备注要求
  useEffect(() => {
    if (!order || order.role !== "payer" || order.status !== "pending_payment") return;
    if (!order.noteRequirement.trim()) return;
    const key = `gzspay-requirement-seen-${order.id}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
    } catch {
      // 隐私模式忽略
    }
    setRequirementOpen(true);
  }, [order]);

  // 订单状态变化时自动刷新
  useEffect(() => {
    if (!id) return;
    return subscribeEvents({
      onOrderUpdate: (payload) => {
        if (payload.orderId === id) reload();
      },
    });
  }, [id, reload]);

  const closeRequirement = (): void => {
    if (order) {
      try {
        window.sessionStorage.setItem(`gzspay-requirement-seen-${order.id}`, "1");
      } catch {
        // 忽略
      }
    }
    setRequirementOpen(false);
  };

  const handleCopy = async (text: string, label: string): Promise<void> => {
    const ok = await copyText(text);
    if (ok) toast.success(`${label}已复制`);
    else toast.error("复制失败，请长按文字手动复制");
  };

  const handleSaveQr = async (): Promise<void> => {
    if (!order || !channel) return;
    setSavingQr(true);
    try {
      const blob = await getOrderQrBlob(order.id, channel);
      downloadBlob(blob, safeFilename(`gzspay-${order.orderNo}-${channel}.png`));
      toast.success("二维码已保存");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSavingQr(false);
    }
  };

  const handleExport = async (format: "csv" | "xlsx" | "json"): Promise<void> => {
    if (!order) return;
    setExportBusy(format);
    try {
      const blob = await exportOrdersBlob({
        format,
        scope: order.role === "payer" ? "pay" : "receive",
        ids: [order.id],
      });
      downloadBlob(blob, safeFilename(`gzspay-账单-${order.orderNo}.${format}`));
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
    if (!order) return;
    setExportOpen(false);
    navigate(`/orders/print?ids=${encodeURIComponent(order.id)}`);
  };

  const openPayDialog = (): void => {
    // 不预选：付款人必须明确选择自己实际使用的收款方式，商家核对时才能对上账
    setPayChannel(null);
    setPayNote(order?.reservedNote ?? "");
    setPayProofFile(null);
    setPayOpen(true);
  };

  const submitPay = async (): Promise<void> => {
    if (!order) return;
    if (!payChannel) {
      toast.error("请选择实际支付方式");
      return;
    }
    if (!payProofFile && !order.hasPaymentProof) {
      toast.error("请先上传付款截图，商家确认收款前会核对");
      return;
    }
    setPayBusy(true);
    try {
      if (payProofFile) await uploadPaymentProof(order.id, payProofFile);
      await payOrder(order.id, { channel: payChannel, actualNote: payNote.trim() });
      setPayOpen(false);
      setPayProofFile(null);
      toast.success("已标记为已支付，等待商家确认");
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setPayBusy(false);
    }
  };

  const submitCancel = async (): Promise<void> => {
    if (!order) return;
    setCancelBusy(true);
    try {
      await cancelOrder(order.id, { reason: cancelReason, note: cancelNote.trim() || undefined });
      setCancelOpen(false);
      toast.success("订单已取消");
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setCancelBusy(false);
    }
  };

  const submitConfirm = async (): Promise<void> => {
    if (!order) return;
    setConfirmBusy(true);
    try {
      await confirmOrder(order.id);
      setConfirmOpen(false);
      toast.success("已确认收款，交易完成");
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setConfirmBusy(false);
    }
  };

  const submitNotReceived = async (): Promise<void> => {
    if (!order) return;
    setNotReceivedBusy(true);
    try {
      await markOrderNotReceived(order.id);
      setNotReceivedOpen(false);
      toast.success("已标记未收到款，已通知付款人");
      reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setNotReceivedBusy(false);
    }
  };

  const submitTicket = async (): Promise<void> => {
    if (!order) return;
    const description = ticketDescription.trim();
    if (description.length < 5) {
      toast.error("请简单描述一下争议情况（至少 5 个字）");
      return;
    }
    setTicketBusy(true);
    try {
      const result = await createTicket({ orderId: order.id, category: ticketCategory, description });
      setTicketOpen(false);
      setTicketDescription("");
      orderTickets.reload();
      navigate(`/tickets/${result.ticket.id}`);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setTicketBusy(false);
    }
  };

  if (!id) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="订单详情" back />
        <div className="page pt-6">
          <ErrorBlock message="订单不存在" />
        </div>
      </div>
    );
  }

  if (loading && !order) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="订单详情" back />
        <PageLoading />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="订单详情" back />
        <div className="page pt-6">
          <ErrorBlock message={error ?? "订单加载失败"} onRetry={reload} />
        </div>
      </div>
    );
  }

  const status = statusText(order);
  const counterpartyFullName =
    order.counterparty?.displayName ||
    (order.role === "payer" ? order.merchantName : order.payerNameSnapshot) ||
    "";
  // 对方姓名一律脱敏展示，不提供展开开关
  const counterpartyName = counterpartyFullName
    ? maskPersonName(counterpartyFullName)
    : order.role === "payer"
      ? "商家"
      : "付款人";
  const showActions = order.status === "pending_payment" || order.status === "paid";

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="订单详情" back />

      <main className={cn("page space-y-3 pt-4", showActions ? "page-with-footer" : "pb-10")}>
        {order.status === "cancelled" ? (
          <div className="rounded-2xl bg-danger-soft px-4 py-3 text-sm leading-relaxed text-danger">
            <p className="font-semibold">订单已取消</p>
            <p className="mt-0.5 text-xs">{order.cancelReason ? `取消原因：${order.cancelReason}` : "该订单已取消，无需再付款"}</p>
          </div>
        ) : null}

        <section className="card p-5">
          <div className="flex items-center justify-between">
            <StatusBadge status={order.status} />
            <span className="text-[11px] text-muted">{formatFriendlyTime(order.createdAt)}</span>
          </div>
          <h1 className="mt-3 text-lg font-bold text-text">{status.title}</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted">{status.description}</p>
          <div className="mt-3 flex flex-col items-center rounded-2xl bg-surface-2/60 py-4">
            <MoneyText cents={order.amountCents} size="hero" />
            <button
              type="button"
              className="mt-2 text-[11px] text-muted"
              title="点击复制订单号"
              onClick={() => void handleCopy(order.orderNo, "订单号")}
            >
              订单号 {order.orderNo}
            </button>
            <button
              type="button"
              className="mt-2 text-[11px] font-medium text-brand"
              onClick={() => setExportOpen(true)}
            >
              导出账单
            </button>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="section-title">{order.role === "payer" ? "商家信息" : "付款人信息"}</h2>
          <div className="flex items-center gap-3">
            <Avatar name={counterpartyName} avatarUrl={order.counterparty?.avatarUrl ?? null} size={46} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-[15px] font-semibold text-text">{counterpartyName}</p>
                {order.role === "payer" ? (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">商家</span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {order.counterparty?.studentNoMasked ? `学号 ${order.counterparty.studentNoMasked}` : "已认证用户"}
              </p>
            </div>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="section-title">订单内容</h2>
          {order.items && order.items.length > 0 ? (
            <div className="space-y-2">
              {order.items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-text">
                    {item.name}
                    <span className="ml-1 text-xs text-muted">×{item.quantity}</span>
                  </span>
                  <span className="text-amount shrink-0 text-text">¥{formatCents(item.priceCents * item.quantity)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text">自定义付款</p>
          )}
          <div className="divider my-3" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">合计</span>
            <MoneyText cents={order.amountCents} size="md" />
          </div>
        </section>

        {order.noteRequirement.trim() ? (
          <section className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">商家备注要求</h2>
              <button
                type="button"
                className="text-xs font-medium text-brand"
                onClick={() => setRequirementOpen(true)}
              >
                重新查看
              </button>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
              {order.noteRequirement}
            </p>
          </section>
        ) : null}

        {order.reservedNote ? (
          <section className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">预留备注</h2>
              <button
                type="button"
                className="text-xs font-medium text-brand"
                onClick={() => void handleCopy(order.reservedNote ?? "", "备注")}
              >
                复制
              </button>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
              {order.reservedNote}
            </p>
          </section>
        ) : null}

        {order.status !== "pending_payment" ? (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-text">支付信息</h2>
            <div className="mt-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="shrink-0 text-muted">实际支付方式</span>
                {order.payChannel ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-text">
                    <ChannelIcon channel={order.payChannel} size={16} />
                    {payChannelLabel(order.payChannel)}
                  </span>
                ) : (
                  <span className="text-muted">未记录</span>
                )}
              </div>
              <div className="flex items-start justify-between gap-4 text-sm">
                <span className="shrink-0 text-muted">实际支付备注</span>
                {order.actualNote?.trim() ? (
                  <span className="min-w-0 whitespace-pre-wrap break-words text-right text-text">{order.actualNote}</span>
                ) : (
                  <span className="text-muted">客户未填写备注</span>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {order.hasPaymentProof ? (
          <section className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">付款截图</h2>
              <button
                type="button"
                className="text-xs font-medium text-brand"
                onClick={() => {
                  setProofChecked(true);
                  setProofViewerOpen(true);
                }}
              >
                查看截图
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {order.role === "merchant"
                ? "确认收款前请打开截图，核对收款账户与金额是否与实际到账一致。"
                : "已上传给商家核对，商家确认收款后交易完成。"}
            </p>
          </section>
        ) : null}

        {order.role === "payer" && order.status === "pending_payment" ? (
          <OrderQrPanel
            title="商家收款码"
            channels={channels}
            channel={channel}
            onChannelChange={setSelectedChannel}
            dataUrl={qr.url}
            loading={qr.loading}
            error={qr.error}
            onSave={() => void handleSaveQr()}
            saving={savingQr}
          />
        ) : null}

        {order.role === "merchant" && order.status === "pending_payment" ? (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-text">当面收款</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              如果对方当面付款，可出示你的收款码。等对方在订单里点「我已支付」并上传付款截图后，再核对确认收款。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn btn-outline btn-sm flex-1"
                onClick={() => {
                  setQrDialogChannel(channel);
                  setQrDialogOpen(true);
                }}
              >
                出示收款码
              </button>
            </div>
          </section>
        ) : null}

        {order.status === "paid" || order.status === "completed" ? (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-text">订单沟通（工单）</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              如果和对方在金额、收货或退款上有争议，可以发起工单在站内沟通。工单只有订单双方能看到，超过 7 天没有新消息会自动关闭。
            </p>
            {currentTicket ? (
              <button
                type="button"
                className="btn btn-primary btn-sm mt-3 w-full"
                onClick={() => navigate(`/tickets/${currentTicket.id}`)}
              >
                查看工单
                {currentTicket.unreadCount > 0 ? `（${currentTicket.unreadCount} 条未读）` : ""}
              </button>
            ) : (
              <button type="button" className="btn btn-outline btn-sm mt-3 w-full" onClick={() => setTicketOpen(true)}>
                发起工单
              </button>
            )}
          </section>
        ) : null}

        <Timeline order={order} />
      </main>

      {showActions ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line glass safe-bottom">
          <div className="page flex gap-2 py-3">
            {order.role === "payer" && order.status === "pending_payment" ? (
              <button type="button" className="btn btn-primary btn-block" onClick={openPayDialog}>
                我已支付
              </button>
            ) : null}

            {order.role === "merchant" && order.status === "pending_payment" ? (
              <button
                type="button"
                className="btn btn-outline btn-block"
                onClick={() => {
                  setCancelReason("金额有误");
                  setCancelNote("");
                  setCancelOpen(true);
                }}
              >
                取消订单
              </button>
            ) : null}

            {order.role === "merchant" && order.status === "paid" ? (
              <>
                <button type="button" className="btn btn-outline flex-1" onClick={() => setNotReceivedOpen(true)}>
                  未收到
                </button>
                <button
                  type="button"
                  className="btn btn-primary flex-1"
                  disabled={!proofChecked}
                  title={proofChecked ? undefined : "请先查看付款截图"}
                  onClick={() => setConfirmOpen(true)}
                >
                  确认收款
                </button>
              </>
            ) : null}

            {order.role === "payer" && order.status === "paid" ? (
              <p className="w-full py-2 text-center text-xs text-muted">已标记支付，等待商家确认收款</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 备注要求 3 秒倒计时 */}
      <CountdownModal
        open={requirementOpen}
        title="商家备注要求"
        seconds={3}
        confirmText="我已阅读"
        onClose={closeRequirement}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">{order.noteRequirement}</p>
      </CountdownModal>

      {/* 我已支付 */}
      <Dialog
        open={payOpen}
        onClose={() => {
          if (!payBusy) setPayOpen(false);
        }}
        title="我已支付"
        description="请选择你实际使用的收款方式并上传付款截图，商家会逐一核对后再确认收款。"
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline flex-1" disabled={payBusy} onClick={() => setPayOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary flex-1" disabled={payBusy} onClick={() => void submitPay()}>
              {payBusy ? <Spinner size={16} /> : null}
              提交
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="label">你实际使用的收款方式</p>
            <div className="flex flex-wrap gap-2">
              {channels.length === 0 ? (
                <p className="text-xs text-danger">商家未启用收款方式，请先与商家联系</p>
              ) : (
                channels.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cn("chip", payChannel === item && "chip-active")}
                    onClick={() => setPayChannel(item)}
                  >
                    <ChannelIcon channel={item} size={15} />
                    {payChannelLabel(item)}
                  </button>
                ))
              )}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="paymentProof">
              付款截图（必填）
            </label>
            <input
              id="paymentProof"
              type="file"
              accept="image/png,image/jpeg"
              className="input py-2 text-xs"
              disabled={payBusy}
              onChange={(event) => setPayProofFile(event.target.files?.[0] ?? null)}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              支持 PNG / JPG，最大 5MB。商家确认收款前会核对这张截图
              {order.hasPaymentProof ? "（已上传过，不上传则沿用原截图）" : ""}。
            </p>
            {payProofFile ? <p className="mt-1 truncate text-[11px] text-brand">已选择：{payProofFile.name}</p> : null}
          </div>
          <div>
            <label className="label" htmlFor="actualNote">
              实际备注（默认带入预留备注，可修改）
            </label>
            <textarea
              id="actualNote"
              className="input min-h-[88px] py-3"
              value={payNote}
              maxLength={200}
              placeholder="可填写转账单号后四位、时间等信息"
              onChange={(event) => setPayNote(event.target.value)}
            />
          </div>
        </div>
      </Dialog>

      {/* 商家取消订单 */}
      <Dialog
        open={cancelOpen}
        onClose={() => {
          if (!cancelBusy) setCancelOpen(false);
        }}
        title="取消订单"
        description="请选择取消原因，付款人将看到该原因。"
        footer={
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline flex-1" disabled={cancelBusy} onClick={() => setCancelOpen(false)}>
              再想想
            </button>
            <button type="button" className="btn btn-danger flex-1" disabled={cancelBusy} onClick={() => void submitCancel()}>
              {cancelBusy ? <Spinner size={16} /> : null}
              确认取消
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {CANCEL_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                className={cn("chip", cancelReason === reason && "chip-active")}
                onClick={() => setCancelReason(reason)}
              >
                {reason}
              </button>
            ))}
          </div>
          <textarea
            className="input min-h-[72px] py-3"
            value={cancelNote}
            maxLength={200}
            placeholder="补充说明（选填）"
            onChange={(event) => setCancelNote(event.target.value)}
          />
        </div>
      </Dialog>

      {/* 商家确认收款 */}
      <ConfirmDialog
        open={confirmOpen}
        title="确认已收到款项？"
        description={`确认收款 ¥${formatCents(order.amountCents)}，订单将标记为已完成。`}
        confirmText="确认收款"
        loading={confirmBusy}
        onConfirm={() => void submitConfirm()}
        onClose={() => setConfirmOpen(false)}
      />

      {/* 商家未收到 */}
      <ConfirmDialog
        open={notReceivedOpen}
        title="标记未收到款？"
        description="订单将退回待付款，并通知付款人重新核对。"
        confirmText="未收到"
        danger
        loading={notReceivedBusy}
        onConfirm={() => void submitNotReceived()}
        onClose={() => setNotReceivedOpen(false)}
      />

      {/* 付款截图核对 */}
      <Dialog
        open={proofViewerOpen}
        onClose={() => setProofViewerOpen(false)}
        title="付款截图"
        description="请核对截图中的收款账户、金额与时间是否与实际到账一致。"
      >
        {proof.error ? (
          <p className="py-6 text-center text-xs text-danger">{proof.error}</p>
        ) : proof.loading ? (
          <div className="skeleton h-[260px] w-full" />
        ) : proof.url ? (
          <img
            src={proof.url}
            alt="付款截图"
            className="max-h-[70vh] w-full rounded-xl border border-line object-contain"
          />
        ) : (
          <p className="py-6 text-center text-xs text-muted">暂无可查看的截图</p>
        )}
      </Dialog>

      {/* 导出账单 */}
      <Dialog
        open={exportOpen}
        onClose={() => {
          if (!exportBusy) setExportOpen(false);
        }}
        title="导出账单"
        description="导出这一笔订单的交易信息，可选表格、文本或 PDF。"
      >
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { format: "csv" as const, label: "CSV 表格", hint: "Excel / WPS 可打开" },
              { format: "xlsx" as const, label: "Excel 文件", hint: ".xlsx，带表头" },
              { format: "json" as const, label: "JSON 数据", hint: "给程序或对账用" },
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
              <span className="text-[11px] text-muted">{item.hint}</span>
            </button>
          ))}
          <button
            type="button"
            className="card flex flex-col items-start gap-1 p-3 text-left"
            disabled={exportBusy !== null}
            onClick={handlePrintPdf}
          >
            <span className="text-sm font-semibold text-text">PDF（打印）</span>
            <span className="text-[11px] text-muted">打开打印页另存为 PDF</span>
          </button>
        </div>
      </Dialog>

      {/* 商家出示收款码 */}
      <Dialog
        open={qrDialogOpen}
        onClose={() => setQrDialogOpen(false)}
        title="我的收款码"
        description="请对方扫码付款，确认收到款项后点击下方按钮。"
        footer={
          <div className="space-y-2">
            <button
              type="button"
              className="btn btn-outline btn-block"
              disabled={savingQr || !qrDialogChannelResolved || !qrDialog.url}
              onClick={async () => {
                if (!order || !qrDialogChannelResolved) return;
                setSavingQr(true);
                try {
                  const blob = await getOrderQrBlob(order.id, qrDialogChannelResolved);
                  downloadBlob(blob, safeFilename(`gzspay-${order.orderNo}-${qrDialogChannelResolved}.png`));
                  toast.success("二维码已保存");
                } catch (cause) {
                  toast.error(errorMessage(cause));
                } finally {
                  setSavingQr(false);
                }
              }}
            >
              保存二维码
            </button>
          </div>
        }
      >
        {channels.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {channels.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={cn("chip", qrDialogChannelResolved === item && "chip-active")}
                  onClick={() => setQrDialogChannel(item)}
                >
                  <ChannelIcon channel={item} size={15} />
                  {payChannelLabel(item)}
                </button>
              ))}
            </div>
            <div className="flex flex-col items-center">
              {qrDialog.error ? (
                <p className="py-6 text-center text-xs text-danger">{qrDialog.error}</p>
              ) : qrDialog.loading ? (
                <div className="skeleton h-[220px] w-[220px] watch:h-[168px] watch:w-[168px]" />
              ) : (
                <QrImage dataUrl={qrDialog.url} size={220} alt="收款码" />
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-danger">尚未启用收款方式，请先在商家中心上传并启用收款码。</p>
        )}
      </Dialog>

      {/* 发起工单 */}
      <Dialog
        open={ticketOpen}
        onClose={() => {
          if (!ticketBusy) setTicketOpen(false);
        }}
        title="发起工单"
        description="说明遇到的问题，对方会在工单里回复你。工单只有订单双方可见。"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-outline flex-1"
              disabled={ticketBusy}
              onClick={() => setTicketOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={ticketBusy}
              onClick={() => void submitTicket()}
            >
              {ticketBusy ? "提交中…" : "发起工单"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted">问题类型</p>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(TICKET_CATEGORY_LABELS) as [TicketCategory, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn("chip", ticketCategory === value && "chip-active")}
                  onClick={() => setTicketCategory(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted">问题描述</p>
            <textarea
              className="input min-h-[96px] resize-none py-2.5 text-[13.5px]"
              maxLength={500}
              placeholder="例如：实际支付了 12 元，但订单显示 10 元，麻烦核对一下"
              value={ticketDescription}
              onChange={(event) => setTicketDescription(event.target.value)}
            />
            <p className="mt-1 text-right text-[10px] text-muted/80">{ticketDescription.length} / 500</p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
