/** 支付密码输入弹窗：内置乱序键盘 + 错误提示（输错次数由服务端返回）。 */

import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
import { BuiltInKeypad } from "./BuiltInKeypad";

export interface PaymentPasswordDialogProps {
  open: boolean;
  onClose: () => void;
  /** 抛错时键盘会展示错误信息（如「密码错误，还可尝试 4 次」） */
  onSubmit: (password: string) => Promise<void> | void;
  title?: string;
  description?: string;
}

export function PaymentPasswordDialog({
  open,
  onClose,
  onSubmit,
  title = "输入支付密码",
  description = "请输入 6 位支付密码确认本次操作",
}: PaymentPasswordDialogProps): ReactNode {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      variant="sheet"
      footer={<p className="text-center text-[11px] text-muted">资金通过第三方收款码流转，gzspay 不代收代付</p>}
    >
      <BuiltInKeypad onSubmit={onSubmit} onCancel={onClose} cancelText="取消" />
    </Dialog>
  );
}
