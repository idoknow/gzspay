/** 订单状态标签。 */

import type { ReactNode } from "react";
import { cn, orderStatusLabel, orderStatusTone } from "../lib/format";
import type { OrderStatus } from "../lib/types";

const TONE_CLASS = {
  warning: "bg-warning-soft text-warning",
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  muted: "bg-surface-2 text-muted",
} as const;

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        TONE_CLASS[orderStatusTone(status)],
        className,
      )}
    >
      {orderStatusLabel(status)}
    </span>
  );
}
