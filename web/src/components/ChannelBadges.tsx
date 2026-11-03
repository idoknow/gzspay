/** 商家支持的收款方式：图标 + 名称胶囊 */

import type { ReactNode } from "react";
import { ChannelIcon } from "./ChannelIcon";
import { cn, payChannelLabel } from "../lib/format";
import type { PayChannel } from "../lib/types";

export function ChannelBadges({
  channels,
  className,
}: {
  channels: PayChannel[];
  className?: string;
}): ReactNode {
  if (channels.length === 0) return <span className="text-xs text-muted">暂无收款方式</span>;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {channels.map((channel) => (
        <span
          key={channel}
          className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text ring-1 ring-line/70"
        >
          <ChannelIcon channel={channel} size={13} />
          {payChannelLabel(channel)}
        </span>
      ))}
    </div>
  );
}
