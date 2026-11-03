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

export function SiteIcp({
  icp,
  className,
  tone = "muted",
}: {
  /** 显式传入备案号（优先于会话与接口） */
  icp?: string | null;
  className?: string;
  /** hero：用于渐变卡片内的浅色文字 */
  tone?: "muted" | "hero";
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
      className={cn(
        "inline-block max-w-full truncate text-[11px] transition-colors duration-200",
        tone === "hero"
          ? "text-[color:var(--hero-fg-faint)] hover:text-[color:var(--hero-fg)]"
          : "text-muted hover:text-text",
        className,
      )}
    >
      {text}
    </a>
  );
}
