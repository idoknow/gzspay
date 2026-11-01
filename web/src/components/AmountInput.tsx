/** 金额输入框（内部用字符串，父组件转「分」；限制最多两位小数）。 */

import type { ReactNode } from "react";
import { cn, sanitizeAmountInput } from "../lib/format";

export interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 金额上限（分），超过时提示由父组件处理；这里只做展示 */
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  /** 右侧单位文本 */
  unit?: string;
}

export function AmountInput({
  value,
  onChange,
  placeholder = "0.00",
  autoFocus = false,
  disabled = false,
  className,
  unit,
}: AmountInputProps): ReactNode {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 rounded-2xl border border-line bg-surface px-4 py-3 watch:gap-1.5 watch:px-3 watch:py-2",
        className,
      )}
    >
      <span className="text-2xl font-bold text-text watch:text-lg">¥</span>
      <input
        className="min-w-0 flex-1 bg-transparent text-[32px] font-bold tracking-tight text-text outline-none placeholder:text-surface-3 watch:text-[24px]"
        value={value}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(sanitizeAmountInput(event.target.value))}
      />
      {unit ? <span className="shrink-0 text-sm text-muted watch:text-[11px]">{unit}</span> : null}
    </div>
  );
}
