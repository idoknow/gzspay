/**
 * 管理后台通用 UI 组件：
 * 按钮 / 卡片 / 页头 / 表单字段 / 徽标 / 空态 / 错误态 / 骨架屏 / 分页 / 页签 /
 * 弹窗 / 抽屉 / 主题切换 / 开关 / 详情键值 / 进度条 / 统计卡等。
 * 全部为自写组件，不依赖组件库。
 */
import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  appealStatusLabel,
  appealStatusTone,
  orderStatusLabel,
  orderStatusTone,
  roleLabel,
  roleTone,
} from "../format";
import type { BadgeTone } from "../types";

/** 拼接类名（忽略空值） */
export function cx(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}

/* ------------------------------------------------------------------ 按钮 */

export type ButtonVariant =
  | "primary"
  | "accent"
  | "ghost"
  | "subtle"
  | "danger"
  | "danger-ghost"
  | "link";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm";
  loading?: boolean;
}

const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "admin-btn-primary",
  accent: "admin-btn-accent",
  ghost: "admin-btn-ghost",
  subtle: "admin-btn-subtle",
  danger: "admin-btn-danger",
  "danger-ghost": "admin-btn-danger-ghost",
  link: "admin-btn-link",
};

export function Button({
  variant = "ghost",
  size,
  loading = false,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx(
        "admin-btn",
        BUTTON_VARIANT_CLASS[variant],
        size === "sm" && "admin-btn-sm",
        className,
      )}
      disabled={disabled === true || loading}
    >
      {loading ? <span className="admin-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ 卡片 */

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  /** 内容区去掉内边距（表格/图表常用） */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function Card({
  title,
  subtitle,
  extra,
  flush = false,
  className,
  bodyClassName,
  children,
}: CardProps) {
  const hasHeader =
    title !== undefined || subtitle !== undefined || extra !== undefined;
  return (
    <section className={cx("admin-card", className)}>
      {hasHeader ? (
        <header className="admin-card-header">
          <div className="admin-page-heading">
            {title !== undefined ? (
              <h2 className="admin-card-title">{title}</h2>
            ) : null}
            {subtitle !== undefined ? (
              <div className="admin-card-subtitle">{subtitle}</div>
            ) : null}
          </div>
          {extra !== undefined ? (
            <div className="admin-card-extra">{extra}</div>
          ) : null}
        </header>
      ) : null}
      {flush ? (
        children
      ) : (
        <div className={cx("admin-card-body", bodyClassName)}>{children}</div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ 页头 */

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="admin-page-header">
      <div className="admin-page-heading">
        <h1 className="admin-page-title">{title}</h1>
        {description !== undefined ? (
          <p className="admin-page-desc">{description}</p>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="admin-page-actions">{actions}</div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- 表单字段 */

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, required, className, children }: FieldProps) {
  return (
    <label className={cx("admin-field", className)}>
      <span className="admin-label">
        {label}
        {required === true ? <span className="admin-required">*</span> : null}
      </span>
      {children}
      {hint !== undefined ? <span className="admin-field-hint">{hint}</span> : null}
    </label>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <label className="admin-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="admin-switch-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

/* ------------------------------------------------------------------ 徽标 */

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot = false, children }: BadgeProps) {
  return (
    <span className={cx("admin-badge", `admin-badge-${tone}`)}>
      {dot ? <span className="admin-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge tone={orderStatusTone(status)}>{orderStatusLabel(status)}</Badge>;
}

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone={roleTone(role)}>{roleLabel(role)}</Badge>;
}

export function AppealStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={appealStatusTone(status)}>{appealStatusLabel(status)}</Badge>
  );
}

/* -------------------------------------------------------------- 空/错/载 */

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="admin-empty">
      <div className="admin-empty-icon" aria-hidden="true">
        {icon ?? <EmptyIcon />}
      </div>
      <div className="admin-empty-title">{title}</div>
      {description !== undefined ? (
        <div className="admin-empty-desc">{description}</div>
      ) : null}
      {action !== undefined ? <div className="admin-flex">{action}</div> : null}
    </div>
  );
}

function EmptyIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 7h16M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h6" strokeLinecap="round" />
    </svg>
  );
}

export interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="admin-error-block" role="alert">
      <span aria-hidden="true">⚠</span>
      <div>
        <div className="admin-strong">加载失败</div>
        <div className="admin-text-sm">{message}</div>
      </div>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="admin-loading-note" role="status">
      <span className="admin-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonBlock({
  height = 16,
  width,
  className,
}: {
  height?: number;
  width?: number | string;
  className?: string;
}) {
  return (
    <div
      className={cx("admin-skeleton", className)}
      style={{ height, width: width ?? "100%" }}
      aria-hidden="true"
    />
  );
}

