/** 设置：外观（浅色/深色/自动，即时生效）与邮件通知开关。 */

import { useState, type ReactNode } from "react";
import { PageHeader } from "../components/PageHeader";
import { Toggle } from "../components/Toggle";
import { useToast } from "../components/Toast";
import { updateNotificationSettings } from "../lib/api";
import { cn } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAuth } from "../lib/session";
import { setThemeMode, type ThemeMode } from "../lib/theme";
import { useThemeMode } from "../lib/hooks";
import type { NotificationSettings } from "../lib/types";

const THEME_OPTIONS: { key: ThemeMode; label: string; description: string; icon: string }[] = [
  { key: "light", label: "浅色", description: "明亮清爽", icon: "☀" },
  { key: "dark", label: "深色", description: "夜间护眼", icon: "☾" },
  { key: "auto", label: "自动", description: "跟随系统", icon: "◐" },
];

const NOTIFY_ROWS: { key: keyof NotificationSettings; title: string; description: string }[] = [
  { key: "newOrder", title: "新订单", description: "有人创建订单时发送邮件通知" },
  { key: "paid", title: "付款通知", description: "付款人完成付款时发送邮件通知" },
  { key: "settled", title: "结算通知", description: "订单确认收款、取消等状态变更时发送邮件通知" },
];

export function SettingsPage(): ReactNode {
  const toast = useToast();
  const { me, patchMe } = useAuth();
  const themeMode = useThemeMode();
  const [saving, setSaving] = useState<keyof NotificationSettings | null>(null);
  const [settings, setSettings] = useState<NotificationSettings>(
    me?.notificationSettings ?? { newOrder: true, paid: true, settled: true },
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
          <h2 className="text-sm font-semibold text-text">外观</h2>
          <p className="mt-1 text-[11px] text-muted">切换后立即生效，并记住你的选择。</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((option) => {
              const active = themeMode === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 transition-colors",
                    active ? "border-text bg-surface-2 text-text" : "border-line bg-surface-2 text-muted",
                  )}
                  onClick={() => {
                    setThemeMode(option.key);
                    toast.info(`已切换为${option.label}`);
                  }}
                >
                  <span className="text-xl leading-none">{option.icon}</span>
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-[10px] opacity-80">{option.description}</span>
                </button>
              );
            })}
          </div>
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

        <p className="text-center text-[11px] leading-relaxed text-muted">
          邮件由 gzspay 服务端通过校园邮箱发送，仅在订单状态变化时提醒。
          <br />
          资金通过第三方收款码流转，gzspay 不代收代付。
        </p>
      </main>
    </div>
  );
}
