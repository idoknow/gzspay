/** 底部导航：交易｜收付款（中间凸起主按钮）｜我的。 */

import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "../lib/format";

function NavIcon({ name, active }: { name: "trade" | "me"; active: boolean }): ReactNode {
  if (name === "trade") {
    return (
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4.5" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} />
        <path d="M8 9.5h8M8 14.5h5" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} />
      <path
        d="M5.5 20c.7-3.3 3.3-5.2 6.5-5.2s5.8 1.9 6.5 5.2"
        stroke="currentColor"
        strokeWidth={active ? 2.1 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BottomNav(): ReactNode {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur safe-bottom">
      <div className="mx-auto grid max-w-[520px] grid-cols-3 items-end px-6 pb-1.5 pt-2">
        <NavLink
          to="/trades"
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-1 py-1 text-[11px] font-medium transition",
              isActive ? "text-brand" : "text-muted",
            )
          }
        >
          {({ isActive }) => (
            <>
              <NavIcon name="trade" active={isActive} />
              交易
            </>
          )}
        </NavLink>

        <div className="flex flex-col items-center">
          <NavLink
            to="/pay"
            aria-label="收付款"
            className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#4a8dff] to-[#1d55e8] text-white shadow-[0_6px_18px_rgba(29,85,232,0.45)] ring-4 ring-bg transition active:scale-95"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M7 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </NavLink>
          <span className="mt-1 text-[11px] font-medium text-muted">收付款</span>
        </div>

        <NavLink
          to="/me"
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-1 py-1 text-[11px] font-medium transition",
              isActive ? "text-brand" : "text-muted",
            )
          }
        >
          {({ isActive }) => (
            <>
              <NavIcon name="me" active={isActive} />
              我的
            </>
          )}
        </NavLink>
      </div>
    </nav>
  );
}
