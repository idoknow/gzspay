/** gzspay 品牌标识：蓝底圆角方块 + 白色 g + 暖黄硬币（内联 SVG，颜色跟随主题变量）。 */

import type { ReactNode } from "react";
import { cn } from "../lib/format";

export interface LogoMarkProps {
  /** 边长（像素） */
  size?: number;
  /** 启动动画：整体淡入 + 硬币翻转一圈后定格 */
  animated?: boolean;
  className?: string;
}

export function LogoMark({ size = 64, animated = false, className }: LogoMarkProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="gzspay"
      className={cn("shrink-0", animated && "logo-animated", className)}
    >
      <rect width="120" height="120" rx="30" className="logo-mark-bg" />
      <g fill="none" stroke="#ffffff" strokeWidth="11" strokeLinecap="round">
        <g className={animated ? "logo-coin" : undefined}>
          <circle cx="60" cy="50" r="19" className="logo-coin-face" />
        </g>
        <path d="M79 50V74a16 16 0 0 1-16 16H49" />
      </g>
    </svg>
  );
}

export type WordmarkSize = "sm" | "md" | "lg" | "xl" | "display";

const WORDMARK_SIZE_CLASS: Record<WordmarkSize, string> = {
  sm: "text-[19px]",
  md: "text-[26px]",
  lg: "text-[34px]",
  xl: "text-[44px]",
  display: "text-[76px]",
};

export interface WordmarkProps {
  size?: WordmarkSize;
  animated?: boolean;
  className?: string;
}

/** 「gzs(海军蓝) + pay(品牌蓝)」两色字标，Nunito 800。 */
export function Wordmark({ size = "md", animated = false, className }: WordmarkProps): ReactNode {
  return (
    <span
      className={cn(
        "logo-wordmark",
        WORDMARK_SIZE_CLASS[size],
        animated && "wordmark-in",
        className,
      )}
    >
      <span className="logo-wordmark-gzs">gzs</span>
      <span className="logo-wordmark-pay">pay</span>
    </span>
  );
}

export interface TaglineProps {
  animated?: boolean;
  className?: string;
}

/** 「CAMPUS SERVICE」字距副标（中性文案，不出现支付类字样）。 */
export function Tagline({ animated = false, className }: TaglineProps): ReactNode {
  return (
    <span className={cn("logo-tagline", animated && "wordmark-in", className)}>CAMPUS SERVICE</span>
  );
}

export interface LogoProps {
  /** 边长（像素） */
  size?: number;
  /** 启动动画：logo 淡入 + 硬币翻转一圈定格 */
  animated?: boolean;
  /** 是否显示 gzspay 字标 */
  wordmark?: boolean;
  /** 竖向排列（启动页） / 横向排列 */
  direction?: "row" | "column";
  className?: string;
  wordmarkClassName?: string;
}

function wordmarkSizeOf(size: number): WordmarkSize {
  if (size >= 56) return "lg";
  if (size >= 40) return "md";
  return "sm";
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
        direction === "column" ? "flex-col gap-3" : "flex-row gap-2.5",
        className,
      )}
    >
      <LogoMark size={size} animated={animated} />
      {wordmark ? (
        <Wordmark
          size={wordmarkSizeOf(size)}
          animated={animated}
          className={wordmarkClassName}
        />
      ) : null}
    </div>
  );
}
