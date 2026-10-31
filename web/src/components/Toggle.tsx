/** 开关（设置项、商家渠道启用）。 */

import type { ReactNode } from "react";
import { cn } from "../lib/format";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export function Toggle({ checked, onChange, disabled = false, label, className }: ToggleProps): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40",
        checked ? "bg-brand" : "bg-surface-3",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block h-6 w-6 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
