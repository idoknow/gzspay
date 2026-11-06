/**
 * 初始化向导的四步表单（纯展示组件）。
 * 表单状态由 SetupWizard 统一持有，保存逻辑也在向导内，便于「上一步」保留已填内容。
 */
import { Button, Field, InfoBanner, Switch } from "./ui";
import type { SetupStatus } from "../types";

/* ------------------------------------------------------------------ 表单状态 */

export interface CampuxFormState {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export interface MailFormState {
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

export interface SystemFormState {
  siteName: string;
  /** 站点对外地址，留空表示使用当前访问地址 */
  publicBaseUrl?: string;
}

/* ------------------------------------------------------------------ 第 1 步 */

export interface SetupStepCampuxProps {
  value: CampuxFormState;
  /** 后端是否已保存过 Client Secret（不回显明文） */
  secretConfigured: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<CampuxFormState>) => void;
}

/** 第 1 步：校园墙登录配置 */
export function SetupStepCampux({
  value,
  secretConfigured,
  disabled,
  onChange,
}: SetupStepCampuxProps) {
  return (
    <div className="admin-form-grid">
      <Field
        label="校园墙 Base URL"
        hint="例如 https://gz.campux.top，末尾不带斜杠"
        required
        className="admin-field-full"
      >
        <input
          className="admin-input"
          value={value.baseUrl}
          placeholder="https://gz.campux.top"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
        />
      </Field>
      <Field label="Client ID" required>
        <input
          className="admin-input"
          value={value.clientId}
          placeholder="校园墙分配的 client_id"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ clientId: event.target.value })}
        />
      </Field>
      <Field label="Scope" hint="默认 profile，多个权限用空格分隔">
        <input
          className="admin-input"
          value={value.scope}
          placeholder="profile"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ scope: event.target.value })}
        />
      </Field>
      <Field
        label="Client Secret"
        hint={
          secretConfigured
            ? "留空表示不修改"
            : "校园墙后台获取"
        }
        required={!secretConfigured}
        className="admin-field-full"
      >
        <input
          className="admin-input"
          type="password"
          value={value.clientSecret}
          placeholder={secretConfigured ? "留空表示不修改" : "校园墙分配的 client_secret"}
          autoComplete="new-password"
          disabled={disabled}
          onChange={(event) => onChange({ clientSecret: event.target.value })}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ 第 2 步 */

export interface SetupStepMailProps {
  value: MailFormState;
  /** 后端是否已保存过 SMTP 密码（不回显明文） */
  passwordConfigured: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<MailFormState>) => void;
}

/** 第 2 步：发件（SMTP）配置 */
export function SetupStepMail({
  value,
  passwordConfigured,
  disabled,
  onChange,
}: SetupStepMailProps) {
  return (
    <div className="admin-form-grid">
      <Field label="SMTP 主机" hint="QQ 邮箱为 smtp.qq.com" required>
        <input
          className="admin-input"
          value={value.host}
          placeholder="smtp.qq.com"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ host: event.target.value })}
        />
      </Field>
      <Field label="端口" hint="SSL 一般为 465" required>
        <input
          className="admin-input"
          value={value.port}
          inputMode="numeric"
          placeholder="465"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) =>
            onChange({ port: event.target.value.replace(/\D/g, "") })
          }
        />
      </Field>
      <Field label="SMTP 账号" required className="admin-field-full">
        <input
          className="admin-input"
          value={value.username}
          placeholder="一般是发件邮箱地址"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ username: event.target.value })}
        />
      </Field>
      <Field
        label="SMTP 密码 / 授权码"
        hint={
          passwordConfigured
            ? "留空表示不修改"
            : "QQ 邮箱需填授权码"
        }
        required={!passwordConfigured}
        className="admin-field-full"
      >
        <input
          className="admin-input"
          type="password"
          value={value.password}
          placeholder={passwordConfigured ? "留空表示不修改" : "邮箱授权码"}
          autoComplete="new-password"
          disabled={disabled}
          onChange={(event) => onChange({ password: event.target.value })}
        />
      </Field>
      <Field label="发件人名称" required>
        <input
          className="admin-input"
          value={value.fromName}
          placeholder="gzspay"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ fromName: event.target.value })}
        />
      </Field>
      <Field label="发件人邮箱" hint="通常与 SMTP 账号一致" required>
        <input
          className="admin-input"
          value={value.fromAddress}
          placeholder="xxx@qq.com"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ fromAddress: event.target.value })}
        />
      </Field>
      <Field label="SSL 加密" className="admin-field-full">
        <Switch
          checked={value.secure}
          label={value.secure ? "已开启（推荐）" : "已关闭"}
          disabled={disabled}
          onChange={(secure) => onChange({ secure })}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ 第 3 步 */

