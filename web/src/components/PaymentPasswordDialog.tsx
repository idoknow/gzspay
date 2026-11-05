/**
 * 支付密码输入弹窗：居中在最上层（覆盖整页）的弹窗 + 内置安全键盘，
 * 不出系统键盘、不回显明文；文案尽量简短，上下文由调用方通过 description 传入。
 */

import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
import { BuiltInKeypad } from "./BuiltInKeypad";

export interface PaymentPasswordDialogProps {
  open: boolean;
  onClose: () => void;
  /** 抛错时键盘会展示错误信息（如「密码错误，还可尝试 4 次」） */
  onSubmit: (password: string) => Promise<void> | void;
  title?: string;
  /** 一句话上下文（如「向 XX 支付 ¥12.00」），不传则不显示 */
  description?: string;
}

export function PaymentPasswordDialog({
  open,
  onClose,
  onSubmit,
  title = "输入支付密码",
  description,
}: PaymentPasswordDialogProps): ReactNode {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="center"
      showClose={false}
      className="max-w-[356px] rounded-[28px] px-5 pb-5 pt-6"
    >
      <div className="mb-4 flex flex-col items-center text-center">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand"
          aria-hidden="true"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="10" width="14" height="10" rx="2.6" stroke="currentColor" strokeWidth="1.7" />
            <path d="M8.6 10V7.6a3.4 3.4 0 1 1 6.8 0V10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="12" cy="15" r="1.3" fill="currentColor" />
          </svg>
        </span>
        <p className="mt-2.5 text-[15px] font-semibold text-text watch:text-[13px]">{title}</p>
        {description ? (
          <p className="mt-1 text-[12px] leading-relaxed text-muted watch:text-[11px]">{description}</p>
        ) : null}
      </div>
      <BuiltInKeypad onSubmit={onSubmit} onCancel={onClose} cancelText="取消" hint={null} />
    </Dialog>
  );
}
