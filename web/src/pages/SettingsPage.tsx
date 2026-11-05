/** 设置：外观（浅色/深色/自动，即时生效）与邮件通知开关。 */

import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Toggle } from "../components/Toggle";
import { ExitPrivacyButton } from "../components/PrivacyMode";
import { useToast } from "../components/Toast";
import { updateNotificationSettings } from "../lib/api";
import { cn } from "../lib/format";
import { errorMessage } from "../lib/http";
import { enablePrivacyMode, usePrivacyMode } from "../lib/privacy";
import { useAuth } from "../lib/session";
import { setThemeMode, type ThemeMode } from "../lib/theme";
import { useThemeMode } from "../lib/hooks";
import type { NotificationSettings } from "../lib/types";

function SunIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AutoIcon(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3.8a8.2 8.2 0 0 0 0 16.4Z" fill="currentColor" />
    </svg>
  );
}

function CheckIcon(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 外观选项的缩略预览：浅色 / 深色 / 自动（左浅右深对半）。 */
function ShieldIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  );
}

function ChevronRightIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="m7.5 5 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThemePreview({ mode }: { mode: ThemeMode }): ReactNode {
  const light = { bg: "#f5f5f2", surface: "#ffffff", line: "#e2e2da", dot: "#171a20" };
  const darkTone = { bg: "#101114", surface: "#23262d", line: "#3a3e47", dot: "#f2f3f5" };
  const tones = mode === "light" ? [light] : mode === "dark" ? [darkTone] : [light, darkTone];
  return (
    <div className="relative flex h-10 w-full overflow-hidden rounded-xl ring-1 ring-black/5 watch:h-8">
      {tones.map((tone, index) => (
        <div key={index} className="relative flex-1" style={{ background: tone.bg }}>
          <span
            className="absolute top-1.5 left-1.5 h-2.5 w-5 rounded-[3px] watch:top-1 watch:left-1 watch:h-2 watch:w-4"
            style={{ background: tone.surface }}
          />
          <span
            className="absolute top-5 left-1.5 h-1.5 w-8 rounded-full watch:top-4 watch:left-1 watch:h-1 watch:w-6"
            style={{ background: tone.line }}
          />
          <span
            className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full opacity-70 watch:top-1 watch:right-1 watch:h-2 watch:w-2"
            style={{ background: tone.dot }}
          />
        </div>
      ))}
    </div>
  );
}

const THEME_OPTIONS: { key: ThemeMode; label: string; description: string; icon: ReactNode }[] = [
  { key: "light", label: "浅色", description: "明亮清爽", icon: <SunIcon /> },
  { key: "dark", label: "深色", description: "夜间护眼", icon: <MoonIcon /> },
  { key: "auto", label: "自动", description: "跟随系统", icon: <AutoIcon /> },
];

const NOTIFY_ROWS: { key: keyof NotificationSettings; title: string; description: string }[] = [
  { key: "newOrder", title: "新订单", description: "有人创建订单时发送邮件通知" },
  { key: "paid", title: "付款通知", description: "付款人完成付款时发送邮件通知" },
  { key: "settled", title: "结算通知", description: "订单确认收款、取消等状态变更时发送邮件通知" },
  { key: "ticket", title: "工单通知", description: "交易工单有新消息、或平台客服介入时发送邮件通知" },
  { key: "announcement", title: "平台公告", description: "平台发布新公告时发送邮件通知" },
];

