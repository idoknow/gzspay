/**
 * 系统配置：系统发件邮箱（SMTP）与安全防护设置。
 * 仅超级管理员可保存；其他角色只读查看。
 */
import { useState } from "react";
import { getConfig, updateConfig } from "../api";
import { useFeedback } from "../components/dialogs";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InfoBanner,
  PageHeader,
  SectionTitle,
  SkeletonCards,
  Switch,
} from "../components/ui";
import {
  formatTtlSeconds,
  parseYuanToCents,
} from "../format";
import { useAsync } from "../hooks";
import { useAdmin } from "../context";
import { errorMessage } from "../../lib/http";
import type { AdminConfig, AdminConfigInput, MailConfig, SecurityConfig } from "../types";

export function ConfigPage() {
  const { canWrite, isSuper } = useAdmin();
  const { data, loading, error, refresh } = useAsync<AdminConfig>(
    () => getConfig(),
    [],
  );

  const readOnly = !isSuper;

  return (
    <>
      <PageHeader
        title="系统配置"
        description="配置系统发件邮箱与安全防护策略，保存后立即生效。"
        actions={
          <button
            type="button"
            className="admin-btn admin-btn-subtle admin-btn-sm"
            onClick={() => refresh()}
            disabled={loading}
          >
            刷新
          </button>
        }
      />

      {!canWrite ? (
        <InfoBanner tone="warning">
          当前账号为只读审计角色，仅可查看配置，无法修改保存。
        </InfoBanner>
      ) : readOnly ? (
        <InfoBanner tone="info">
          系统配置保存权限仅限超级管理员，运营角色可查看当前配置但无法修改。
        </InfoBanner>
      ) : null}

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refresh()} />
      ) : loading && !data ? (
        <SkeletonCards count={2} />
      ) : data ? (
        <ConfigForm
          key={`${data.mail.host}:${data.mail.passwordConfigured}:${data.security.paymentPasswordMaxAttempts}:${data.security.sessionTtlDays}`}
          config={data}
          readOnly={readOnly}
          onSaved={() => refresh()}
        />
      ) : (
        <EmptyState title="暂无配置数据" description="未能读取系统配置，请稍后刷新重试。" />
      )}
    </>
  );
}

interface ConfigFormProps {
  config: AdminConfig;
  readOnly: boolean;
  onSaved: () => void;
}

interface MailFormState {
  host: string;
  port: string;
  secure: boolean;
  username: string;
  fromName: string;
  fromAddress: string;
  password: string;
}

interface SecurityFormState {
  maxAttempts: string;
  lockMinutes: string;
  singleLimitYuan: string;
  dailyLimitYuan: string;
  dynamicCodeTtl: string;
  emailCodeTtl: string;
  sessionTtlDays: string;
}

function initialState(mail: MailConfig, security: SecurityConfig) {
  return {
    mail: {
      host: mail.host ?? "",
      port: mail.port ? String(mail.port) : "",
      secure: mail.secure,
      username: mail.username ?? "",
      fromName: mail.fromName ?? "",
      fromAddress: mail.fromAddress ?? "",
      password: "",
    } satisfies MailFormState,
    security: {
      maxAttempts: String(security.paymentPasswordMaxAttempts ?? 5),
      lockMinutes: String(security.paymentPasswordLockMinutes ?? 30),
      singleLimitYuan: centsToYuanInput(security.singlePaymentLimitCents ?? 0),
      dailyLimitYuan: centsToYuanInput(security.dailyPaymentLimitCents ?? 0),
      dynamicCodeTtl: String(security.dynamicCodeTtlSeconds ?? 60),
      emailCodeTtl: String(security.emailCodeTtlSeconds ?? 600),
      sessionTtlDays: String(security.sessionTtlDays ?? 7),
    } satisfies SecurityFormState,
  };
}

function centsToYuanInput(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "0";
  const yuan = cents / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
}