export function SkeletonCards({ count = 5 }: { count?: number }) {
  return (
    <div className="admin-stat-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="admin-skeleton admin-skeleton-card" />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="admin-card-body" aria-hidden="true">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: 16,
            padding: "10px 0",
            borderBottom: "1px solid var(--admin-border)",
          }}
        >
          {Array.from({ length: cols }, (_, colIndex) => (
            <SkeletonBlock key={colIndex} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 分页 */

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  disabled?: boolean;
}

function buildPageList(current: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const wanted = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  const sorted = Array.from(wanted)
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous !== 0 && value - previous > 1) result.push("ellipsis");
    result.push(value);
    previous = value;
  }
  return result;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100],
  disabled = false,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);
  const pageList = buildPageList(currentPage, totalPages);

  return (
    <div className="admin-pagination">
      <span className="admin-pagination-info">
        共 {total} 条 · 第 {start}-{end} 条
      </span>
      {onPageSizeChange ? (
        <select
          className="admin-select admin-input-sm"
          style={{ width: 96 }}
          value={pageSize}
          disabled={disabled}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          aria-label="每页条数"
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              每页 {option}
            </option>
          ))}
        </select>
      ) : null}
      <div className="admin-pagination-pages">
        <button
          type="button"
          className="admin-page-btn"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={disabled || currentPage <= 1}
          aria-label="上一页"
        >
          ‹
        </button>
        {pageList.map((item, index) =>
          item === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="admin-muted">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={cx("admin-page-btn", item === currentPage && "is-active")}
              onClick={() => onPageChange(item)}
              disabled={disabled}
              aria-current={item === currentPage ? "page" : undefined}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className="admin-page-btn"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={disabled || currentPage >= totalPages}
          aria-label="下一页"
        >
          ›
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 页签 */

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

export interface TabsProps<K extends string> {
  items: Array<TabItem<K>>;
  active: K;
  onChange: (key: K) => void;
}

export function Tabs<K extends string>({ items, active, onChange }: TabsProps<K>) {
  return (
    <div className="admin-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === active}
          className={cx("admin-tab", item.key === active && "is-active")}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {typeof item.count === "number" ? `（${item.count}）` : ""}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- 主题切换 */

export type ThemeMode = "auto" | "light" | "dark";

export interface ThemeSwitchProps {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

const THEME_OPTIONS: Array<{ key: ThemeMode; label: string; title: string }> = [
  { key: "auto", label: "自动", title: "跟随系统主题" },
  { key: "light", label: "浅色", title: "始终使用浅色主题" },
  { key: "dark", label: "深色", title: "始终使用深色主题" },
];

export function ThemeSwitch({ mode, onChange }: ThemeSwitchProps) {
  const activeIndex = Math.max(
    0,
    THEME_OPTIONS.findIndex((option) => option.key === mode),
  );
  return (
    <div className="admin-theme-switch" role="group" aria-label="主题切换">
      {/* 滑块指示器：三项等宽，按选中下标平移 */}
      <span
        className="admin-theme-thumb"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
        aria-hidden="true"
      />
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          title={option.title}
          aria-pressed={mode === option.key}
          className={cx("admin-theme-btn", mode === option.key && "is-active")}
          onClick={() => onChange(option.key)}
        >
          <ThemeIcon mode={option.key} />
          <span className="admin-theme-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/** 主题图标：14px 内联 SVG，跟随文字颜色 */
function ThemeIcon({ mode }: { mode: ThemeMode }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };
  switch (mode) {
    case "auto":
      // 半圆对半：跟随系统
      return (
        <svg {...common} className="admin-theme-icon">
          <circle cx="12" cy="12" r="8.4" />
          <path
            d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    case "light":
      // 太阳
      return (
        <svg {...common} className="admin-theme-icon">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" />
        </svg>
      );
    case "dark":
      // 月亮
      return (
        <svg {...common} className="admin-theme-icon">
          <path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11Z" />
        </svg>
      );
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- 弹窗/抽屉 */

function useEscapeKey(onClose: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose, active]);
}

export interface ModalProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({
  title,
  description,
  onClose,
  wide = false,
  children,
  footer,
}: ModalProps) {
  const titleId = useId();
  useEscapeKey(onClose);
  return (
    <div
      className="admin-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cx("admin-modal", wide && "is-wide")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="admin-modal-header">
          <div className="admin-page-heading">
            <h2 className="admin-modal-title" id={titleId}>
              {title}
            </h2>
            {description !== undefined ? (
              <div className="admin-modal-desc">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            className="admin-modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="admin-modal-body">{children}</div>
        {footer !== undefined ? (
          <div className="admin-modal-footer">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export interface DrawerProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({ title, subtitle, onClose, children, footer }: DrawerProps) {
  const titleId = useId();
  useEscapeKey(onClose);
  return (
    <div
      className="admin-drawer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="admin-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="admin-drawer-header">
          <div className="admin-page-heading">
            <h2 className="admin-modal-title" id={titleId}>
              {title}
            </h2>
            {subtitle !== undefined ? (
              <div className="admin-modal-desc">{subtitle}</div>
            ) : null}
          </div>
          <button
            type="button"
            className="admin-modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="admin-drawer-body">{children}</div>
        {footer !== undefined ? (
          <div className="admin-drawer-footer">{footer}</div>
        ) : null}
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------- 详情/提示 */

export function SectionTitle({
  children,
  extra,
}: {
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="admin-section-title">
      {children}
      {extra !== undefined ? (
        <span style={{ marginLeft: "auto" }}>{extra}</span>
      ) : null}
    </div>
  );
}

export interface KVItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export function KVGrid({ items }: { items: KVItem[] }) {
  return (
    <div className="admin-kv-grid">
      {items.map((item, index) => (
        <div className="admin-kv" key={`${item.label}-${index}`}>
          <div className="admin-kv-label">{item.label}</div>
          <div className={cx("admin-kv-value", item.mono === true && "admin-mono")}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InfoBanner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "admin-inline-alert",
        tone === "warning" && "is-warning",
        tone === "danger" && "is-danger",
        tone === "info" && "is-info",
      )}
    >
      <span aria-hidden="true">{tone === "info" ? "ⓘ" : "⚠"}</span>
      <div>{children}</div>
    </div>
  );
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "primary" | "accent" | "success";
  icon?: ReactNode;
}

export function StatCard({ label, value, hint, tone = "primary", icon }: StatCardProps) {
  return (
    <div className={cx("admin-stat-card", tone !== "primary" && `tone-${tone}`)}>
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
      {hint !== undefined ? <div className="admin-stat-hint">{hint}</div> : null}
      {icon !== undefined ? (
        <div className="admin-stat-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
    </div>
  );
}

export function ProgressBar({
  percent,
  tone = "primary",
}: {
  percent: number;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div
      className={cx(
        "admin-progress",
        tone === "success" && "is-success",
        tone === "warning" && "is-warning",
        tone === "danger" && "is-danger",
      )}
      role="progressbar"
      aria-valuenow={Math.round(safe)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${safe}%` }} />
    </div>
  );
}
