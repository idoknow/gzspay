/** 金额展示：入参为「分」，展示为「元」。 */

import type { ReactNode } from "react";
import { cn, formatCents } from "../lib/format";

const SIZE_CLASS = {
  sm: "text-[15px] watch:text-[13px]",
  md: "text-xl watch:text-lg",
  lg: "text-[28px] watch:text-[22px]",
  xl: "text-[38px] watch:text-[26px]",
  hero: "text-[46px] watch:text-[30px]",
} as const;

export type MoneySize = keyof typeof SIZE_CLASS;

export interface MoneyTextProps {
  cents: number;
  size?: MoneySize;
  className?: string;
  /** 是否显示 ¥ 符号（榜单单据金额等场景可关闭） */
  symbol?: boolean;
  /** 正负号（净额可带 +） */
  signed?: boolean;
}

export function MoneyText({
  cents,
  size = "md",
  className,
  symbol = true,
  signed = false,
}: MoneyTextProps): ReactNode {
  const value = formatCents(signed ? cents : Math.abs(cents));
  const sign = signed && cents > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "text-amount inline-flex items-baseline font-bold tracking-tight",
        SIZE_CLASS[size],
        className,
      )}
    >
      {symbol ? <span className="mr-0.5 text-[0.62em] font-semibold opacity-90">¥</span> : null}
      <span>
        {sign}
        {value}
      </span>
    </span>
  );
}
