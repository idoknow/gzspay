/** 空态：列表没数据时使用。 */

import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ title, description, icon, action, compact = false }: EmptyStateProps): ReactNode {
  return (
    <div
      className={
        compact
          ? "flex flex-col items-center justify-center px-6 py-10 text-center"
          : "flex flex-col items-center justify-center px-6 py-16 text-center"
      }
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] bg-accent-soft text-warning ring-1 ring-accent/30">
        {icon ?? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <p className="text-[15px] font-semibold text-text">{title}</p>
      {description ? <p className="mt-1.5 max-w-[280px] text-sm leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
