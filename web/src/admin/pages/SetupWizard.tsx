/**
 * 初始化向导：系统首次使用必须先完成「校园墙登录 / 发件配置 / 站点信息」，
 * 最后由第一个完成主站登录的账号完成初始化，成为超级管理员。
 *
 * 接口：GET /setup/status、POST /setup/config、POST /setup/finish（均无需后台登录）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "../../lib/http";
import {
  ADMIN_LOGIN_URL,
  finishSetup,
  getSetupStatus,
  saveSetupConfig,
} from "../api";
import {
  Button,
  Field,
  ProgressBar,
  ThemeSwitch,
  cx,
} from "../components/ui";
import {
  SetupStepCampux,
  SetupStepFinish,
  SetupStepMail,
  SetupStepSystem,
  type CampuxFormState,
  type MailFormState,
  type SystemFormState,
} from "../components/SetupSteps";
import type { ThemeMode } from "../hooks";
import type { SetupConfigInput, SetupStatus } from "../types";

export interface SetupWizardProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  /** 初始化完成（或发现系统已初始化）时回调，由 AdminApp 重新拉取会话 */
  onCompleted: () => void;
}

type StepKey = 1 | 2 | 3 | 4;

const STEPS: Array<{ key: StepKey; title: string; desc: string }> = [
  {
    key: 1,
    title: "校园墙登录",
    desc: "主站登录用到的校园墙应用",
  },
  { key: 2, title: "发件配置", desc: "发送通知邮件" },
  { key: 3, title: "站点信息", desc: "站点名称与对外地址" },
  { key: 4, title: "完成初始化", desc: "登录主站账号并成为超级管理员" },
];

const EMPTY_CAMPUX: CampuxFormState = {
  baseUrl: "",
  clientId: "",
  clientSecret: "",
  scope: "profile",
};

const EMPTY_MAIL: MailFormState = {
  host: "",
  port: "465",
  secure: true,
  username: "",
  password: "",
  fromName: "gzspay",
  fromAddress: "",
};

const EMPTY_SYSTEM: SystemFormState = {
  siteName: "gzspay 校园服务",
  publicBaseUrl: "",
};

/** 取步骤元信息；step 恒在 1–4 内，兜底仅为类型安全 */
function stepInfo(key: StepKey): { key: StepKey; title: string; desc: string } {
  return (
    STEPS.find((item) => item.key === key) ?? {
      key: 1,
      title: "校园墙登录",
      desc: "",
    }
  );
}

