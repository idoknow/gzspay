/** 右键菜单用的线性图标（16px，跟随 currentColor）。 */

import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 15, className, children }: IconProps & { children: ReactNode }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function CopyIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" />
    </Svg>
  );
}

export function OpenIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4.5A2.5 2.5 0 0 1 15.5 21h-9A2.5 2.5 0 0 1 4 18.5v-9A2.5 2.5 0 0 1 6.5 7H11" />
    </Svg>
  );
}

export function DownloadIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </Svg>
  );
}

export function PrintIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M7 8V4.5h10V8" />
      <rect x="3.5" y="8" width="17" height="7.5" rx="2" />
      <path d="M7 13h10v6.5H7z" />
    </Svg>
  );
}

export function RefreshIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M20 11a8 8 0 1 0-2.6 6" />
      <path d="M20 4.5V11h-6.5" />
    </Svg>
  );
}

export function TicketIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4 9.5V7a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17v-2.5a2.5 2.5 0 0 0 0-5Z" />
      <path d="M10 9.5v5" strokeDasharray="2 2.5" />
    </Svg>
  );
}

export function EyeOffSafeIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M3 12s3.4-5.5 9-5.5 9 5.5 9 5.5-3.4 5.5-9 5.5S3 12 3 12Z" />
      <circle cx="12" cy="12" r="2.4" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.8 7l.7 11.3A2 2 0 0 0 9.5 20h5a2 2 0 0 0 2-1.7L17.2 7" />
      <path d="M10.5 10.5v6M13.5 10.5v6" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4.5 12h15" />
      <path d="m13.5 5.5 6.5 6.5-6.5 6.5" />
    </Svg>
  );
}

export function MenuIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15" />
    </Svg>
  );
}
