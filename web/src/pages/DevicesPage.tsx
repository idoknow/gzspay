/** 登录设备管理：查看登录过的设备与在线状态，可强制退出其它设备。 */

import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, PageLoading } from "../components/Loading";
import { useToast } from "../components/Toast";
import { getLoginDevices, logoutDevice, logoutOtherDevices } from "../lib/api";
import { cn, formatDateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { errorMessage } from "../lib/http";
import { useAuth } from "../lib/session";
import type { LoginDevice, LoginDeviceType } from "../lib/types";

function PhoneIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="7" y="2.8" width="10" height="18.4" rx="2.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.8 18.4h2.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function TabletIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.6" y="3" width="14.8" height="18" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.9 18.2h2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function DesktopIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.8" y="4" width="18.4" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 20h6M12 16v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function DeviceTypeIcon({ type }: { type: LoginDeviceType }): ReactNode {
  if (type === "mobile") return <PhoneIcon />;
  if (type === "tablet") return <TabletIcon />;
  if (type === "desktop") return <DesktopIcon />;
  return <DesktopIcon />;
}

function OnlineBadge({ online }: { online: boolean }): ReactNode {
  return (
    <span
      className={cn(
        "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        online ? "bg-success-soft text-success" : "bg-surface-2 text-muted",
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-success" : "bg-muted/60")}
        aria-hidden="true"
      />
      {online ? "在线" : "已离线"}
    </span>
  );
}

export function DevicesPage(): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [pending, setPending] = useState<LoginDevice | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const devices = useAsync(() => getLoginDevices(), []);

  const items = devices.data?.items ?? [];
  const onlineCount = items.filter((item) => item.online).length;
  const otherCount = items.filter((item) => !item.current).length;

  const confirmLogout = async (device: LoginDevice): Promise<void> => {
    setWorking(true);
    try {
      const result = await logoutDevice(device.id);
      if (result.current) {
        // 当前设备被退出：Cookie 已清掉，回到登录页
        await logout();
        return;
      }
      toast.success(`已退出「${device.deviceName}」`);
      devices.reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setWorking(false);
      setPending(null);
    }
  };

  const confirmLogoutOthers = async (): Promise<void> => {
    setWorking(true);
    try {
      const result = await logoutOtherDevices();
      toast.success(
        result.revoked > 0 ? `已退出其它 ${result.revoked} 台设备` : "没有需要退出的设备",
      );
      devices.reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setWorking(false);
      setOthersOpen(false);
    }
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="登录设备管理" back />

      <main className="page space-y-4 pb-10 pt-4">
        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text ring-1 ring-line/70">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2.8 4.8 5.6v5.7c0 4.4 3 8.4 7.2 9.9 4.2-1.5 7.2-5.5 7.2-9.9V5.6L12 2.8Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
                <path
                  d="m9 12 2.2 2.2L15.4 10"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text">
                共 {items.length} 台设备
                {items.length > 0 ? `，${onlineCount} 台在线` : ""}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                同一账号在不同设备登录都会记录在这里。发现陌生设备时可直接强制退出，退出后对方需要重新登录。
              </p>
            </div>
          </div>
        </section>

        {devices.error && !devices.data ? (
          <ErrorBlock message={errorMessage(devices.error)} onRetry={() => devices.reload()} />
        ) : devices.loading && !devices.data ? (
          <PageLoading text="正在加载登录设备…" />
        ) : items.length === 0 ? (
          <EmptyState
            title="暂无登录设备"
            description="当前账号还没有可显示的登录记录。"
          />
        ) : (
          <div className="space-y-3">
            {items.map((device) => (
              <div key={device.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1",
                      device.current
                        ? "bg-brand text-white ring-brand/30"
                        : "bg-surface-2 text-text ring-line/70",
                    )}
                  >
                    <DeviceTypeIcon type={device.deviceType} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-text">
                        {device.deviceName}
                      </p>
                      {device.current ? (
                        <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">
                          当前设备
                        </span>
                      ) : null}
                      <OnlineBadge online={device.online} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {device.os} · {device.browser}
                    </p>
                    <dl className="mt-2 space-y-1 text-[11px] text-muted">
                      <div className="flex gap-2">
                        <dt className="shrink-0">IP</dt>
                        <dd className="min-w-0 truncate font-mono">{device.ip || "未知"}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="shrink-0">登录时间</dt>
                        <dd>{formatDateTime(device.createdAt)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="shrink-0">最近活跃</dt>
                        <dd>{formatDateTime(device.lastSeenAt)}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className={cn(
                      "btn btn-sm",
                      device.current ? "btn-secondary" : "btn-secondary text-danger",
                    )}
                    onClick={() => setPending(device)}
                  >
                    {device.current ? "退出登录" : "强制退出"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {otherCount > 0 ? (
          <button
            type="button"
            className="btn btn-secondary w-full text-danger"
            onClick={() => setOthersOpen(true)}
          >
            退出全部其它设备（{otherCount} 台）
          </button>
        ) : null}

        <p className="px-2 text-center text-[10px] leading-relaxed text-muted">
          「在线」指会话未过期且最近 {devices.data?.onlineWindowMinutes ?? 5} 分钟内有请求；离线设备可以强制退出，
          也可以等待登录状态自然过期。
        </p>
      </main>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.current ? "退出当前设备" : "强制退出该设备"}
        description={
          pending?.current
            ? "退出后需要重新登录才能继续使用，确认退出？"
            : pending
              ? `将立即退出「${pending.deviceName}」，该设备需要重新登录。确认操作？`
              : undefined
        }
        confirmText={pending?.current ? "退出登录" : "强制退出"}
        danger
        loading={working}
        onConfirm={() => {
          if (pending) void confirmLogout(pending);
        }}
        onClose={() => {
          if (!working) setPending(null);
        }}
      />

      <ConfirmDialog
        open={othersOpen}
        title="退出全部其它设备"
        description={`将立即退出除当前设备外的 ${otherCount} 台设备，它们需要重新登录。确认操作？`}
        confirmText="全部退出"
        danger
        loading={working}
        onConfirm={() => void confirmLogoutOthers()}
        onClose={() => {
          if (!working) setOthersOpen(false);
        }}
      />
    </div>
  );
}