function ConfigForm({ config, readOnly, onSaved }: ConfigFormProps) {
  const feedback = useFeedback();
  const initial = initialState(config.mail, config.security);
  const [mail, setMail] = useState<MailFormState>(initial.mail);
  const [security, setSecurity] = useState<SecurityFormState>(initial.security);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSave() {
    const validation = validate(mail, security);
    if (validation.error) {
      setFormError(validation.error);
      feedback.warning(validation.error);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const input: AdminConfigInput = {
        mail: {
          host: mail.host.trim(),
          port: Number(mail.port),
          secure: mail.secure,
          username: mail.username.trim(),
          fromName: mail.fromName.trim(),
          fromAddress: mail.fromAddress.trim(),
          ...(mail.password ? { password: mail.password } : {}),
        },
        security: {
          paymentPasswordMaxAttempts: Number(security.maxAttempts),
          paymentPasswordLockMinutes: Number(security.lockMinutes),
          singlePaymentLimitCents: yuanToCentsOrZero(security.singleLimitYuan),
          dailyPaymentLimitCents: yuanToCentsOrZero(security.dailyLimitYuan),
          dynamicCodeTtlSeconds: Number(security.dynamicCodeTtl),
          emailCodeTtlSeconds: Number(security.emailCodeTtl),
          sessionTtlDays: Number(security.sessionTtlDays),
        },
      };
      await updateConfig(input);
      feedback.success("系统配置已保存");
      setMail({ ...mail, password: "" });
      onSaved();
    } catch (err) {
      const message = errorMessage(err);
      setFormError(message);
      feedback.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-stack">
      <Card
        title="系统发件邮箱"
        subtitle="用于发送验证码、通知邮件的 SMTP 账号"
        extra={
          config.mail.passwordConfigured ? (
            <Badge tone="success" dot>
              已配置 SMTP 密码
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              未配置 SMTP 密码
            </Badge>
          )
        }
      >
        <div className="admin-form-grid">
          <Field label="SMTP 服务器地址" required>
            <input
              className="admin-input"
              placeholder="smtp.example.com"
              value={mail.host}
              disabled={readOnly}
              onChange={(event) => setMail({ ...mail, host: event.target.value })}
            />
          </Field>
          <Field label="端口" required>
            <input
              className="admin-input"
              inputMode="numeric"
              placeholder="465 / 587"
              value={mail.port}
              disabled={readOnly}
              onChange={(event) =>
                setMail({ ...mail, port: event.target.value.replace(/\D/g, "") })
              }
            />
          </Field>
          <Field label="发件人名称" required>
            <input
              className="admin-input"
              placeholder="校园支付"
              value={mail.fromName}
              disabled={readOnly}
              onChange={(event) =>
                setMail({ ...mail, fromName: event.target.value })
              }
            />
          </Field>
          <Field label="发件邮箱地址" required>
            <input
              className="admin-input"
              type="email"
              placeholder="noreply@example.com"
              value={mail.fromAddress}
              disabled={readOnly}
              onChange={(event) =>
                setMail({ ...mail, fromAddress: event.target.value })
              }
            />
          </Field>
          <Field label="SMTP 用户名">
            <input
              className="admin-input"
              placeholder="通常与发件邮箱一致"
              value={mail.username}
              disabled={readOnly}
              onChange={(event) =>
                setMail({ ...mail, username: event.target.value })
              }
            />
          </Field>
          <Field
            label="SMTP 密码 / 授权码"
            hint={
              config.mail.passwordConfigured
                ? "已配置密码；如需修改请输入新密码，留空则保持不变。"
                : "尚未配置密码，请填写 SMTP 密码或邮箱授权码。"
            }
          >
            <input
              className="admin-input"
              type="password"
              autoComplete="new-password"
              placeholder={
                config.mail.passwordConfigured ? "留空保持不变" : "请输入 SMTP 密码"
              }
              value={mail.password}
              disabled={readOnly}
              onChange={(event) =>
                setMail({ ...mail, password: event.target.value })
              }
            />
          </Field>
          <Field
            label="启用 SSL/TLS"
            hint="端口 465 通常开启，端口 587 通常使用 STARTTLS。"
          >
            <Switch
              checked={mail.secure}
              onChange={(next) => setMail({ ...mail, secure: next })}
              label={mail.secure ? "已开启" : "未开启"}
              disabled={readOnly}
            />
          </Field>
        </div>
      </Card>

      <Card title="安全防护设置" subtitle="支付安全策略与登录会话策略">
        <div className="admin-form-grid">
          <Field label="支付密码最大错误次数" hint="超过次数后账号支付功能将被锁定。">
            <input
              className="admin-input"
              inputMode="numeric"
              value={security.maxAttempts}
              disabled={readOnly}
              onChange={(event) =>
                setSecurity({
                  ...security,
                  maxAttempts: event.target.value.replace(/\D/g, ""),
                })
              }
            />
          </Field>
          <Field label="锁定分钟数" hint="支付密码错误超限后的锁定时间。">
            <input
              className="admin-input"
              inputMode="numeric"
              value={security.lockMinutes}
              disabled={readOnly}
              onChange={(event) =>
                setSecurity({
                  ...security,
                  lockMinutes: event.target.value.replace(/\D/g, ""),
                })
              }
            />
          </Field>
          <Field label="单笔支付上限（元）" hint="0 表示不限制。">
            <input
              className="admin-input"
              inputMode="decimal"
              value={security.singleLimitYuan}
              disabled={readOnly}
              onChange={(event) =>
                setSecurity({
                  ...security,
                  singleLimitYuan: event.target.value,
                })
              }
            />
          </Field>
          <Field label="每日支付上限（元）" hint="0 表示不限制。">
            <input
              className="admin-input"
              inputMode="decimal"
              value={security.dailyLimitYuan}
              disabled={readOnly}
              onChange={(event) =>
                setSecurity({
                  ...security,
                  dailyLimitYuan: event.target.value,
                })
              }
            />
          </Field>
          <Field
            label="动态码有效期（秒）"
            hint={`当前：${formatTtlSeconds(Number(security.dynamicCodeTtl) || 0)}`}
          >
            <input
              className="admin-input"
              inputMode="numeric"
              value={security.dynamicCodeTtl}
              disabled={readOnly}
              onChange={(event) =>
                setSecurity({
                  ...security,
                  dynamicCodeTtl: event.target.value.replace(/\D/g, ""),
                })
              }
            />
          </Field>
          <Field
            label="邮箱验证码有效期（秒）"
            hint={`当前：${formatTtlSeconds(Number(security.emailCodeTtl) || 0)}`}
          >
            <input
              className="admin-input"
              inputMode="numeric"
              value={security.emailCodeTtl}
              disabled={readOnly}
              onChange={(event) =>
                setSecurity({
                  ...security,
                  emailCodeTtl: event.target.value.replace(/\D/g, ""),
                })
              }
            />
          </Field>
          <Field label="管理员登录态有效期（天）" hint="超过有效期需重新登录主站。">
            <input
              className="admin-input"
              inputMode="numeric"
              value={security.sessionTtlDays}
              disabled={readOnly}
              onChange={(event) =>
                setSecurity({
                  ...security,
                  sessionTtlDays: event.target.value.replace(/\D/g, ""),
                })
              }
            />
          </Field>
        </div>

        {formError ? (
          <div className="admin-inline-alert is-danger" style={{ marginTop: 14 }}>
            {formError}
          </div>
        ) : null}

        <div className="admin-flex" style={{ marginTop: 18, gap: 10 }}>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={submitting}
            disabled={readOnly || submitting}
          >
            保存配置
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const reset = initialState(config.mail, config.security);
              setMail(reset.mail);
              setSecurity(reset.security);
              setFormError(null);
            }}
            disabled={readOnly || submitting}
          >
            恢复为已保存配置
          </Button>
          {readOnly ? (
            <span className="admin-text-sm admin-muted">
              无保存权限：系统配置仅超级管理员可修改。
            </span>
          ) : null}
        </div>
      </Card>

      <div className="admin-card">
        <SectionTitle>操作说明</SectionTitle>
        <ul className="admin-text-sm admin-secondary" style={{ lineHeight: 2, marginTop: 10 }}>
          <li>修改 SMTP 配置后建议先在「系统状态」页确认邮件发送成功率是否恢复。</li>
          <li>单笔与每日限额以元为单位填写，保存时自动转换为分存储，0 表示不限制。</li>
          <li>支付密码错误次数与锁定时间同时作用于用户端支付验证，请谨慎调整。</li>
          <li>所有配置变更会写入操作日志，可在「日志查看 → 操作日志」中追溯。</li>
        </ul>
      </div>
    </div>
  );
}

