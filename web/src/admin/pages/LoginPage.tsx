/**
 * 登录页：后台不再有独立登录，完全复用主站（用户端）会话 Cookie。
 * 仅提供「用校园墙账号登录」入口（整页跳转走后端 OAuth 流程）。
 * 版式：左侧深墨品牌区（说明权限模型），右侧登录表单；窄屏上下堆叠。
 */
import type { ReactNode } from "react";
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

/** 左侧品牌区的三条说明 */
const HERO_POINTS: { title: string; text: string }[] = [
  { title: "复用主站登录会话", text: "用校园墙账号登录主站即可，后台不另设密码" },
  { title: "按角色授权", text: "超级管理员 / 运营 / 只读审计，权限互不越界" },
  { title: "操作全程留痕", text: "所有写操作写入不可修改的操作日志" },
];

/** 右侧底部的角色说明（与 AdminsPage 的角色定义一致） */
const ROLE_ROWS: { name: string; text: string; tone: "primary" | "success" | "muted" }[] = [
  { name: "超级管理员", text: "全部权限，可管理管理员与系统配置", tone: "primary" },
  { name: "运营", text: "处理订单、用户与公告，不可改系统配置", tone: "success" },
  { name: "只读审计", text: "仅可查看数据与日志，所有写操作禁用", tone: "muted" },
];

function InfoIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 10.6v5.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="12" cy="7.9" r="1.15" fill="currentColor" />
    </svg>
  );
}

function ShieldIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.4 5 6.2v5.3c0 4.2 2.9 7.4 7 9.1 4.1-1.7 7-4.9 7-9.1V6.2L12 3.4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="m9 12.1 2.1 2.1L15.2 10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LoginArrowIcon(): ReactNode {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13.5 5.5 20 12l-6.5 6.5M20 12H4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparkIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.2l1.7 4.9 4.9 1.7-4.9 1.7L12 16.4l-1.7-4.9L5.4 9.8l4.9-1.7L12 3.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function LoginPage({
  themeMode,
  onThemeChange,
  onLogin,
  reason = "anonymous",
  error,
  onRetry,
}: LoginPageProps): ReactNode {
  const notAdmin = reason === "not_admin";

  return (
    <div className="admin-auth-page admin-login-page">
      <div className="admin-auth-theme">
        <ThemeSwitch mode={themeMode} onChange={onThemeChange} />
      </div>

      <div className="admin-login-shell">
        <aside className="admin-login-hero">
          <div className="admin-login-hero-glow" aria-hidden="true" />

          <div className="admin-auth-brand admin-login-hero-brand">
            <span className="admin-brand-mark" aria-hidden="true" />
            <span className="admin-brand-name">
              <span className="admin-brand-name-gzs">gzs</span>
              <span className="admin-brand-name-pay">pay</span>
            </span>
            <span className="admin-brand-sub">管理后台</span>
          </div>

          <div className="admin-login-hero-copy">
            <p className="admin-login-hero-eyebrow">
              <SparkIcon />
              校园服务
            </p>
            <h1 className="admin-login-hero-title">
              校园支付
              <span>管理后台</span>
            </h1>
            <p className="admin-login-hero-text">
              处理订单、管理用户与公告、查看交易统计。管理员权限复用主站校园墙登录会话。
            </p>
          </div>

          <ul className="admin-login-hero-points">
            {HERO_POINTS.map((point) => (
              <li key={point.title}>
                <span className="admin-login-hero-dot" aria-hidden="true" />
                <span>
                  <strong>{point.title}</strong>
                  {point.text}
                </span>
              </li>
            ))}
          </ul>

          <p className="admin-login-hero-foot">gzspay · 数据仅用于校园内的收付款记录与沟通</p>
        </aside>

        <section className="admin-login-form">
          <p className="admin-login-eyebrow">ADMIN CONSOLE</p>
          <h2 className="admin-login-title">{notAdmin ? "账号暂无后台权限" : "登录管理后台"}</h2>
          <p className="admin-login-sub">
            {notAdmin
              ? "你的校园墙账号可以正常使用主站，但还没有被加入管理员名单。"
              : "使用登录 gzspay 主站的校园墙账号进入；如果该账号已是管理员，会直接看到后台数据。"}
          </p>

          {notAdmin ? (
            <div className="admin-inline-alert is-danger admin-login-alert" role="status">
              <InfoIcon />
              <span>当前账号不在管理员名单内，请联系超级管理员开通。</span>
            </div>
          ) : (
            <div className="admin-inline-alert is-info admin-login-alert" role="status">
              <InfoIcon />
              <span>请先登录 gzspay 主站，登录成功后会自动回到后台。</span>
            </div>
          )}

          {error ? (
            <div className="admin-inline-alert is-danger admin-login-alert" role="alert">
              <InfoIcon />
              <span className="admin-login-alert-text">{error}</span>
              {onRetry ? (
                <button type="button" className="admin-btn admin-btn-link admin-btn-sm" onClick={onRetry}>
                  重试
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="admin-auth-actions admin-login-actions">
            <button type="button" className="admin-btn admin-btn-primary admin-auth-btn admin-login-btn" onClick={onLogin}>
              <span>用校园墙账号登录</span>
              <LoginArrowIcon />
            </button>
          </div>

          <p className="admin-login-badge">
            <ShieldIcon />
            复用主站登录会话，无需单独密码
          </p>

          <div className="admin-login-roles">
            <p className="admin-login-roles-title">角色权限</p>
            {ROLE_ROWS.map((role) => (
              <div key={role.name} className="admin-login-role">
                <span className={`admin-login-role-dot is-${role.tone}`} aria-hidden="true" />
                <span className="admin-login-role-name">{role.name}</span>
                <span className="admin-login-role-text">{role.text}</span>
              </div>
            ))}
          </div>

          <p className="admin-login-foot">
            {notAdmin
              ? "如需开通后台权限，请联系任意一位超级管理员，把你的账号加入管理员名单后再重新登录。"
              : "登录即代表你已知悉并遵守校园支付系统安全规范，请勿在公共设备上保持登录。"}
          </p>
        </section>
      </div>
    </div>
  );
}
