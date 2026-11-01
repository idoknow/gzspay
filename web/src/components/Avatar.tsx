/** 用户头像：有头像地址用图片，否则用姓名首字 + 渐变底色。方形圆角（非正圆）。 */

import type { ReactNode } from "react";
import { cn, initialsOf } from "../lib/format";

const TONES = [
  "linear-gradient(135deg,#ffc94d,#f5a623)",
  "linear-gradient(135deg,#4a8dff,#1d55e8)",
  "linear-gradient(135deg,#35c98f,#0f9a63)",
  "linear-gradient(135deg,#ff8a8d,#e5484d)",
  "linear-gradient(135deg,#8b7bff,#5b4bdb)",
  "linear-gradient(135deg,#46c5e8,#1f8fb5)",
];

function toneFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100000;
  }
  return TONES[hash % TONES.length] ?? TONES[0] ?? "";
}

export interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
  /** true 时用正圆（少数场景）；默认方形圆角 */
  rounded?: boolean;
}

export function Avatar({ name, avatarUrl, size = 44, className, rounded = false }: AvatarProps): ReactNode {
  const fontSize = Math.max(12, Math.round(size * 0.4));
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 font-bold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: rounded ? "9999px" : `${Math.round(size * 0.3)}px`,
        background: avatarUrl ? undefined : toneFor(name),
        fontSize,
      }}
      aria-hidden="true"
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
