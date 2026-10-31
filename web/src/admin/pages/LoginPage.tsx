/**
 * 登录页：仅提供「使用校园墙账号登录」入口（整页跳转走后端 OAuth 流程）。
 * 后端回调成功后会 302 回后台；需要二次验证时进入 VerifyPage。
 */
import { ThemeSwitch } from "../components/ui";
import type { ThemeMode } from "../hooks";

export interface LoginPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onLogin: () => void;
  error?: string | null;
  onRetry?: () => void;
}

export function LoginPage({
  themeMode,
  onThemeChange,
  onLogin,
  error,
  onRetry,
}: LoginPageProps) {
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
        <h1 className="admin-auth-title">校园支付 · 管理后台</h1>
        <p className="admin-auth-sub">
          使用校园墙账号登录。后台按管理员角色控制权限，所有敏感操作均会写入审计日志。
        </p>

        {error ? (
          <div className="admin-inline-alert is-danger" role="alert">
            <span>{error}</span>
            {onRetry ? (
              <button
                type="button"
                className="admin-btn admin-btn-link admin-btn-sm"
                onClick={onRetry}
              >
                重试
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="admin-auth-actions">
          <button
            type="button"
            className="admin-btn admin-btn-primary admin-auth-btn"
            onClick={onLogin}
          >
            使用校园墙账号登录
          </button>
        </div>

        <div className="admin-auth-badge">需通过邮箱验证码二次验证</div>

        <div className="admin-role-cards">
          <div className="admin-role-card">
            <div className="admin-role-card-title">超级管理员</div>
            <div>全部权限，可管理管理员与系统配置</div>
          </div>
          <div className="admin-role-card">
            <div className="admin-role-card-title">运营</div>
            <div>可处理订单、用户与公告，不可改配置</div>
          </div>
          <div className="admin-role-card">
            <div className="admin-role-card-title">只读审计</div>
            <div>仅可查看数据与日志，所有写操作禁用</div>
          </div>
        </div>

        <p className="admin-auth-note">
          登录即代表你已知悉并遵守校园支付系统安全规范。请勿在公共设备上保持登录。
        </p>
      </div>
    </div>
  );
}
