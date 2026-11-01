/** 页脚：版权归 idoknow 组织所有。 */

import type { ReactNode } from "react";
import { cn } from "../lib/format";

export function AppFooter({ className }: { className?: string }): ReactNode {
  return (
    <p className={cn("text-center text-[11px] leading-relaxed text-muted", className)}>
      © {new Date().getFullYear()} idoknow 组织 · gzspay 桂中校园收付款
    </p>
  );
}