/** 去掉首尾空白与结尾斜杠 */
function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** 把数字输入框的值解析为合法端口；非法返回 null */
function parsePort(value: string): number | null {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function SetupWizard({
  themeMode,
  onThemeChange,
  onCompleted,
}: SetupWizardProps) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<StepKey>(1);
  const [campux, setCampux] = useState<CampuxFormState>(EMPTY_CAMPUX);
  const [mail, setMail] = useState<MailFormState>(EMPTY_MAIL);
  const [system, setSystem] = useState<SystemFormState>(EMPTY_SYSTEM);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** 一次性初始化令牌（服务端启动日志里的「初始化令牌」） */
  const [setupToken, setSetupToken] = useState("");
  // 表单只在首次拿到状态时回填，后续刷新（如登录后）不覆盖用户已填内容
  const hydratedRef = useRef(false);

  const applyStatus = useCallback((next: SetupStatus) => {
    setStatus(next);
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setCampux({
      baseUrl: next.campux.baseUrl,
      clientId: next.campux.clientId,
      clientSecret: "",
      scope: next.campux.scope || "profile",
    });
    setMail({
      host: next.mail.host,
      port: String(next.mail.port),
      secure: next.mail.secure,
      username: next.mail.username,
      password: "",
      fromName: next.mail.fromName,
      fromAddress: next.mail.fromAddress,
    });
    setSystem({
      siteName: next.system.siteName,
      publicBaseUrl: next.system.publicBaseUrl,
    });
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getSetupStatus();
      applyStatus(next);
      if (next.initialized) onCompleted();
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [applyStatus, onCompleted]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const secretConfigured = status?.campux.clientSecretConfigured ?? false;
  const passwordConfigured = status?.mail.passwordConfigured ?? false;

  const validateStep = (target: StepKey): string | null => {
    if (target === 1) {
      if (!normalizeBaseUrl(campux.baseUrl)) {
        return "请填写校园墙 Base URL。";
      }
      if (!/^https?:\/\/[^\s]+$/i.test(normalizeBaseUrl(campux.baseUrl))) {
        return "校园墙 Base URL 需以 http:// 或 https:// 开头。";
      }
      if (!campux.clientId.trim()) return "请填写 Client ID。";
      if (!secretConfigured && !campux.clientSecret.trim()) {
        return "请填写 Client Secret。";
      }
      return null;
    }
    if (target === 2) {
      if (!mail.host.trim()) return "请填写 SMTP 主机。";
      if (parsePort(mail.port) === null) {
        return "SMTP 端口需为 1–65535 之间的整数。";
      }
      if (!mail.username.trim()) return "请填写 SMTP 账号。";
      if (!passwordConfigured && !mail.password.trim()) {
        return "请填写 SMTP 密码或授权码。";
      }
      if (!mail.fromName.trim()) return "请填写发件人名称。";
      if (!isEmail(mail.fromAddress.trim())) {
        return "请填写正确的发件人邮箱地址。";
      }
      return null;
    }
    if (target === 3) {
      if (!system.siteName.trim()) return "请填写站点名称。";
      const base = (system.publicBaseUrl ?? "").trim();
      if (base && !/^https?:\/\//i.test(base)) {
        return "站点地址需以 http:// 或 https:// 开头。";
      }
      return null;
    }
    return null;
  };

  /** 只提交当前步骤的字段；secret / password 留空表示保留旧值 */
  const buildInput = (target: StepKey): SetupConfigInput => {
    if (target === 1) {
      return {
        campux: {
          baseUrl: normalizeBaseUrl(campux.baseUrl),
          clientId: campux.clientId.trim(),
          clientSecret: campux.clientSecret,
          scope: campux.scope.trim() || "profile",
        },
      };
    }
    if (target === 2) {
      return {
        mail: {
          host: mail.host.trim(),
          port: parsePort(mail.port) ?? 465,
          secure: mail.secure,
          username: mail.username.trim(),
          password: mail.password,
          fromName: mail.fromName.trim(),
          fromAddress: mail.fromAddress.trim(),
        },
      };
    }
    if (target === 3) {
      return {
        system: {
          siteName: system.siteName.trim(),
          publicBaseUrl: (system.publicBaseUrl ?? "").trim(),
        },
      };
    }
    return {};
  };

  const goToStep = (target: StepKey) => {
    setFormError(null);
    setStep(target);
  };

  const handleSave = async () => {
    if (saving || finishing) return;
    if (status?.setupTokenRequired && setupToken.trim() === "") {
      setFormError("请先填写启动日志中的初始化令牌。");
      return;
    }
    const validation = validateStep(step);
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const next = await saveSetupConfig(buildInput(step), setupToken);
      applyStatus(next);
      if (next.initialized) {
        onCompleted();
        return;
      }
      // 密钥已保存，清空输入框，与「已配置，留空表示不修改」提示保持一致
      if (step === 1) {
        setCampux((prev) => ({ ...prev, clientSecret: "" }));
      }
      if (step === 2) {
        setMail((prev) => ({ ...prev, password: "" }));
      }
      setStep((step + 1) as StepKey);
    } catch (error) {
      if (error instanceof ApiError && error.code === "ALREADY_INITIALIZED") {
        onCompleted();
        return;
      }
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    if (finishing || saving) return;
    if (!status?.campuxConfigured || !status.mailConfigured) {
      setFormError("请先完成第 1、2 步。");
      return;
    }
    setFinishing(true);
    setFormError(null);
    try {
      await finishSetup();
      onCompleted();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "ALREADY_INITIALIZED") {
          onCompleted();
          return;
        }
        if (error.code === "UNAUTHENTICATED") {
          setFormError("登录状态已失效，请重新用校园墙账号登录。");
          return;
        }
      }
      setFormError(errorMessage(error));
    } finally {
      setFinishing(false);
    }
  };

  const handleLogin = () => {
    // 整页跳转主站登录；登录完成后回到 /admin，会话接口会返回 SYSTEM_NOT_INITIALIZED 并再次进入向导
    window.location.href = ADMIN_LOGIN_URL;
  };

  const activeStep = stepInfo(step);

  return (
    <div className="admin-auth-page admin-setup-page">
      <div className="admin-auth-theme">
        <ThemeSwitch mode={themeMode} onChange={onThemeChange} />
      </div>

      <div className="admin-setup-card">
        <div className="admin-auth-brand">
          <span className="admin-brand-mark" aria-hidden="true" />
          <span className="admin-brand-name">
            <span className="admin-brand-name-gzs">gzs</span>
            <span className="admin-brand-name-pay">pay</span>
          </span>
          <span className="admin-brand-sub">初始化向导</span>
        </div>
        <h1 className="admin-auth-title">初始化向导</h1>
        <p className="admin-auth-sub">
          完成以下配置后，首个登录账号成为超级管理员。
        </p>

        {status?.setupTokenRequired ? (
          <div className="admin-form-grid">
            <Field
              label="初始化令牌"
              required
              className="admin-field-full"
              hint="见服务端启动日志，仅持有者可初始化"
            >
              <input
                className="admin-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={setupToken}
                disabled={saving || finishing}
                placeholder="例如 7K3M9QZ2AB4C"
                onChange={(event) => setSetupToken(event.target.value.toUpperCase())}
              />
            </Field>
          </div>
        ) : null}

        {loading && status === null ? (
          <div className="admin-loading-note">
            <span className="admin-spinner" aria-hidden="true" />
            正在读取初始化状态…
          </div>
        ) : loadError && status === null ? (
          <div className="admin-inline-alert is-danger" role="alert">
            <span>{loadError}</span>
            <button
              type="button"
              className="admin-btn admin-btn-link admin-btn-sm"
              onClick={() => void loadStatus()}
            >
              重试
            </button>
          </div>
        ) : status !== null ? (
          <>
            <div className="admin-setup-progress">
              <div className="admin-setup-progress-head">
                <span className="admin-strong">
                  第 {step} / 4 步 · {activeStep.title}
                </span>
                <span className="admin-muted">{activeStep.desc}</span>
              </div>
              <ProgressBar percent={(step / STEPS.length) * 100} />
              <ol className="admin-setup-steps">
                {STEPS.map((item) => (
                  <li
                    key={item.key}
                    className={cx(
                      "admin-setup-step",
                      item.key < step && "is-done",
                      item.key === step && "is-current",
                    )}
                  >
                    <span className="admin-setup-step-no" aria-hidden="true">
                      {item.key < step ? "✓" : item.key}
                    </span>
                    <span>{item.title}</span>
                  </li>
                ))}
              </ol>
            </div>

            {step === 1 ? (
              <SetupStepCampux
                value={campux}
                secretConfigured={secretConfigured}
                disabled={saving}
                onChange={(patch) => setCampux((prev) => ({ ...prev, ...patch }))}
              />
            ) : step === 2 ? (
              <SetupStepMail
                value={mail}
                passwordConfigured={passwordConfigured}
                disabled={saving}
                onChange={(patch) => setMail((prev) => ({ ...prev, ...patch }))}
              />
            ) : step === 3 ? (
              <SetupStepSystem
                value={system}
                disabled={saving}
                onChange={(patch) => setSystem((prev) => ({ ...prev, ...patch }))}
              />
            ) : (
              <SetupStepFinish
                status={status}
                finishing={finishing}
                onLogin={handleLogin}
                onRefresh={() => void loadStatus()}
                onFinish={() => void handleFinish()}
                onGoToStep={goToStep}
              />
            )}

            {formError ? (
              <div className="admin-inline-alert is-danger" role="alert">
                <span>{formError}</span>
              </div>
            ) : null}

            <div className="admin-setup-footer">
              <Button
                variant="subtle"
                disabled={step === 1 || saving || finishing}
                onClick={() => goToStep((step - 1) as StepKey)}
              >
                上一步
              </Button>
              {step < 4 ? (
                <Button
                  variant="primary"
                  loading={saving}
                  onClick={() => void handleSave()}
                >
                  保存并继续
                </Button>
              ) : (
                <span className="admin-field-hint">共 4 步</span>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
