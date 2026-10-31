/** gzspay 品牌 logo：蓝底白 g + 暖黄硬币（内联 SVG，支持启动动画）。 */

import type { ReactNode } from "react";
import { cn } from "../lib/format";

export interface LogoMarkProps {
  /** 边长（像素） */
  size?: number;
  /** 启动页动画：logo 淡入 + 硬币翻转一圈定格 */
  animated?: boolean;
  className?: string;
}

export function LogoMark({ size = 64, animated = false, className }: LogoMarkProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="gzspay"
      className={cn(animated && "logo-animated", className)}
    >
      <defs>
        <linearGradient id="gz-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3f8cff" />
          <stop offset="1" stopColor="#1d55e8" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#gz-logo-gradient)" />
      <text
        x="30"
        y="47"
        textAnchor="middle"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
        fontSize="42"
        fontWeight="800"
        fill="#ffffff"
      >
        g
      </text>
      <circle
        className={animated ? "logo-coin" : undefined}
        cx="39"
        cy="34"
        r="9"
        fill="#ffc133"
      />
    </svg>
  );
}

export interface LogoProps extends LogoMarkProps {
  /** 是否显示 gzspay 字标 */
  wordmark?: boolean;
  /** 竖向排列（启动页） / 横向排列 */
  direction?: "row" | "column";
  wordmarkClassName?: string;
}

export function Logo({
  size = 64,
  animated = false,
  wordmark = false,
  direction = "row",
  className,
  wordmarkClassName,
}: LogoProps): ReactNode {
  return (
    <div
      className={cn(
        "inline-flex items-center",
        direction === "column" ? "flex-col gap-3" : "flex-row gap-3",
        className,
      )}
    >
      <LogoMark size={size} animated={animated} />
      {wordmark ? (
        <span
          className={cn(
            "text-2xl font-extrabold tracking-tight text-text",
            animated && "wordmark-in",
            wordmarkClassName,
          )}
        >
          gzspay
        </span>
      ) : null}
    </div>
  );
}