export interface SetupStepSystemProps {
  value: SystemFormState;
  disabled?: boolean;
  onChange: (patch: Partial<SystemFormState>) => void;
}

/** 第 3 步：站点信息 */
export function SetupStepSystem({
  value,
  disabled,
  onChange,
}: SetupStepSystemProps) {
  return (
    <div className="admin-form-grid">
      <Field
        label="站点名称"
        required
        className="admin-field-full"
      >
        <input
          className="admin-input"
          value={value.siteName}
          placeholder="gzspay 校园服务"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ siteName: event.target.value })}
        />
      </Field>
      <Field
        label="站点地址"
        hint="例如 https://pay.idoknow.top"
        className="admin-field-full"
      >
        <input
          className="admin-input"
          value={value.publicBaseUrl ?? ""}
          placeholder="https://pay.idoknow.top"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange({ publicBaseUrl: event.target.value })}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ 第 4 步 */

export interface SetupStepFinishProps {
  status: SetupStatus;
  finishing: boolean;
  onLogin: () => void;
  onRefresh: () => void;
  onFinish: () => void;
  onGoToStep: (step: 1 | 2 | 3) => void;
}

/** 第 4 步：完成初始化（当前主站账号成为超级管理员） */
export function SetupStepFinish({
  status,
  finishing,
  onLogin,
  onRefresh,
  onFinish,
  onGoToStep,
}: SetupStepFinishProps) {
  const missing: Array<{ step: 1 | 2 | 3; label: string }> = [];
  if (!status.campuxConfigured) {
    missing.push({ step: 1, label: "校园墙登录配置" });
  }
  if (!status.mailConfigured) {
    missing.push({ step: 2, label: "发件配置" });
  }
  const ready = status.campuxConfigured && status.mailConfigured;
  const user = status.currentUser;

  return (
    <div className="admin-setup-finish">
      <InfoBanner tone="info">
        初始化后系统正式对外运行；首个登录账号成为超级管理员。
      </InfoBanner>

      {missing.length > 0 ? (
        <InfoBanner tone="warning">
          <div>
            还差「{missing.map((item) => item.label).join("」「")}」未配置，请先返回对应步骤保存。
          </div>
          <div className="admin-setup-links">
            {missing.map((item) => (
              <Button
                key={item.step}
                variant="link"
                size="sm"
                onClick={() => onGoToStep(item.step)}
              >
                返回第 {item.step} 步
              </Button>
            ))}
          </div>
        </InfoBanner>
      ) : null}

      {user ? (
        <div className="admin-setup-account">
          <div className="admin-setup-account-main">
            <span className="admin-avatar admin-setup-avatar" aria-hidden="true">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" />
              ) : (
                user.displayName.slice(0, 1)
              )}
            </span>
            <div>
              <div className="admin-setup-account-label">当前账号</div>
              <div className="admin-strong">{user.displayName}</div>
            </div>
          </div>
          <div className="admin-form-actions">
            <Button
              variant="primary"
              className="admin-auth-btn"
              loading={finishing}
              disabled={!ready}
              onClick={onFinish}
            >
              完成初始化
            </Button>
          </div>
          {!ready ? (
            <p className="admin-field-hint">请先完成第 1、2 步。</p>
          ) : null}
        </div>
      ) : (
        <div className="admin-setup-account">
          <p className="admin-setup-login-note">
            先用校园墙账号登录主站。
          </p>
          <div className="admin-form-actions">
            <Button
              variant="primary"
              className="admin-auth-btn"
              onClick={onLogin}
            >
              用校园墙账号登录
            </Button>
          </div>
          <div className="admin-setup-links">
            <Button variant="link" size="sm" onClick={onRefresh}>
              刷新状态
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
