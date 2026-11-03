/** 付款人扫码打开商家收款单：核对金额后输入支付密码，按快照金额创建订单。 */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { MoneyText } from "../components/MoneyText";
import { PageHeader } from "../components/PageHeader";
import { PaymentPasswordDialog } from "../components/PaymentPasswordDialog";
import { useToast } from "../components/Toast";
import { payPaymentCollection, previewPaymentCollection } from "../lib/api";
import { formatCountdown } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAsync } from "../lib/hooks";
import type { PaymentCollectionPreview } from "../lib/types";

function secondsLeft(expiresAt: string): number {
  const time = Date.parse(expiresAt);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.round((time - Date.now()) / 1000));
}

function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="min-h-[100dvh] bg-app pb-28">
      <PageHeader title="确认付款" back />
      <div className="space-y-4 px-4">{children}</div>
    </div>
  );
}

export function CollectPage(): ReactNode {
  const { token = "" } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync<PaymentCollectionPreview>(
    () => previewPaymentCollection(token),
    [token],
  );
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!data) return;
    const tick = (): void => setRemaining(secondsLeft(data.expiresAt));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [data]);

  const submit = async (password: string): Promise<void> => {
    const result = await payPaymentCollection(token, password);
    setPasswordOpen(false);
    toast.success("付款成功");
    navigate(`/orders/${result.order.id}`);
  };

  if (loading) {
    return (
      <Shell>
        <LoadingBlock text="正在打开收款单…" />
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <ErrorBlock message={error} onRetry={reload} />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <EmptyState title="收款单不存在" description="链接可能已失效，请让商家重新发起收款。" />
      </Shell>
    );
  }

  if (!data.payeable) {
    const failedText =
      data.status === "used"
        ? "这笔收款单已经被使用过了，请让商家重新发起。"
        : "收款单已过期或已作废，请让商家重新发起。";
    return (
      <Shell>
        <EmptyState
          title={data.status === "used" ? "收款单已付款" : "收款单已失效"}
          description={failedText}
          action={
            data.orderId ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate(`/orders/${data.orderId}`)}
              >
                查看订单
              </button>
            ) : null
          }
        />
      </Shell>
    );
  }

  const expired = remaining <= 0;

  return (
    <Shell>
      <section className="card p-5 text-center">
        <div className="flex flex-col items-center gap-2">
          <Avatar name={data.merchantName || data.merchant.displayName} avatarUrl={data.merchant.avatarUrl} size={56} />
          <div>
            <p className="text-sm font-semibold text-text">{data.merchantName}</p>
            <p className="text-[11px] text-muted">向你发起一笔收款</p>
          </div>
        </div>

        <div className="mt-4">
          <MoneyText cents={data.amountCents} size="xl" />
        </div>
        <p className="mt-1 text-sm text-text">{data.title}</p>
        {data.reservedNote ? <p className="mt-1 text-xs text-muted">备注：{data.reservedNote}</p> : null}

        {data.items && data.items.length > 0 ? (
          <ul className="mt-4 space-y-2 rounded-2xl bg-surface-2/70 p-3 text-left">
            {data.items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex items-center justify-between text-sm">
                <span className="min-w-0 flex-1 truncate text-text">{item.name}</span>
                <span className="ml-3 shrink-0 text-muted">
                  x{item.quantity} · ¥{((item.priceCents * item.quantity) / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-4 text-[11px] text-muted">
          {expired ? "收款单已过期，请让商家重新发起" : `${formatCountdown(remaining)} 后失效`}
        </p>

        <button
          type="button"
          className="btn btn-primary btn-block mt-4"
          disabled={expired}
          onClick={() => setPasswordOpen(true)}
        >
          确认付款
        </button>
        <p className="mt-2 text-[11px] text-muted">核对商家与金额无误后，输入支付密码完成付款</p>
      </section>

      <PaymentPasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onSubmit={submit}
        title="输入支付密码"
        description={`向 ${data.merchantName} 付款 ¥${(data.amountCents / 100).toFixed(2)}`}
      />
    </Shell>
  );
}
