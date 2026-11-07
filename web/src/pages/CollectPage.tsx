/**
 * 付款人打开商家收款单：核对金额、备注要求后输入支付密码，按快照金额创建订单。
 * 两种入口：收款链接（令牌）与扫商家校园卡（收款单 id）。
 */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { ChannelBadges } from "../components/ChannelBadges";
import { useCopy, useContextMenus, type ContextMenuItem } from "../components/ContextMenu";
import { CopyIcon, RefreshIcon } from "../components/ContextMenuIcons";
import { CountdownModal } from "../components/CountdownModal";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { MoneyText } from "../components/MoneyText";
import { PageHeader } from "../components/PageHeader";
import { PaymentPasswordDialog } from "../components/PaymentPasswordDialog";
import { useToast } from "../components/Toast";
import {
  payPaymentCollection,
  payPaymentCollectionById,
  previewPaymentCollection,
  previewPaymentCollectionById,
} from "../lib/api";
import { formatCents, formatCountdown } from "../lib/format";
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
  const { token = "", id = "" } = useParams<{ token?: string; id?: string }>();
  const toast = useToast();
  const navigate = useNavigate();
  /** 右键 / 长按菜单复制时统一用 ContextMenu 的 useCopy（带 toast 反馈） */
  const copy = useCopy();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [requirementOpen, setRequirementOpen] = useState(false);
  const [remaining, setRemaining] = useState(0);

  const { data, loading, error, reload } = useAsync<PaymentCollectionPreview>(
    () => (id ? previewPaymentCollectionById(id) : previewPaymentCollection(token)),
    [id, token],
  );

  useEffect(() => {
    if (!data) return;
    const tick = (): void => setRemaining(secondsLeft(data.expiresAt));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [data]);

  const submit = async (password: string): Promise<void> => {
    const result = id
      ? await payPaymentCollectionById(id, password)
      : await payPaymentCollection(token, password);
    setPasswordOpen(false);
    toast.success("付款成功");
    navigate(`/orders/${result.order.id}`);
  };

  /** 右键 / 长按菜单：收款单卡片上复制核对信息，或重新拉取最新状态 */
  const menus = {
    "collect.card": (): ContextMenuItem[] | null => {
      if (!data) return null;
      const merchantName = data.merchantName || data.merchant.displayName;
      const amountText = `¥${formatCents(data.amountCents)}`;
      const summary = [
        `收款人：${merchantName}`,
        `金额：${amountText}`,
        data.title ? `事由：${data.title}` : "",
        data.reservedNote ? `备注：${data.reservedNote}` : "",
        data.noteRequirement.trim() ? `商家要求：${data.noteRequirement}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return [
        { label: "复制收款信息", icon: <CopyIcon />, onSelect: () => void copy(summary, "收款信息") },
        { label: "复制金额", icon: <CopyIcon />, onSelect: () => void copy(amountText, "金额") },
        { label: "复制收款人姓名", icon: <CopyIcon />, onSelect: () => void copy(merchantName, "收款人姓名") },
        { type: "separator" },
        { label: "刷新收款单", icon: <RefreshIcon />, onSelect: reload },
      ];
    },
  };

  useContextMenus(menus);

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
        <EmptyState title="收款单不存在" description="链接可能已失效" />
      </Shell>
    );
  }

  if (!data.payeable) {
    const failedText =
      data.status === "used"
        ? "请让商家重新发起"
        : "已过期或作废，请让商家重新发起";
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
  const requirement = data.noteRequirement.trim();

  return (
    <Shell>
      <section className="card p-5 text-center" data-menu="collect.card">
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

        {requirement ? (
          <div className="mt-4 rounded-2xl bg-brand-soft/70 px-3 py-2.5 text-left">
            <p className="text-[11px] font-semibold text-brand">商家备注要求</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-text">{requirement}</p>
          </div>
        ) : null}

        <p className="mt-4 text-[11px] text-muted">
          {expired ? "收款单已过期，请让商家重新发起" : `${formatCountdown(remaining)} 后失效`}
        </p>

        <button
          type="button"
          className="btn btn-primary btn-block mt-4"
          disabled={expired}
          onClick={() => {
            if (requirement) {
              setRequirementOpen(true);
              return;
            }
            setPasswordOpen(true);
          }}
        >
          确认付款
        </button>
        <p className="mt-2 text-[11px] text-muted">请核对收款人与金额</p>
      </section>

      <section className="card p-4">
        <p className="text-[11px] font-medium text-muted">商家支持的收款方式</p>
        <div className="mt-2">
          <ChannelBadges channels={data.channels} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          付款后在订单详情点「我已支付」并上传截图。
        </p>
      </section>

      <CountdownModal
        open={requirementOpen}
        title="商家备注要求"
        seconds={3}
        confirmText="我已阅读"
        onClose={() => {
          setRequirementOpen(false);
          setPasswordOpen(true);
        }}
      >
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">{requirement}</p>
      </CountdownModal>

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
