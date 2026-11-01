/** 订单列表项。 */

import type { ReactNode } from "react";
import { formatFriendlyTime } from "../lib/format";
import type { Order } from "../lib/types";
import { Avatar } from "./Avatar";
import { MoneyText } from "./MoneyText";
import { StatusBadge } from "./StatusBadge";

export interface OrderCardProps {
  order: Order;
  onClick?: () => void;
}

export function OrderCard({ order, onClick }: OrderCardProps): ReactNode {
  const name =
    order.counterparty?.displayName ||
    (order.role === "payer" ? order.merchantName : order.payerNameSnapshot) ||
    "对方";
  const summary = order.items && order.items.length > 0
    ? order.items.map((item) => `${item.name}×${item.quantity}`).join("、")
    : "自定义付款";

  return (
    <button
      type="button"
      onClick={onClick}
      className="card card-interactive w-full p-4 text-left"
    >
      {/* 第一行：对方 + 金额 */}
      <div className="flex items-center gap-3">
        <Avatar name={name} avatarUrl={order.counterparty?.avatarUrl ?? null} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[15px] font-semibold leading-6 text-text">{name}</p>
            <MoneyText cents={order.amountCents} size="md" className="shrink-0" />
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted">{summary}</p>
        </div>
      </div>

      {/* 第二行：状态 + 时间 */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/70 pt-2.5">
        <StatusBadge status={order.status} />
        <span className="shrink-0 text-[11px] text-muted">{formatFriendlyTime(order.createdAt)}</span>
      </div>

      {/* 预留备注（有才显示） */}
      {order.reservedNote ? (
        <p className="mt-2 truncate rounded-xl bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted">
          备注：{order.reservedNote}
        </p>
      ) : null}
    </button>
  );
}