export function SettingsPage(): ReactNode {
  const toast = useToast();
  const navigate = useNavigate();
  const { me, patchMe } = useAuth();
  const privacy = usePrivacyMode();
  const themeMode = useThemeMode();
  const [saving, setSaving] = useState<keyof NotificationSettings | null>(null);
  const [settings, setSettings] = useState<NotificationSettings>(
    me?.notificationSettings ?? {
      newOrder: true,
      paid: true,
      settled: true,
      ticket: true,
      announcement: true,
    },
  );

  if (!me) return null;

  const toggleSetting = async (key: keyof NotificationSettings, next: boolean): Promise<void> => {
    const previous = settings;
    setSettings({ ...settings, [key]: next });
    setSaving(key);
    try {
      const result = await updateNotificationSettings({ [key]: next });
      patchMe(result);
    } catch (cause) {
      setSettings(previous);
      toast.error(errorMessage(cause));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="设置" back />

      <main className="page space-y-4 pb-10 pt-4">
        <section className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">外观</h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
              当前 {THEME_OPTIONS.find((option) => option.key === themeMode)?.label ?? "自动"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted">切换后立即生效，并记住你的选择。</p>
          <div className="mt-3 grid grid-cols-3 gap-2 watch:gap-1.5">
            {THEME_OPTIONS.map((option) => {
              const active = themeMode === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col gap-2 rounded-2xl border p-2.5 text-left transition active:scale-[0.98] watch:gap-1.5 watch:p-2",
                    active
                      ? "border-[color:var(--text)] bg-surface-2 shadow-[var(--shadow-xs)]"
                      : "border-line bg-surface",
                  )}
                  onClick={() => {
                    setThemeMode(option.key);
                    toast.info(`已切换为${option.label}`);
                  }}
                >
                  <ThemePreview mode={option.key} />
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg watch:h-5 watch:w-5",
                        active ? "bg-text text-surface" : "bg-surface-2 text-muted",
                      )}
                    >
                      {option.icon}
                    </span>
                    <span className={cn("text-[13px] font-medium", active ? "text-text" : "text-muted")}>
                      {option.label}
                    </span>
                    {active ? (
                      <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-text text-surface">
                        <CheckIcon />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[10px] text-muted watch:hidden">{option.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">公共设备隐私模式</h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
              {privacy.enabled ? "已开启" : "未开启"}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            {privacy.enabled
              ? "当前已隐藏「我的」个人信息、通知设置与商家设置；退出需要输入支付密码。"
              : "在教室、机房等公共电脑上使用时可开启，隐藏个人信息与设置；退出需要支付密码。"}
          </p>
          <div className="mt-3">
            {privacy.enabled ? (
              <ExitPrivacyButton label="退出隐私模式" className="btn btn-secondary btn-sm" />
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  enablePrivacyMode();
                  toast.success("已开启隐私模式");
                }}
              >
                开启隐私模式
              </button>
            )}
          </div>
        </section>

        {privacy.enabled ? (
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-text">隐私模式下已隐藏</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              登录设备管理、邮件通知设置在这台公共设备上不展示。需要修改请先退出隐私模式。
            </p>
          </section>
        ) : (
          <>
        <section className="card p-0">
          <h2 className="px-4 pt-4 text-sm font-semibold text-text">账号安全</h2>
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-surface-2"
            onClick={() => navigate("/me/devices")}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text ring-1 ring-line/70 watch:h-8 watch:w-8">
              <ShieldIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text">登录设备管理</span>
              <span className="mt-0.5 block text-[11px] text-muted">
                查看登录过的设备与 IP，可强制退出其它设备
              </span>
            </span>
            <span className="shrink-0 text-muted" aria-hidden="true">
              <ChevronRightIcon />
            </span>
          </button>
        </section>

        <section className="card p-4">
          <h2 className="text-sm font-semibold text-text">邮件通知</h2>
          <p className="mt-1 text-[11px] text-muted">关闭后将不再接收对应类型的邮件提醒，站内状态不受影响。</p>
          <div className="mt-2 divide-y divide-line">
            {NOTIFY_ROWS.map((row) => (
              <div key={row.key} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text">{row.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{row.description}</p>
                </div>
                <Toggle
                  checked={settings[row.key]}
                  disabled={saving === row.key}
                  onChange={(next) => void toggleSetting(row.key, next)}
                  label={row.title}
                />
              </div>
            ))}
          </div>
        </section>
          </>
        )}
      </main>
    </div>
  );
}
