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
      className="card w-full p-4 text-left transition active:bg-surface-2"
    >
      <div className="flex items-start gap-3">
        <Avatar name={name} avatarUrl={order.counterparty?.avatarUrl ?? null} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[15px] font-semibold text-text">{name}</p>
            <MoneyText cents={order.amountCents} size="md" className="shrink-0" />
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted">{summary}</p>
            <span className="shrink-0 text-[11px] text-muted">{formatFriendlyTime(order.createdAt)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={order.status} />
            {order.reservedNote ? (
              <span className="truncate text-[11px] text-muted">备注：{order.reservedNote}</span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
