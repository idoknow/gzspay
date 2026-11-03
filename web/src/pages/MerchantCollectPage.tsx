/**
 * 商家发起收款：输入金额后生成一笔一次性收款单，页面上展示实时二维码；
 * 付款人扫码直接进入收款单页面付款；商家关闭页面（或点「关闭」）后收款单立即作废。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AmountInput } from "../components/AmountInput";
import { EmptyState } from "../components/EmptyState";
import { MoneyText } from "../components/MoneyText";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";
import { cancelPaymentCollection, createPaymentCollection, getPaymentCollection } from "../lib/api";
import { formatCountdown, yuanToCents } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useQrDataUrl } from "../lib/qr";
import { useAuth } from "../lib/session";
import type { PaymentCollection, PaymentCollectionCreateResult } from "../lib/types";

const STATUS_LABELS: Record<PaymentCollection["status"], string> = {
  pending: "等待付款",
  used: "已付款",
  cancelled: "已作废",
  expired: "已过期",
};

function secondsLeft(expiresAt: string): number {
  const time = Date.parse(expiresAt);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.round((time - Date.now()) / 1000));
}

function StatusBadge({ status }: { status: PaymentCollection["status"] }): ReactNode {
  const tone =
    status === "pending"
      ? "chip"
      : status === "used"
        ? "chip border-transparent bg-[color:var(--success-soft,#e7f7ef)] text-[color:var(--success,#0f7a54)]"
        : "chip text-muted";
  return <span className={tone}>{STATUS_LABELS[status]}</span>;
}

export function MerchantCollectPage(): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<PaymentCollectionCreateResult | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const pendingRef = useRef<string | null>(null);

  const { dataUrl: qrDataUrl, error: qrError } = useQrDataUrl(result?.url ?? null, 520);

  const amountCents = yuanToCents(amount) ?? 0;

  // 当前待付款收款单：关闭页面/离开时自动作废
  useEffect(() => {
    pendingRef.current =
      result && result.collection.status === "pending" ? result.collection.id : null;
  }, [result]);

  const cancelQuietly = useCallback((id: string): void => {
    // 页面卸载时用 keepalive 请求，保证关闭浏览器/返回上一页也能作废
    void fetch(`/api/merchant/collections/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "X-Requested-With": "gzspay" },
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const handler = (): void => {
      const id = pendingRef.current;
      if (id) cancelQuietly(id);
    };
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      const id = pendingRef.current;
      if (id) cancelQuietly(id);
    };
  }, [cancelQuietly]);

  // 收款单倒计时
  useEffect(() => {
    if (!result) return;
    const tick = (): void => setRemaining(secondsLeft(result.collection.expiresAt));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [result]);

  // 轮询状态：付款人付完款后自动跳订单详情
  useEffect(() => {
    if (!result || result.collection.status !== "pending") return;
    const id = result.collection.id;
    const timer = window.setInterval(() => {
      void getPaymentCollection(id)
        .then((next) => {
          setResult((current) => (current ? { ...current, collection: next } : current));
          if (next.status === "used" && next.orderId) {
            toast.success("对方已付款，正在跳转到订单详情");
            navigate(`/orders/${next.orderId}`);
          }
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [result?.collection.id, result?.collection.status, navigate, toast]);

  const submit = async (): Promise<void> => {
    if (amountCents <= 0) {
      toast.error("请输入大于 0 的收款金额");
      return;
    }
    setCreating(true);
    try {
      const created = await createPaymentCollection({
        amountCents,
        reservedNote: note.trim() || null,
      });
      setResult(created);
      setAmount("");
      setNote("");
      toast.success("收款单已生成，让对方扫页面上的二维码付款");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  const cancelResult = async (): Promise<void> => {
    if (!result) return;
    setCancelling(true);
    try {
      const next = await cancelPaymentCollection(result.collection.id);
      setResult((current) => (current ? { ...current, collection: next } : current));
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setCancelling(false);
    }
  };

  const closeAndCancel = async (): Promise<void> => {
    await cancelResult();
    toast.success("收款单已关闭并作废");
    navigate(-1);
  };

  const restart = async (): Promise<void> => {
    await cancelResult();
    setResult(null);
  };

  if (!me?.isMerchant) {
    return (
      <div className="min-h-[100dvh] bg-app pb-28">
        <PageHeader title="发起收款" back />
        <div className="px-4">
          <EmptyState
            title="还不是商家"
            description="注册商家后就可以创建指定金额的收款单，让对方扫码直接付款。"
            action={
              <button type="button" className="btn btn-primary" onClick={() => navigate("/merchant/register")}>
                去注册商家
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-app pb-28">
      <PageHeader title="发起收款" subtitle="输入金额生成实时二维码，对方扫码即可付款" back />

      <div className="space-y-4 px-4">
        {result ? (
          <section className="card p-5 text-center">
            <div className="flex items-center justify-between">
              <StatusBadge status={result.collection.status} />
              <span className="text-xs text-muted">
                {result.collection.status === "pending"
                  ? `${formatCountdown(remaining)} 后失效`
                  : STATUS_LABELS[result.collection.status]}
              </span>
            </div>
            <h2 className="mt-3 text-base font-bold text-text">{result.collection.title}</h2>
            <div className="mt-1">
              <MoneyText cents={result.collection.amountCents} size="xl" />
            </div>
            {result.collection.reservedNote ? (
              <p className="mt-2 text-xs text-muted">备注：{result.collection.reservedNote}</p>
            ) : null}

            {result.collection.status === "pending" ? (
              <>
                <div className="mx-auto mt-4 w-fit rounded-3xl border border-line bg-white p-3 shadow-sm">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="收款二维码" className="h-[220px] w-[220px]" />
                  ) : qrError ? (
                    <p className="w-[220px] py-10 text-xs text-danger">{qrError}</p>
                  ) : (
                    <div className="skeleton h-[220px] w-[220px]" />
                  )}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  让对方扫这个实时二维码付款，金额与备注会自动带过去。
                  <br />
                  关闭本页或点「关闭并作废」后二维码立即失效。
                </p>
                <p className="mt-2 break-all text-[11px] text-muted">{result.url}</p>
              </>
            ) : null}

            <div className="mt-4 flex gap-2">
              {result.collection.status === "pending" ? (
                <button type="button" className="btn btn-ghost flex-1" disabled={cancelling} onClick={() => void closeAndCancel()}>
                  {cancelling ? "正在作废…" : "关闭并作废"}
                </button>
              ) : null}
            </div>

            <button type="button" className="btn btn-primary btn-block mt-3" onClick={() => void restart()}>
              再发起一笔
            </button>
            <p className="mt-2 text-[11px] text-muted">收款单只能使用一次，付款成功后自动失效；30 分钟内有效。</p>
          </section>
        ) : (
          <>
            <section className="card p-4">
              <AmountInput value={amount} onChange={setAmount} placeholder="0.00" />
              <p className="mt-2 text-[11px] text-muted">单笔上限与商家订单一致；付款人扫码后会看到金额与备注。</p>

              <div className="divider my-4" />
              <label className="label" htmlFor="collectionNote">
                备注（选填，会展示给付款人）
              </label>
              <textarea
                id="collectionNote"
                className="input min-h-[72px] py-3"
                value={note}
                maxLength={200}
                placeholder="例如：奶茶两杯"
                onChange={(event) => setNote(event.target.value)}
              />

              <div className="mt-4 flex items-center justify-between rounded-2xl bg-surface px-4 py-3 shadow-sm">
                <span className="text-sm text-muted">应收</span>
                <MoneyText cents={amountCents} size="lg" />
              </div>

              <button
                type="button"
                className="btn btn-primary btn-block mt-3"
                disabled={creating || amountCents <= 0}
                onClick={submit}
              >
                {creating ? "正在创建…" : "生成收款二维码"}
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
