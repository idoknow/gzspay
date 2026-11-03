/**
 * 商家发起收款：先填好金额或点选商品，生成一次性收款单的二维码 / 链接，
 * 付款人扫码确认并输入支付密码后按快照金额创建订单，收款单随即失效。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AmountInput } from "../components/AmountInput";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock, Spinner } from "../components/Loading";
import { MoneyText } from "../components/MoneyText";
import { PageHeader } from "../components/PageHeader";
import { ProductPicker, selectedToItems, sumProductCents } from "../components/ProductPicker";
import { useToast } from "../components/Toast";
import {
  cancelPaymentCollection,
  createPaymentCollection,
  getPaymentCollection,
  listPaymentCollections,
  listProducts,
} from "../lib/api";
import { cn, formatCents, formatCountdown, formatDateTime, yuanToCents } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAsync } from "../lib/hooks";
import { useQrDataUrl } from "../lib/qr";
import { useAuth } from "../lib/session";
import type { PaymentCollection, PaymentCollectionCreateResult, Product } from "../lib/types";

type Mode = "amount" | "products";

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
  const [mode, setMode] = useState<Mode>("amount");
  const [amount, setAmount] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<PaymentCollectionCreateResult | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);

  const products = useAsync<Product[]>(() => listProducts(), []);
  const recent = useAsync<PaymentCollection[]>(() => listPaymentCollections(10), []);

  const { dataUrl, error: qrError } = useQrDataUrl(result?.url ?? "", 520);

  const productList = products.data ?? [];
  const productItems = useMemo(
    () => (mode === "products" ? selectedToItems(productList, selected) : []),
    [mode, productList, selected],
  );
  const productCents = mode === "products" ? sumProductCents(productList, selected) : 0;
  const amountCents = mode === "amount" ? (yuanToCents(amount) ?? 0) : productCents;

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
      toast.error(mode === "amount" ? "请输入大于 0 的收款金额" : "请选择商品");
      return;
    }
    setCreating(true);
    try {
      const created = await createPaymentCollection({
        amountCents: mode === "amount" ? amountCents : undefined,
        items: mode === "products" ? productItems : undefined,
        reservedNote: note.trim() || null,
      });
      setResult(created);
      setCopied(false);
      setAmount("");
      setSelected({});
      setNote("");
      recent.reload();
      toast.success("收款单已创建，让对方扫码付款");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (): Promise<void> => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      toast.success("链接已复制");
    } catch {
      toast.error("复制失败，请长按链接手动复制");
    }
  };

  const cancelResult = async (): Promise<void> => {
    if (!result) return;
    setCancelling(true);
    try {
      const next = await cancelPaymentCollection(result.collection.id);
      setResult((current) => (current ? { ...current, collection: next } : current));
      recent.reload();
      toast.success("收款单已作废");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setCancelling(false);
    }
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
      <PageHeader title="发起收款" subtitle="填好金额或选好商品，生成二维码让对方扫码付款" back />

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

            <div className="mx-auto mt-4 flex w-full max-w-[260px] items-center justify-center rounded-3xl bg-white p-3 shadow-sm">
              {qrError ? (
                <p className="py-10 text-xs text-muted">{qrError}</p>
              ) : dataUrl ? (
                <img src={dataUrl} alt="收款二维码" className="h-auto w-full" />
              ) : (
                <div className="flex h-[230px] items-center justify-center">
                  <Spinner size={22} />
                </div>
              )}
            </div>

            <p className="mt-3 break-all rounded-2xl bg-surface-2/70 px-3 py-2 text-[11px] text-muted">
              {result.url}
            </p>

            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-secondary flex-1" onClick={copyLink}>
                {copied ? "已复制" : "复制链接"}
              </button>
              {result.collection.status === "pending" ? (
                <button
                  type="button"
                  className="btn btn-ghost flex-1"
                  disabled={cancelling}
                  onClick={cancelResult}
                >
                  {cancelling ? "正在作废…" : "作废收款单"}
                </button>
              ) : null}
            </div>

            <button type="button" className="btn btn-primary btn-block mt-3" onClick={() => setResult(null)}>
              再发起一笔
            </button>
            <p className="mt-2 text-[11px] text-muted">
              收款单只能使用一次，付款成功后自动失效；二维码 30 分钟内有效。
            </p>
          </section>
        ) : (
          <>
            <section className="card p-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  className={cn("chip flex-1 justify-center", mode === "amount" && "chip-active")}
                  onClick={() => setMode("amount")}
                >
                  输入金额
                </button>
                <button
                  type="button"
                  className={cn("chip flex-1 justify-center", mode === "products" && "chip-active")}
                  onClick={() => setMode("products")}
                >
                  选择商品
                </button>
              </div>

              {mode === "amount" ? (
                <div className="mt-4">
                  <AmountInput value={amount} onChange={setAmount} placeholder="0.00" />
                  <p className="mt-2 text-[11px] text-muted">
                    单笔上限与商家订单一致；付款人扫码后会看到金额与备注。
                  </p>
                </div>
              ) : products.loading ? (
                <div className="mt-4">
                  <LoadingBlock text="正在加载商品…" />
                </div>
              ) : products.error ? (
                <div className="mt-4">
                  <ErrorBlock message={products.error} onRetry={products.reload} compact />
                </div>
              ) : productList.length === 0 ? (
                <p className="mt-4 text-xs text-muted">还没有上架商品，可以先用「输入金额」收款。</p>
              ) : (
                <div className="mt-4">
                  <ProductPicker products={productList} selected={selected} onChange={setSelected} />
                  <p className="mt-2 text-sm text-muted">
                    合计 <MoneyText cents={productCents} size="md" />
                  </p>
                </div>
              )}

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

            <section className="card p-4">
              <h2 className="text-sm font-semibold text-text">最近的收款单</h2>
              {recent.loading ? (
                <div className="mt-3">
                  <LoadingBlock text="正在加载…" />
                </div>
              ) : (recent.data ?? []).length === 0 ? (
                <p className="mt-2 text-xs text-muted">还没有创建过收款单。</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {(recent.data ?? []).map((item) => (
                    <li key={item.id} className="flex items-center gap-3">
                      <Avatar name={item.merchant?.displayName} avatarUrl={item.merchant?.avatarUrl} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text">{item.title}</p>
                        <p className="text-[11px] text-muted">
                          {formatDateTime(item.createdAt)} · {item.merchantName}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-text">{formatCents(item.amountCents)}</span>
                        <StatusBadge status={item.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
