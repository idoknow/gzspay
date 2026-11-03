/** ICP 备案号：登录页、全站底部、使用文档与关于页共用，点击跳转工信部备案系统。 */

import { useEffect, useState, type ReactNode } from "react";
import { getSetupStatus } from "../lib/api";
import { cn } from "../lib/format";
import { useAuth } from "../lib/session";

const BEIAN_URL = "https://beian.miit.gov.cn/";

let cachedIcp: string | null = null;
let pending: Promise<string> | null = null;

/** 会话里没有备案号时（例如旧缓存），兜底拉一次初始化状态 */
function loadIcp(): Promise<string> {
  if (cachedIcp !== null) return Promise.resolve(cachedIcp);
  if (!pending) {
    pending = getSetupStatus()
      .then((status) => {
        cachedIcp = (status.system.icp ?? "").trim();
        return cachedIcp;
      })
      .catch(() => "")
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** 备案信息的小盾牌图标 */
function ShieldIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 opacity-80"
    >
      <path d="M12 3.2 19 6v5.6c0 4.3-2.9 7.9-7 9.2-4.1-1.3-7-4.9-7-9.2V6l7-2.8Z" />
      <path d="m9.1 12.1 2 2 3.8-3.9" />
    </svg>
  );
}

export function SiteIcp({
  icp,
  className,
  tone = "muted",
  size = "sm",
}: {
  /** 显式传入备案号（优先于会话与接口） */
  icp?: string | null;
  className?: string;
  /** hero：用于渐变卡片内的浅色文字 */
  tone?: "muted" | "hero";
  /** 字号档位：xs 10px / sm 11px */
  size?: "xs" | "sm";
}): ReactNode {
  const { session } = useAuth();
  const fromSession = session.site?.icp;
  const [fallback, setFallback] = useState("");
  const needsFetch = icp === undefined && fromSession === undefined;

  useEffect(() => {
    if (!needsFetch) return;
    let active = true;
    void loadIcp().then((value) => {
      if (active) setFallback(value);
    });
    return () => {
      active = false;
    };
  }, [needsFetch]);

  const text = (icp ?? fromSession ?? fallback ?? "").trim();
  if (!text) return null;

  return (
    <a
      href={BEIAN_URL}
      target="_blank"
      rel="noreferrer noopener"
      title={`${text} · 工业和信息化部备案`}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium leading-none transition-colors duration-200",
        size === "xs" ? "text-[10px]" : "text-[11px]",
        tone === "hero"
          ? "border-[color:var(--hero-ring)] bg-[color:var(--hero-chip)] text-[color:var(--hero-fg-soft)] hover:text-[color:var(--hero-fg)]"
          : "border-line/60 bg-surface/55 text-muted backdrop-blur-sm hover:border-line hover:bg-surface-2 hover:text-text",
        className,
      )}
    >
      <ShieldIcon />
      <span className="truncate">{text}</span>
    </a>
  );
}
