/**
 * 登录页：后台不再有独立登录，完全复用主站（用户端）会话 Cookie。
 * 仅提供「用校园墙账号登录」入口（整页跳转走后端 OAuth 流程）。
 */
import { ThemeSwitch } from "../components/ui";
import type { ThemeMode } from "../hooks";

/** 未进入后台的原因：未登录 / 登录了但不在管理员名单 */
export type LoginPageReason = "anonymous" | "not_admin";

export interface LoginPageProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onLogin: () => void;
  /** 由 AdminApp 根据会话接口的 error.code 映射而来 */
  reason?: LoginPageReason;
  error?: string | null;
  onRetry?: () => void;
}

export function LoginPage({
  themeMode,
  onThemeChange,
  onLogin,
  reason = "anonymous",
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
          登录 gzspay 主站时使用的校园墙账号，如果该账号已是管理员即可进入后台。
        </p>

        {reason === "not_admin" ? (
          <div className="admin-inline-alert is-danger" role="status">
            <span>你的账号不在管理员名单内</span>
          </div>
        ) : (
          <div className="admin-inline-alert is-info" role="status">
            <span>请先登录 gzspay 主站</span>
          </div>
        )}

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
            用校园墙账号登录
          </button>
        </div>

        <div className="admin-auth-badge">复用主站登录会话，无需单独密码</div>

        {reason === "not_admin" ? (
          <p className="admin-auth-note">
            如需开通后台权限，请联系任意一位超级管理员，将你的账号加入管理员名单后再重新登录。
          </p>
        ) : null}

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