function yuanToCentsOrZero(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const cents = parseYuanToCents(trimmed);
  return cents === null ? 0 : cents;
}

function validate(
  mail: MailFormState,
  security: SecurityFormState,
): { error?: string } {
  if (!mail.host.trim()) return { error: "请填写 SMTP 服务器地址。" };
  const port = Number(mail.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: "SMTP 端口需为 1–65535 的整数。" };
  }
  if (!mail.fromName.trim()) return { error: "请填写发件人名称。" };
  if (!mail.fromAddress.trim()) return { error: "请填写发件邮箱地址。" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.fromAddress.trim())) {
    return { error: "发件邮箱地址格式不正确。" };
  }

  const maxAttempts = Number(security.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    return { error: "支付密码最大错误次数需为 1–20 的整数。" };
  }
  const lockMinutes = Number(security.lockMinutes);
  if (!Number.isInteger(lockMinutes) || lockMinutes < 1 || lockMinutes > 1440) {
    return { error: "锁定分钟数需为 1–1440 的整数。" };
  }
  const single = parseYuanToCents(security.singleLimitYuan);
  if (single === null) return { error: "单笔支付上限金额格式不正确。" };
  const daily = parseYuanToCents(security.dailyLimitYuan);
  if (daily === null) return { error: "每日支付上限金额格式不正确。" };
  if (single > 0 && daily > 0 && single > daily) {
    return { error: "单笔支付上限不能大于每日支付上限。" };
  }
  const dynamicTtl = Number(security.dynamicCodeTtl);
  if (!Number.isInteger(dynamicTtl) || dynamicTtl < 30 || dynamicTtl > 600) {
    return { error: "动态码有效期需为 30–600 秒。" };
  }
  const emailTtl = Number(security.emailCodeTtl);
  if (!Number.isInteger(emailTtl) || emailTtl < 60 || emailTtl > 3600) {
    return { error: "邮箱验证码有效期需为 60–3600 秒。" };
  }
  const sessionDays = Number(security.sessionTtlDays);
  if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 30) {
    return { error: "管理员登录态有效期需为 1–30 天。" };
  }
  return {};
}
