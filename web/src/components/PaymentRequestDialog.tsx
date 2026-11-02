/** 全局确认请求弹窗：商家扫描我的动态码发起请求后，通过 SSE 实时弹出，核对后输入密码确认或拒绝。 */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar } from "./Avatar";
import { BuiltInKeypad } from "./BuiltInKeypad";
import { Dialog } from "./Dialog";
import { MoneyText } from "./MoneyText";
import { Spinner } from "./Loading";
import { useToast } from "./Toast";
import { acceptPaymentRequest, rejectPaymentRequest, subscribeEvents } from "../lib/api";
import { formatCountdown, formatCents } from "../lib/format";
import { ApiError, errorMessage } from "../lib/http";
import { useNow } from "../lib/hooks";
import type { PaymentRequest } from "../lib/types";

export function PaymentRequestDialog(): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [phase, setPhase] = useState<"detail" | "password">("detail");
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const now = useNow(1000);

  useEffect(() => {
    return subscribeEvents({
      onPaymentRequest: (payload) => {
        setRequest(payload);
        setPhase("detail");
      },
    });
  }, []);

  const close = (): void => {
    if (busy) return;
    setRequest(null);
    setPhase("detail");
  };

  if (!request) return null;

  const expiresMs = request.expiresAt ? Date.parse(request.expiresAt) : 0;
  const expiresIn = Number.isFinite(expiresMs) && expiresMs > 0 ? Math.max(0, Math.ceil((expiresMs - now) / 1000)) : null;
  const expired = expiresIn !== null && expiresIn <= 0;
  const merchantName = request.merchantName || request.merchant.displayName || "商家";

  const handleAccept = async (password: string): Promise<void> => {
    setAccepting(true);
    try {
      const { orderId } = await acceptPaymentRequest(request.id, password);
      toast.success("已确认");
      setRequest(null);
      setPhase("detail");
      navigate(`/orders/${orderId}`);
    } catch (cause) {
      const message = errorMessage(cause);
      const passwordIssue =
        cause instanceof ApiError &&
        (cause.code === "PAYMENT_PASSWORD_WRONG" || cause.code === "PAYMENT_PASSWORD_LOCKED");
      toast.error(message);
      if (!passwordIssue) {
        setRequest(null);
        setPhase("detail");
        throw cause;
      }
      throw cause;
    } finally {
      setAccepting(false);
    }
  };

  const handleReject = async (): Promise<void> => {
    setBusy(true);
    try {
      await rejectPaymentRequest(request.id);
      toast.info("已拒绝该请求");
      setRequest(null);
      setPhase("detail");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={request !== null}
      onClose={close}
      title={expired ? "请求已过期" : "收到确认请求"}
      description={expired ? "该请求已过期，如需处理请让商家重新发起。" : "请核对商家信息与金额，确认无误后输入密码。"}
      footer={
        phase === "detail" ? (
          expired ? (
            <button type="button" className="btn btn-outline btn-block" onClick={close}>
              关闭
            </button>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="btn btn-outline flex-1" disabled={busy} onClick={() => void handleReject()}>
                {busy ? <Spinner size={16} /> : null}
                拒绝
              </button>
              <button type="button" className="btn btn-primary flex-1" onClick={() => setPhase("password")}>
                确认提交
              </button>
            </div>
          )
        ) : (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setPhase("detail")}>
            返回
          </button>
        )
      }
    >
      {phase === "password" ? (
        <BuiltInKeypad
          title="输入密码"
          description={`向 ${merchantName} 确认 ¥${formatCents(request.amountCents)}`}
          onSubmit={handleAccept}
          onCancel={() => setPhase("detail")}
          footerExtra={
            <p className="text-center text-[11px] text-muted">
              {accepting ? "正在确认…" : "密码只在本机输入，不会显示明文"}
            </p>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={merchantName} avatarUrl={request.merchant.avatarUrl} size={46} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text">{merchantName}</p>
              <p className="mt-0.5 text-xs text-muted">
                {request.merchant.studentNoMasked ? `学号 ${request.merchant.studentNoMasked}` : "商家"}
              </p>
            </div>
            {expiresIn !== null && !expired ? (
              <span className="rounded-full bg-warning-soft px-2 py-1 text-[11px] font-medium text-warning">
                {formatCountdown(expiresIn)} 后失效
              </span>
            ) : null}
          </div>

          <div className="flex flex-col items-center rounded-2xl bg-surface-2/70 py-4">
            <MoneyText cents={request.amountCents} size="xl" />
            <p className="mt-1 text-xs text-muted">{request.title || "确认请求"}</p>
          </div>

          {request.items && request.items.length > 0 ? (
            <div className="space-y-1.5">
              {request.items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-text">
                    {item.name}
                    <span className="ml-1 text-xs text-muted">×{item.quantity}</span>
                  </span>
                  <span className="text-amount shrink-0 text-text">¥{formatCents(item.priceCents * item.quantity)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {request.reservedNote ? (
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
              备注：{request.reservedNote}
            </p>
          ) : null}

          <p className="text-center text-[11px] leading-relaxed text-muted">
            请核对对方信息与金额，确认后再提交。
          </p>
        </div>
      )}
    </Dialog>
  );
}
