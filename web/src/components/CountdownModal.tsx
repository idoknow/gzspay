/** 3 秒倒计时确认弹窗：备注要求等需要用户认真阅读的内容，倒计时结束前不可关闭。 */

import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";

export interface CountdownModalProps {
  open: boolean;
  title: string;
  /** 正文内容（备注要求 / 安全提示） */
  children?: ReactNode;
  /** 倒计时秒数，默认 3 */
  seconds?: number;
  confirmText?: string;
  onClose: () => void;
}

export function CountdownModal({
  open,
  title,
  children,
  seconds = 3,
  confirmText = "我已阅读",
  onClose,
}: CountdownModalProps): ReactNode {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (!open) {
      setRemaining(seconds);
      return;
    }
    setRemaining(seconds);
    const deadline = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, [open, seconds]);

  return (
    <Dialog
      open={open}
      title={title}
      variant="center"
      closable={remaining <= 0}
      showClose={false}
      onClose={remaining <= 0 ? onClose : undefined}
      footer={
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={remaining > 0}
          onClick={onClose}
        >
          {remaining > 0 ? `${confirmText}（${remaining}s）` : confirmText}
        </button>
      }
    >
      <div className="text-sm leading-relaxed text-text">{children}</div>
      <p className="mt-3 text-xs text-muted">请仔细核对信息，确认后不可撤销。</p>
    </Dialog>
  );
}
