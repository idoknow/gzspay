/**
 * 权限与通知（仅客户端）：集中显示通知 / 相机 / NFC 的授权状态，
 * 并展示 FCM 推送令牌是否已注册，避免只能在扫码失败时才发现没权限。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";
import { registerPushToken } from "../lib/api";
import { clientBridge } from "../lib/client";

function StatusBadge({ granted }: { granted: boolean | null }): ReactNode {
  const text = granted === true ? "已授权" : granted === false ? "未授权" : "未知";
  const tone =
    granted === true ? "text-success" : granted === false ? "text-danger" : "text-muted";
  return <span className={`shrink-0 text-[11px] font-medium ${tone}`}>{text}</span>;
}

export function PermissionsPage(): ReactNode {
  const bridge = clientBridge();
  const toast = useToast();
  const [notifications, setNotifications] = useState<boolean | null>(null);
  const [camera, setCamera] = useState<boolean | null>(null);
  const [nfc, setNfc] = useState<boolean | null>(null);
  const [pushToken, setPushToken] = useState("");

  const refresh = useCallback((): void => {
    if (!bridge) return;
    setNotifications(bridge.notificationsEnabled?.() ?? null);
    setCamera(bridge.cameraEnabled?.() ?? null);
    setNfc(bridge.nfcEnabled?.() ?? null);
    setPushToken(bridge.pushToken?.() ?? "");
  }, [bridge]);

  useEffect(() => {
    refresh();
    const onVisible = (): void => refresh();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (!bridge) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="权限与通知" back />
        <main className="page page-with-nav pt-5">
          <section className="card mx-auto max-w-[400px] p-4">
            <p className="text-sm font-medium text-text">此功能仅在安卓客户端内可用</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              请更新到最新版客户端后查看权限状态。
            </p>
          </section>
        </main>
      </div>
    );
  }

  const register = (): void => {
    const token = bridge.pushToken?.() ?? "";
    if (!token) {
      toast.error("推送令牌还没准备好，请确认 Firebase 已配置后再试");
      return;
    }
    void registerPushToken(token)
      .then(() => {
        setPushToken(token);
        toast.success("推送已注册");
      })
      .catch(() => toast.error("注册失败，请稍后再试"));
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="权限与通知" back />
      <main className="page page-with-nav space-y-4 pt-5">
        <section className="card mx-auto w-full max-w-[400px] p-4">
          <h2 className="text-sm font-semibold text-text">系统权限</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            通知权限会在进入应用时询问一次；没收到弹窗时，可以在这里重新请求或去系统设置打开。
          </p>
          <div className="mt-2 divide-y divide-line">
            <div className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">通知</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  收款请求、订单状态与工单消息
                </p>
              </div>
              <StatusBadge granted={notifications} />
              <button
                type="button"
                className="btn btn-outline btn-sm shrink-0"
                onClick={() => {
                  if (notifications) bridge.openNotificationSettings?.();
                  else bridge.requestNotifications?.();
                }}
              >
                {notifications ? "系统设置" : "请求权限"}
              </button>
            </div>

            <div className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">相机</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  扫校园卡与收款码；未授权时扫码会失败
                </p>
              </div>
              <StatusBadge granted={camera} />
              {camera ? null : (
                <button
                  type="button"
                  className="btn btn-outline btn-sm shrink-0"
                  onClick={() => bridge.requestCamera?.()}
                >
                  请求权限
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">NFC</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  贴卡读卡与「NFC 卡片」都需要系统 NFC 打开
                </p>
              </div>
              <StatusBadge granted={nfc} />
              {nfc ? null : (
                <button
                  type="button"
                  className="btn btn-outline btn-sm shrink-0"
                  onClick={() => bridge.openNfcSettings?.()}
                >
                  去开启
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="card mx-auto w-full max-w-[400px] p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">推送</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                pushToken ? "bg-surface-2 text-success" : "bg-surface-2 text-muted"
              }`}
            >
              {pushToken ? "已注册" : "未注册"}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            FCM 令牌由客户端获取；服务端在收款请求、订单状态与工单消息时推送。没有令牌时请确认
            Firebase 配置（google-services.json）已经打进安装包。
          </p>
          <button type="button" className="btn btn-outline btn-sm mt-3 w-full" onClick={register}>
            重新注册推送
          </button>
        </section>
      </main>
    </div>
  );
}
