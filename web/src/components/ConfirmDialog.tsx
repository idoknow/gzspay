/** 二次确认弹窗（取消订单、下线商品、退出登录等）。 */

import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Spinner } from "./Loading";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（红色确认按钮） */
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确定",
  cancelText = "取消",
  danger = false,
  loading = false,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps): ReactNode {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      closable={!loading}
      showClose={false}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
            {cancelText}
          </button>
          <button
            type="button"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? <Spinner size={18} /> : null}
            {confirmText}
          </button>
        </div>
      }
    >
      {children}
    </Dialog>
  );
}
