/**
 * 二次验证页：输入发往管理员邮箱的 6 位验证码完成登录。
 */
import { useState } from "react";
import { verifyAdminCode } from "../api";
import { ThemeSwitch } from "../components/ui";
import { errorMessage } from "../../lib/http";
import type { ThemeMode } from "../hooks";
import type { AdminIdentity } from "../types";

export interface VerifyPageProps {
  emailMasked: string;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onVerified: (admin: AdminIdentity) => void;
  onReLogin: () => void;
}

export function VerifyPage({
  emailMasked,
  themeMode,
  onThemeChange,
  onVerified,
  onReLogin,
}: VerifyPageProps) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = code.length === 6 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await verifyAdminCode(code);
      if (!result.admin) {
        setError("验证已通过，但未能获取管理员信息，请重新登录后再试。");
        return;
      }
      onVerified(result.admin);
    } catch (cause) {
      setError(errorMessage(cause));
      setCode("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-auth-page">
      <div className="admin-auth-theme">
        <ThemeSwitch mode={themeMode} onChange={onThemeChange} />
      </div>

      <div className="admin-auth-card">
        <div className="admin-auth-brand">
          <span className="admin-brand-mark" aria-hidden="true" />
          <span className="admin-brand-name">
            <span className="admin-brand-name-gzs">gzs</span>
            <span className="admin-brand-name-pay">pay</span>
          </span>
          <span className="admin-brand-sub">管理后台</span>
        </div>
        <h1 className="admin-auth-title">管理员二次验证</h1>
        <p className="admin-auth-sub">
          为了保障后台安全，请输入发送到管理员邮箱
          {emailMasked ? (
            <span className="admin-strong"> {emailMasked} </span>
          ) : (
            " "
          )}
          的 6 位验证码。
        </p>

        <form
          className="admin-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="admin-field">
            <label className="admin-label" htmlFor="admin-verify-code">
              验证码
            </label>
            <input
              id="admin-verify-code"
              className="admin-input admin-code-input"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              autoFocus
              disabled={submitting}
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(next);
                if (error) setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <span className="admin-field-hint">
              验证码 10 分钟内有效；若未收到，请检查校园墙绑定邮箱或重新登录。
            </span>
          </div>

          {error ? (
            <div className="admin-inline-alert is-danger" role="alert">
              {error}
            </div>
          ) : null}

          <div className="admin-auth-actions">
            <button
              type="submit"
              className="admin-btn admin-btn-primary admin-auth-btn"
              disabled={!canSubmit}
            >
              {submitting ? "正在验证…" : "完成验证并进入后台"}
            </button>
          </div>
        </form>

        <div className="admin-auth-footnote">
          <button
            type="button"
            className="admin-btn admin-btn-link admin-btn-sm"
            onClick={onReLogin}
          >
            使用其他账号重新登录
          </button>
        </div>

        <p className="admin-auth-note">
          若连续多次输入错误，验证入口会短暂锁定，请稍后再试。
        </p>
      </div>
    </div>
  );
}
