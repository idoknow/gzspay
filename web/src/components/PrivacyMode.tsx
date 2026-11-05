/**
 * 公共设备隐私模式相关的 UI：登录后的询问弹窗、隐私模式提示条、
 * 需要支付密码才能退出的按钮，以及被隐私模式挡住的页面占位。
 */

import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { PaymentPasswordDialog } from "./PaymentPasswordDialog";
import { useToast } from "./Toast";
import { verifyPaymentPassword } from "../lib/api";
import { errorMessage } from "../lib/http";
import {
  disablePrivacyMode,
  enablePrivacyMode,
  isDesktopDevice,
  usePrivacyMode,
} from "../lib/privacy";

const PRIVACY_POINTS = [
  "「我的」页面的姓名、学号、校园卡等个人信息会隐藏",
  "设置页的通知设置、登录设备管理会隐藏",
  "商家中心的商品与店铺设置会隐藏",
  "收付款码、扫码付款、订单与工单仍然可以正常使用",
];

/** 登录后在电脑上询问是否开启隐私模式 */
export function PrivacyModePrompt(): ReactNode {
  const { asked } = usePrivacyMode();
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    if (asked || !isDesktopDevice()) return;
    setDesktop(true);
    setOpen(true);
  }, [asked]);

  if (!desktop) return null;

  return (
    <Dialog
      open={open}
      onClose={() => {
        setOpen(false);
        disablePrivacyMode();
      }}
      title="这台电脑是公共设备吗？"
      description="如果是在教室、机房、图书馆等公共电脑上登录，建议开启隐私模式。"
      footer={
        <div className="space-y-2">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              enablePrivacyMode();
              setOpen(false);
            }}
          >
            开启隐私模式
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => {
              disablePrivacyMode();
              setOpen(false);
            }}
          >
            不用，这是我自己的电脑
          </button>
        </div>
      }
    >
      <ul className="space-y-1.5 text-[12px] leading-relaxed text-muted">
        {PRIVACY_POINTS.map((point) => (
          <li key={point} className="flex gap-2">
            <span aria-hidden="true" className="text-muted/70">
              ·
            </span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
        退出隐私模式需要输入支付密码，所以离开前记得退出登录。
      </p>
    </Dialog>
  );
}

/** 需要输入支付密码才能退出隐私模式的按钮 */
export function ExitPrivacyButton({
  label = "退出隐私模式",
  className = "btn btn-secondary btn-sm",
}: {
  label?: string;
  className?: string;
}): ReactNode {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      <PaymentPasswordDialog
        open={open}
        onClose={() => setOpen(false)}
        title="退出隐私模式"
        description="请输入支付密码，确认这是你自己的设备"
        onSubmit={async (password) => {
          await verifyPaymentPassword(password);
          disablePrivacyMode();
          setOpen(false);
          toast.success("已退出隐私模式");
        }}
      />
    </>
  );
}

/** 隐私模式开启时挂在页面顶部的提示条 */
export function PrivacyModeBanner(): ReactNode {
  const { enabled } = usePrivacyMode();
  if (!enabled) return null;
  return (
    <div className="border-b border-line bg-surface-2/80 px-3 py-2 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-text/10 text-[11px]">
          🔒
        </span>
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted">
          隐私模式已开启，个人信息与设置已隐藏
        </p>
        <ExitPrivacyButton className="btn btn-ghost btn-sm shrink-0 text-[11px]" />
      </div>
    </div>
  );
}

/** 隐私模式下被挡住的页面占位（配合 <PrivacyGuard> 使用） */
export function PrivacyBlocked({
  title,
  description = "为保护隐私，隐私模式下不展示这个页面的内容。",
}: {
  title: string;
  description?: string;
}): ReactNode {
  return (
    <div className="card flex flex-col items-center gap-3 px-4 py-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-muted ring-1 ring-line">
        🔒
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text">{title}</p>
        <p className="text-[11px] leading-relaxed text-muted">{description}</p>
      </div>
      <ExitPrivacyButton label="输入支付密码退出隐私模式" className="btn btn-primary btn-sm" />
    </div>
  );
}

/** 页面级守卫：隐私模式开启时不渲染 children */
export function PrivacyGuard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactNode {
  const { enabled } = usePrivacyMode();
  if (!enabled) return <>{children}</>;
  return <PrivacyBlocked title={title} description={description} />;
}
