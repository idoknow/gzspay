/** 登录设备管理：查看登录过的设备与在线状态，可强制退出其它设备。 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useContextMenus, useCopy, type ContextMenuItem } from "../components/ContextMenu";
import { CopyIcon, TrashIcon } from "../components/ContextMenuIcons";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, PageLoading } from "../components/Loading";
import { useToast } from "../components/Toast";
import { getLoginDevices, logoutDevice, logoutOtherDevices, subscribeEvents } from "../lib/api";
import { cn, formatDateTime, formatFriendlyTime } from "../lib/format";
import { useInterval, useVisible } from "../lib/hooks";
import { errorMessage } from "../lib/http";
import { useAuth } from "../lib/session";
import type { LoginDevice, LoginDeviceType, LoginDevicesResponse } from "../lib/types";

/** 自动刷新间隔：页面可见时每 12 秒静默刷新一次在线状态（SSE 只是加速，不能只靠它） */
const REFRESH_INTERVAL_MS = 12_000;

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

/** 在线状态文案：在线 / 刚刚活跃 / 最近 N 分钟 / 更早用友好时间 */
function statusText(device: LoginDevice, onlineWindowMinutes: number): string {
  if (device.online) return "在线";
  const lastSeen = Date.parse(device.lastSeenAt);
  if (Number.isNaN(lastSeen)) return "已离线";
  const minutes = Math.floor((Date.now() - lastSeen) / 60_000);
  if (minutes <= Math.max(1, onlineWindowMinutes)) return "刚刚活跃";
  if (minutes < 60) return `最近 ${minutes} 分钟`;
  return formatFriendlyTime(device.lastSeenAt);
}

function StatusBadge({
  device,
  onlineWindowMinutes,
}: {
  device: LoginDevice;
  onlineWindowMinutes: number;
}): ReactNode {
  return (
    <span
      className={cn(
        "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        device.online ? "bg-success-soft text-success" : "bg-surface-2 text-muted",
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", device.online ? "bg-success" : "bg-muted/60")}
        aria-hidden="true"
      />
      {statusText(device, onlineWindowMinutes)}
    </span>
  );
}

/** 复制用的设备信息摘要 */
function deviceInfoText(device: LoginDevice): string {
  return [device.deviceName, device.os, device.browser, device.ip ? `IP ${device.ip}` : ""]
    .filter(Boolean)
    .join(" · ");
}

export function DevicesPage(): ReactNode {
  const toast = useToast();
  const { logout } = useAuth();
  const [pending, setPending] = useState<LoginDevice | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [data, setData] = useState<LoginDevicesResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  /** 只有第一次加载显示骨架屏；之后的静默刷新保留旧数据，避免列表闪烁 */
  const [firstLoad, setFirstLoad] = useState(true);
  const visible = useVisible();
  /** 请求序号：并发的刷新可能乱序返回，只认最新那次，避免在线状态回退 */
  const requestRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const seq = requestRef.current + 1;
    requestRef.current = seq;
    try {
      const next = await getLoginDevices();
      if (seq !== requestRef.current) return;
      setData(next);
      setLoadError(null);
    } catch (cause) {
      if (seq !== requestRef.current) return;
      setLoadError(cause);
    } finally {
      if (seq === requestRef.current) setFirstLoad(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 实时：其它设备被退出、本机被强制下线、以及别处新登录，都会立刻刷新列表
  useEffect(
    () =>
      subscribeEvents({
        onSessionRevoked: () => void load(),
        onDevicesUpdate: () => void load(),
      }),
    [load],
  );

  // 兜底：SSE 断开（休眠、弱网、服务重启）时靠轮询维持「在线状态」的新鲜度
  useInterval(() => void load(), visible ? REFRESH_INTERVAL_MS : null);

  // 从后台切回前台时立刻刷新一次（轮询在隐藏期间是停的）
  const wasVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) void load();
    wasVisibleRef.current = visible;
  }, [visible, load]);

  const items = data?.items ?? [];
  const onlineWindowMinutes = data?.onlineWindowMinutes ?? 5;
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
      await load();
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
      await load();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setWorking(false);
      setOthersOpen(false);
    }
  };

  const copy = useCopy();

  /** 设备卡片：复制设备信息 / 退出该设备（沿用原有确认弹窗） */
  const deviceMenu = (element: HTMLElement): ContextMenuItem[] | null => {
    const device = items.find((entry) => entry.id === element.dataset.menuId);
    if (!device) return null;
    return [
      {
        label: "复制设备信息",
        hint: device.deviceName,
        icon: <CopyIcon />,
        onSelect: () => void copy(deviceInfoText(device), "设备信息"),
      },
      {
        label: device.current ? "退出当前设备" : "退出该设备",
        hint: "需重新登录",
        icon: <TrashIcon />,
        danger: true,
        disabled: working,
        onSelect: () => setPending(device),
      },
    ];
  };

  /** 登录记录行：复制 IP 与时间 */
  const loginMenu = (element: HTMLElement): ContextMenuItem[] | null => {
    const device = items.find((entry) => entry.id === element.dataset.menuId);
    if (!device) return null;
    return [
      {
        label: "复制 IP",
        hint: device.ip || "未知",
        icon: <CopyIcon />,
        onSelect: () => void copy(device.ip ?? "", "IP 地址"),
      },
      {
        label: "复制登录时间",
        hint: formatDateTime(device.createdAt),
        icon: <CopyIcon />,
        onSelect: () => void copy(formatDateTime(device.createdAt), "登录时间"),
      },
      { type: "separator" },
      {
        label: "复制最近活跃时间",
        icon: <CopyIcon />,
        onSelect: () => void copy(formatDateTime(device.lastSeenAt), "最近活跃时间"),
      },
    ];
  };

  useContextMenus({ "device.item": deviceMenu, "device.login": loginMenu });

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
                发现陌生设备可直接退出。
              </p>
            </div>
          </div>
        </section>

        {loadError && !data ? (
          <ErrorBlock message={errorMessage(loadError)} onRetry={() => void load()} />
        ) : firstLoad && !data ? (
          <PageLoading text="正在加载登录设备…" />
        ) : items.length === 0 ? (
          <EmptyState
            title="暂无登录设备"
            description="尚无登录记录"
          />
        ) : (
          <div className="space-y-3">
            {items.map((device) => (
              <div key={device.id} className="card p-4" data-menu="device.item" data-menu-id={device.id}>
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
                          本机
                        </span>
                      ) : null}
                      <StatusBadge device={device} onlineWindowMinutes={onlineWindowMinutes} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {device.os} · {device.browser}
                    </p>
                    <dl
                      className="mt-2 space-y-1 text-[11px] text-muted"
                      data-menu="device.login"
                      data-menu-id={device.id}
                    >
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
                        <dd title={formatDateTime(device.lastSeenAt)}>
                          {formatFriendlyTime(device.lastSeenAt)}
                        </dd>
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
          「在线」指最近 {onlineWindowMinutes} 分钟内有活动，列表每 {REFRESH_INTERVAL_MS / 1000}{" "}
          秒自动刷新；离线设备也可强制退出。
        </p>
      </main>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.current ? "退出当前设备" : "强制退出该设备"}
        description={
          pending?.current
            ? "退出后需重新登录"
            : pending
              ? `「${pending.deviceName}」需重新登录`
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
        description={`将退出 ${otherCount} 台设备，需重新登录`}
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
