/** 眼睛图标：用于卡号等敏感信息的「显示 / 隐藏」切换。 */
import type { ReactNode } from "react";

export interface EyeIconProps {
  /** 是否画一条斜线（表示当前已展示内容，点击后隐藏） */
  off?: boolean;
  size?: number;
  className?: string;
}

export function EyeIcon({ off = false, size = 16, className }: EyeIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2.6 12S6.2 6.2 12 6.2 21.4 12 21.4 12 17.8 17.8 12 17.8 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="2.7" />
      {off ? <path d="M4.2 19.8 19.8 4.2" /> : null}
    </svg>
  );
}
