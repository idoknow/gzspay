/** 底部导航：交易｜收付款（中间凸起主按钮）｜我的。 */

import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "../lib/format";

function NavIcon({ name, active }: { name: "trade" | "me"; active: boolean }): ReactNode {
  if (name === "trade") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4.5" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} />
        <path d="M8 9.5h8M8 14.5h5" stroke="currentColor" strokeWidth={active ? 2.1 : 1.8} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function NavItem({ to, label, icon }: { to: string; label: string; icon: "trade" | "me" }): ReactNode {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "mx-auto flex w-full max-w-[104px] flex-col items-center gap-1 rounded-2xl py-1.5 text-[11px] font-medium transition-colors duration-200",
          isActive ? "bg-surface-2 font-semibold text-text" : "text-muted active:bg-surface-2",
        )
      }
    >
      {({ isActive }) => (
        <>
          <NavIcon name={icon} active={isActive} />
          {label}
        </>
      )}
    </NavLink>
  );
}

export function BottomNav(): ReactNode {
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 safe-bottom">
      <div className="pointer-events-auto mx-auto mb-3 w-[calc(100%-28px)] max-w-[492px] rounded-[26px] border border-line/70 bg-surface/85 px-2 py-2 shadow-[var(--shadow-float)] backdrop-blur-xl">
        <div className="grid grid-cols-3 items-center">
          <NavItem to="/trades" label="交易" icon="trade" />

          <div className="flex justify-center">
            <NavLink
              to="/pay"
              aria-label="收付款"
              className="-mt-8 flex h-[58px] w-[58px] items-center justify-center rounded-full text-white ring-4 ring-bg transition active:scale-95"
              style={{
                background: "var(--brand-gradient)",
                boxShadow:
                  "inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 14px 26px -12px rgba(30, 107, 255, 0.85)",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path d="M7 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </NavLink>
          </div>

          <NavItem to="/me" label="我的" icon="me" />
        </div>
      </div>
    </nav>
  );
}
