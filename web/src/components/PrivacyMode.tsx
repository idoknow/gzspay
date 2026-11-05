/**
 * 公共设备隐私模式相关的 UI：登录后的询问弹窗、隐私模式提示条、
 * 需要支付密码才能退出的按钮、被隐私模式挡住的页面占位，
 * 以及电脑端隐私模式的两条硬约束：30 分钟自动退出登录、限制打开开发者工具。
 *
 * 说明：浏览器无法真正禁止用户打开控制台（用户可以用其它设备、抓包或改页面），
 * 这里的做法是拦截常见快捷键 / 右键菜单，并在检测到开发者工具打开时用遮罩挡住界面，
 * 属于「提高门槛 + 显式提示」，不是安全边界。真正的边界是服务端鉴权。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { EyeIcon } from "./EyeIcon";
import { PaymentPasswordDialog } from "./PaymentPasswordDialog";
import { useToast } from "./Toast";
import { verifyPaymentPassword } from "../lib/api";
import { errorMessage } from "../lib/http";
import { useAuth } from "../lib/session";
import {
  PRIVACY_SESSION_MS,
  PRIVACY_WARN_MS,
  disablePrivacyMode,
  enablePrivacyMode,
  isDesktopDevice,
  usePrivacyMode,
} from "../lib/privacy";

const PRIVACY_POINTS = [
  "「我的」个人信息、设置里的通知与设备管理会隐藏",
  "商家中心的商品与店铺设置会隐藏",
  "收付款码、扫码付款、订单与工单照常使用",
  "电脑端最多在线 30 分钟，到期前 1 分钟提醒后自动退出",
];

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

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
      description="在教室、机房等公共电脑上登录时，建议开启隐私模式。"
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
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-text/10 text-muted">
          <EyeIcon off size={11} />
        </span>
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted">
          隐私模式已开启，个人信息与设置已隐藏
        </p>
        <ExitPrivacyButton className="btn btn-ghost btn-sm shrink-0 text-[11px]" />
      </div>
    </div>
  );
}

/**
 * 电脑端隐私模式的 30 分钟在线上限：
 * 到期前 60 秒弹出倒计时提醒，到期立即调用退出登录（服务端会话一并作废）。
 */
export function PrivacySessionGuard(): ReactNode {
  const { enabled, startedAt } = usePrivacyMode();
  const { logout } = useAuth();
  const [desktop, setDesktop] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    setDesktop(isDesktopDevice());
  }, []);

  useEffect(() => {
    if (!enabled || !desktop) {
      setRemaining(null);
      firedRef.current = false;
      return;
    }
    const deadline = (startedAt ?? Date.now()) + PRIVACY_SESSION_MS;
    const tick = (): void => {
      const left = deadline - Date.now();
      setRemaining(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        void logout().catch(() => {
          window.location.assign("/login");
        });
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, desktop, startedAt, logout]);

  if (!enabled || !desktop || remaining === null) return null;
  if (remaining > PRIVACY_WARN_MS || remaining <= 0) return null;

  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  return (
    <div className="fixed inset-x-0 bottom-4 z-40 px-3">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-50 px-3.5 py-3 shadow-lg dark:bg-amber-950/60">
        <span aria-hidden="true" className="text-base">
          ⏳
        </span>
        <p className="min-w-0 flex-1 text-[12px] leading-snug text-amber-900 dark:text-amber-100">
          隐私模式最多在线 30 分钟，将在 <b>{seconds}</b> 秒后自动退出登录
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm shrink-0 text-[11px]"
          onClick={() => {
            void logout().catch(() => {
              window.location.assign("/login");
            });
          }}
        >
          立即退出
        </button>
      </div>
    </div>
  );
}

/**
 * 电脑端隐私模式下限制打开开发者工具：拦截快捷键与右键菜单，
 * 检测到开发者工具打开时用遮罩挡住界面（提示关闭或退出隐私模式）。
 */
export function DevtoolsShield(): ReactNode {
  const { enabled } = usePrivacyMode();
  const [desktop, setDesktop] = useState(false);
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    setDesktop(isDesktopDevice());
  }, []);

  useEffect(() => {
    if (!enabled || !desktop) return;

    const blockKey = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      const combo = event.ctrlKey || event.metaKey;
      const devtoolsKeys = key === "f12" || (combo && event.shiftKey && ["i", "j", "c", "k", "e"].includes(key)) || (combo && key === "u");
      if (devtoolsKeys) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const blockMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    window.addEventListener("keydown", blockKey, true);
    window.addEventListener("contextmenu", blockMenu);

    const check = (): void => {
      const widthGap = window.outerWidth - window.innerWidth;
      const heightGap = window.outerHeight - window.innerHeight;
      setDetected(widthGap > 220 || heightGap > 220);
    };
    check();
    const timer = window.setInterval(check, 1200);

    return () => {
      window.removeEventListener("keydown", blockKey, true);
      window.removeEventListener("contextmenu", blockMenu);
      window.clearInterval(timer);
    };
  }, [enabled, desktop]);

  if (!enabled || !desktop || !detected) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="card w-full max-w-sm space-y-3 p-5 text-center">
        <span aria-hidden="true" className="text-2xl">
          🛡️
        </span>
        <p className="text-sm font-semibold text-text">隐私模式下不允许打开开发者工具</p>
        <p className="text-[11px] leading-relaxed text-muted">
          检测到浏览器开发者工具处于打开状态，页面已暂停显示。请关闭开发者工具后继续，或者退出隐私模式。
        </p>
        <div className="space-y-2 pt-1">
          <button type="button" className="btn btn-primary btn-block" onClick={() => setDetected(false)}>
            我已关闭，继续使用
          </button>
          <ExitPrivacyButton label="退出隐私模式" className="btn btn-ghost btn-block" />
        </div>
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
        <EyeIcon off size={18} />
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

export { formatClock };
