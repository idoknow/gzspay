/**
 * 系统配置：校园墙 OAuth 登录、系统发件邮箱（SMTP）与安全防护设置。
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
  SkeletonCards,
  Switch,
} from "../components/ui";
import {
  formatDateTime,
  formatTtlSeconds,
  parseYuanToCents,
} from "../format";
import { useAsync } from "../hooks";
import { useAdmin } from "../context";
import { errorMessage } from "../../lib/http";
import type {
  AdminConfig,
  AdminConfigInput,
  CampuxConfig,
  MailConfig,
  SecurityConfig,
} from "../types";

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
        <InfoBanner tone="warning">只读审计：仅可查看，不能保存。</InfoBanner>
      ) : readOnly ? (
        <InfoBanner tone="info">仅超级管理员可保存，运营可查看。</InfoBanner>
      ) : null}

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refresh()} />
      ) : loading && !data ? (
        <SkeletonCards count={6} />
      ) : data ? (
        <ConfigForm
          key={`${data.campux.baseUrl}:${data.campux.clientId}:${data.campux.clientSecretConfigured}:${data.mail.host}:${data.mail.passwordConfigured}:${data.security.paymentPasswordMaxAttempts}:${data.security.sessionTtlDays}:${data.geo.blockNonChina}:${data.geo.unknownPolicy}:${data.geo.bypassPaths.join(",")}:${data.geo.ipWhitelist}:${data.geo.trustHeader}:${data.securityEntry.entryPath}`}
          config={data}
          readOnly={readOnly}
          onSaved={() => refresh()}
        />
      ) : (
        <EmptyState title="暂无配置数据" description="请稍后刷新重试。" />
      )}
    </>
  );
}

interface ConfigFormProps {
  config: AdminConfig;
  readOnly: boolean;
  onSaved: () => void;
}

interface CampuxFormState {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
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

interface GeoFormState {
  blockNonChina: boolean;
  /** 例外路径，逗号分隔 */
  bypassPaths: string;
  /** 白名单 IP / CIDR，逗号分隔 */
  ipWhitelist: string;
  unknownPolicy: "deny" | "allow";
  trustHeader: string;
}

interface EntryFormState {
  entryPath: string;
}

interface SiteFormState {
  siteName: string;
  schoolName: string;
  publicBaseUrl: string;
  icp: string;
  billRetentionDays: string;
  paymentProofRetentionDays: string;
}

function initialState(config: AdminConfig) {
  const { campux, mail, security, geo, securityEntry, system } = config;
  return {
    site: {
      siteName: system.siteName ?? "",
      schoolName: system.schoolName ?? "",
      publicBaseUrl: system.publicBaseUrl ?? "",
      icp: system.icp ?? "",
      billRetentionDays: String(system.billRetentionDays ?? 1),
      paymentProofRetentionDays: String(system.paymentProofRetentionDays ?? 15),
    } satisfies SiteFormState,
    campux: {
      baseUrl: campux.baseUrl ?? "",
      clientId: campux.clientId ?? "",
      clientSecret: "",
      scope: campux.scope || "profile",
    } satisfies CampuxFormState,
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
    geo: {
      blockNonChina: geo.blockNonChina,
      bypassPaths: geo.bypassPaths.join(", "),
      ipWhitelist: geo.ipWhitelist,
      unknownPolicy: geo.unknownPolicy,
      trustHeader: geo.trustHeader,
    } satisfies GeoFormState,
    entry: {
      entryPath: securityEntry.entryPath ?? "",
    } satisfies EntryFormState,
  };
}

/** 与站点已有路径冲突、不能作为安全入口的名字 */
const RESERVED_ENTRY_NAMES = new Set([
  "api",
  "admin",
  "assets",
  "media",
  "login",
  "logout",
  "auth",
  "me",
  "guide",
  "setup",
  "health",
  "docs",
  "static",
  "favicon",
  "theme-boot",
  "sw",
  "manifest",
]);

/** 把逗号/换行分隔的文本拆成去重后的列表 */
function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function centsToYuanInput(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "0";
  const yuan = cents / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
}

function ConfigForm({ config, readOnly, onSaved }: ConfigFormProps) {
  const feedback = useFeedback();
  const initial = initialState(config);
  const [site, setSite] = useState<SiteFormState>(initial.site);
  const [campux, setCampux] = useState<CampuxFormState>(initial.campux);
  const [mail, setMail] = useState<MailFormState>(initial.mail);
  const [security, setSecurity] = useState<SecurityFormState>(initial.security);
  const [geo, setGeo] = useState<GeoFormState>(initial.geo);
  const [entry, setEntry] = useState<EntryFormState>(initial.entry);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const callbackUrl = `${(site.publicBaseUrl || "").replace(/\/+$/, "")}/api/auth/callback`;
  const entryUrlPreview = `${window.location.origin}${
    entry.entryPath.trim() ? `/${entry.entryPath.trim()}/admin` : "/admin"
  }`;

  async function handleSave() {
    const validation = validate(
      site,
      campux,
      mail,
      config.mail.provider,
      security,
      config.campux.clientSecretConfigured,
      geo,
      entry,
    );
    if (validation.error) {
      setFormError(validation.error);
      feedback.warning(validation.error);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const campuxFilled =
        Boolean(campux.baseUrl.trim()) ||
        Boolean(campux.clientId.trim()) ||
        Boolean(campux.clientSecret);
      const geoChanged = geoChangedFrom(geo, config.geo);
      const siteChanged =
        site.siteName.trim() !== (config.system.siteName ?? "") ||
        site.schoolName.trim() !== (config.system.schoolName ?? "") ||
        site.publicBaseUrl.trim().replace(/\/+$/, "") !==
          (config.system.publicBaseUrl ?? "").replace(/\/+$/, "") ||
        site.icp.trim() !== (config.system.icp ?? "") ||
        Number(site.billRetentionDays) !== (config.system.billRetentionDays ?? 1) ||
        Number(site.paymentProofRetentionDays) !==
          (config.system.paymentProofRetentionDays ?? 15);
      const entryPath = entry.entryPath.trim();
      const entryChanged = entryPath !== (config.securityEntry.entryPath ?? "");
      const input: AdminConfigInput = {
        ...(campuxFilled
          ? {
              campux: {
                baseUrl: campux.baseUrl.trim(),
                clientId: campux.clientId.trim(),
                scope: campux.scope.trim() || "profile",
                ...(campux.clientSecret
                  ? { clientSecret: campux.clientSecret }
                  : {}),
              },
            }
          : {}),
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
        ...(siteChanged
          ? {
              system: {
                siteName: site.siteName.trim(),
                schoolName: site.schoolName.trim(),
                publicBaseUrl: site.publicBaseUrl.trim(),
                icp: site.icp.trim(),
                billRetentionDays: Number(site.billRetentionDays),
                paymentProofRetentionDays: Number(site.paymentProofRetentionDays),
              },
            }
          : {}),
        ...(geoChanged
          ? {
              geo: {
                blockNonChina: geo.blockNonChina,
                bypassPaths: splitList(geo.bypassPaths),
                ipWhitelist: splitList(geo.ipWhitelist).join(","),
                unknownPolicy: geo.unknownPolicy,
                trustHeader: geo.trustHeader.trim(),
              },
            }
          : {}),
        ...(entryChanged ? { securityEntry: { entryPath } } : {}),
      };
      await updateConfig(input);
      feedback.success("系统配置已保存");
      setCampux({ ...campux, clientSecret: "" });
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
        title="站点信息"
        extra={
          site.icp.trim() ? (
            <Badge tone="success" dot>
              已填写备案号
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              未填写备案号
            </Badge>
          )
        }
      >
        <div className="admin-form-grid">
          <Field label="站点名称" required>
            <input
              className="admin-input"
              placeholder="gzspay 校园服务"
              value={site.siteName}
              disabled={readOnly}
              onChange={(event) => setSite({ ...site, siteName: event.target.value })}
            />
          </Field>
          <Field label="校名" hint="留空仅显示「校园服务」">
            <input
              className="admin-input"
              placeholder="例如：某某"
              maxLength={20}
              value={site.schoolName}
              disabled={readOnly}
              onChange={(event) => setSite({ ...site, schoolName: event.target.value })}
            />
          </Field>
          <Field label="站点地址" hint="例如 https://pay.idoknow.top">
            <input
              className="admin-input"
              placeholder="https://pay.idoknow.top"
              value={site.publicBaseUrl}
              disabled={readOnly}
              onChange={(event) =>
                setSite({ ...site, publicBaseUrl: event.target.value })
              }
            />
          </Field>
          <Field label="ICP 备案号" hint="例如 桂ICP备2025000000号-1">
            <input
              className="admin-input"
              placeholder="桂ICP备2025000000号-1"
              value={site.icp}
              disabled={readOnly}
              onChange={(event) => setSite({ ...site, icp: event.target.value })}
            />
          </Field>
          <Field label="账单文件保留天数" hint="1–365 天，默认 1">
            <input
              className="admin-input"
              type="number"
              min={1}
              max={365}
              value={site.billRetentionDays}
              disabled={readOnly}
              onChange={(event) =>
                setSite({ ...site, billRetentionDays: event.target.value })
              }
            />
          </Field>
          <Field label="付款截图保留天数" hint="1–365 天，默认 15">
            <input
              className="admin-input"
              type="number"
              min={1}
              max={365}
              value={site.paymentProofRetentionDays}
              disabled={readOnly}
              onChange={(event) =>
                setSite({ ...site, paymentProofRetentionDays: event.target.value })
              }
            />
          </Field>
        </div>
      </Card>

      <Card
        title="校园墙 OAuth 登录"
        extra={
          config.campux.clientSecretConfigured ? (
            <Badge tone="success" dot>
              已配置 Client Secret
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              未配置 Client Secret
            </Badge>
          )
        }
      >
        <div className="admin-form-grid">
          <Field
            label="校园墙站点地址"
            required
            hint="例如 https://gz.campux.top，末尾不带斜杠"
          >
            <input
              className="admin-input"
              placeholder="https://gz.campux.top"
              value={campux.baseUrl}
              disabled={readOnly}
              onChange={(event) =>
                setCampux({ ...campux, baseUrl: event.target.value })
              }
            />
          </Field>
          <Field label="OAuth Client ID" required>
            <input
              className="admin-input"
              placeholder="校园墙后台创建应用后获得"
              value={campux.clientId}
              disabled={readOnly}
              onChange={(event) =>
                setCampux({ ...campux, clientId: event.target.value })
              }
            />
          </Field>
          <Field
            label="OAuth Client Secret"
            hint={
              config.campux.clientSecretConfigured
                ? "留空表示不修改"
                : "校园墙后台获取"
            }
          >
            <input
              className="admin-input"
              type="password"
              autoComplete="new-password"
              placeholder={
                config.campux.clientSecretConfigured
                  ? "留空保持不变"
                  : "请输入 Client Secret"
              }
              value={campux.clientSecret}
              disabled={readOnly}
              onChange={(event) =>
                setCampux({ ...campux, clientSecret: event.target.value })
              }
            />
          </Field>
          <Field
            label="授权范围（scope）"
            hint="默认 profile，多个用空格分隔"
          >
            <input
              className="admin-input"
              placeholder="profile"
              value={campux.scope}
              disabled={readOnly}
              onChange={(event) =>
                setCampux({ ...campux, scope: event.target.value })
              }
            />
          </Field>
          <Field
            label="回调地址（在校园墙后台登记）"
            className="admin-field-full"
          >
            <input
              className="admin-input"
              value={callbackUrl}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="系统发件邮箱"
        subtitle={
          config.mail.provider === "resend"
            ? "当前使用 Resend 发件"
            : "用于发送验证码与通知邮件"
        }
        extra={
          config.mail.provider === "resend" ? (
            <Badge tone="success" dot>
              Resend 发件
            </Badge>
          ) : config.mail.passwordConfigured ? (
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
        {config.mail.provider === "resend" ? (
          <p className="admin-hint admin-field-full">
            Resend 生效时，下方 SMTP 配置不会使用。
          </p>
        ) : null}
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
                ? "留空表示不修改"
                : "邮箱授权码"
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
          <Field label="启用 SSL/TLS" hint="465 端口开启">
            <Switch
              checked={mail.secure}
              onChange={(next) => setMail({ ...mail, secure: next })}
              label={mail.secure ? "已开启" : "未开启"}
              disabled={readOnly}
            />
          </Field>
        </div>
      </Card>

      <Card title="安全防护设置">
        <div className="admin-form-grid">
          <Field label="支付密码最大错误次数">
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
          <Field label="锁定分钟数">
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
          <Field label="单笔支付上限（元）" hint="0 表示不限制">
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
          <Field label="每日支付上限（元）" hint="0 表示不限制">
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
            hint={`当前 ${formatTtlSeconds(Number(security.dynamicCodeTtl) || 0)}`}
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
            hint={`当前 ${formatTtlSeconds(Number(security.emailCodeTtl) || 0)}`}
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
          <Field label="管理员登录态有效期（天）">
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
      </Card>

      <Card
        title="地区访问限制"
        extra={
          geo.blockNonChina ? (
            <Badge tone="success" dot>
              已开启
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              未开启
            </Badge>
          )
        }
      >
        <div className="admin-form-grid">
          <Field
            label="启用地区限制"
            className="admin-field-full"
            hint="本机、内网与白名单始终放行"
          >
            <Switch
              checked={geo.blockNonChina}
              onChange={(value) => setGeo({ ...geo, blockNonChina: value })}
              label={geo.blockNonChina ? "仅允许中国大陆访问" : "不限制访问地区"}
              disabled={readOnly}
            />
          </Field>
          <Field
            label="例外路径"
            className="admin-field-full"
            hint="逗号分隔，* 结尾为前缀匹配"
          >
            <textarea
              className="admin-input"
              rows={2}
              value={geo.bypassPaths}
              disabled={readOnly}
              onChange={(event) =>
                setGeo({ ...geo, bypassPaths: event.target.value })
              }
            />
          </Field>
          <Field
            label="IP 白名单"
            className="admin-field-full"
            hint="单个 IP 或 CIDR，如 10.0.0.0/8"
          >
            <textarea
              className="admin-input"
              rows={2}
              placeholder="留空表示不设置白名单"
              value={geo.ipWhitelist}
              disabled={readOnly}
              onChange={(event) =>
                setGeo({ ...geo, ipWhitelist: event.target.value })
              }
            />
          </Field>
          <Field label="未知归属处理">
            <select
              className="admin-input"
              value={geo.unknownPolicy}
              disabled={readOnly}
              onChange={(event) =>
                setGeo({
                  ...geo,
                  unknownPolicy: event.target.value === "allow" ? "allow" : "deny",
                })
              }
            >
              <option value="deny">拦截（更严格）</option>
              <option value="allow">放行（更宽松）</option>
            </select>
          </Field>
          <Field
            label="CDN 国家码请求头"
            hint="例如 CF-IPCountry"
          >
            <input
              className="admin-input"
              placeholder="留空则按 IP 数据判断"
              value={geo.trustHeader}
              disabled={readOnly}
              onChange={(event) =>
                setGeo({ ...geo, trustHeader: event.target.value })
              }
            />
          </Field>
          <Field
            label="IP 归属数据"
            hint={`IPv4 ${config.geo.ipv4Count} 段 / IPv6 ${config.geo.ipv6Count} 条`}
          >
            <input
              className="admin-input"
              readOnly
              value={
                config.geo.dataUpdatedAt
                  ? formatDateTime(config.geo.dataUpdatedAt)
                  : "未知"
              }
            />
          </Field>
        </div>
        <InfoBanner tone="warning">
          开启后境外用户将无法访问本站。
        </InfoBanner>
      </Card>

      <Card
        title="管理后台安全入口"
        subtitle="入口改为只有管理员知道的路径"
        extra={
          entry.entryPath.trim() ? (
            <Badge tone="success" dot>
              已启用
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              未启用
            </Badge>
          )
        }
      >
        <div className="admin-form-grid">
          <Field
            label="安全入口名"
            className="admin-field-full"
            hint="4–32 位字母、数字、_ 或 -"
          >
            <input
              className="admin-input"
              placeholder="例如 gzs-secret"
              value={entry.entryPath}
              disabled={readOnly}
              onChange={(event) => setEntry({ entryPath: event.target.value })}
            />
          </Field>
          <Field
            label="当前后台入口"
            className="admin-field-full"
            hint="仅发给管理员，不要外传"
          >
            <input
              className="admin-input"
              readOnly
              value={entryUrlPreview}
              onFocus={(event) => event.target.select()}
            />
          </Field>
        </div>
        {entry.entryPath.trim() ? (
          <InfoBanner tone="info">
            直接打开 /admin 会返回 404，需先访问上面的入口地址。
          </InfoBanner>
        ) : (
          <InfoBanner tone="info">未启用：任何人都能直接打开 /admin。</InfoBanner>
        )}
      </Card>

      <Card title="保存配置">
        {formError ? (
          <div className="admin-inline-alert is-danger" style={{ marginBottom: 14 }}>
            {formError}
          </div>
        ) : null}

        <div className="admin-flex" style={{ gap: 10 }}>
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
              const reset = initialState(config);
              setCampux(reset.campux);
              setMail(reset.mail);
              setSecurity(reset.security);
              setGeo(reset.geo);
              setEntry(reset.entry);
              setFormError(null);
            }}
            disabled={readOnly || submitting}
          >
            还原
          </Button>
          {readOnly ? (
            <span className="admin-text-sm admin-muted">
              仅超级管理员可修改
            </span>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function yuanToCentsOrZero(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const cents = parseYuanToCents(trimmed);
  return cents === null ? 0 : cents;
}

/** 地区限制是否被改动过（避免把环境变量默认值固化进库） */
function geoChangedFrom(geo: GeoFormState, saved: AdminConfig["geo"]): boolean {
  return (
    geo.blockNonChina !== saved.blockNonChina ||
    geo.unknownPolicy !== saved.unknownPolicy ||
    splitList(geo.bypassPaths).join(",") !== saved.bypassPaths.join(",") ||
    splitList(geo.ipWhitelist).join(",") !== saved.ipWhitelist ||
    geo.trustHeader.trim() !== saved.trustHeader
  );
}

function validate(
  site: SiteFormState,
  campux: CampuxFormState,
  mail: MailFormState,
  mailProvider: "resend" | "smtp" | "none",
  security: SecurityFormState,
  secretConfigured: boolean,
  geo: GeoFormState,
  entry: EntryFormState,
): { error?: string } {
  if (!site.siteName.trim()) return { error: "请填写站点名称。" };
  if (site.siteName.trim().length > 80) return { error: "站点名称不能超过 80 个字符。" };
  const siteUrl = site.publicBaseUrl.trim().replace(/\/+$/, "");
  if (siteUrl && !/^https?:\/\/[^\s]+$/i.test(siteUrl)) {
    return { error: "站点地址必须以 http:// 或 https:// 开头。" };
  }
  if (site.icp.trim().length > 60) return { error: "备案号不能超过 60 个字符。" };
  const billRetention = Number(site.billRetentionDays);
  if (!Number.isInteger(billRetention) || billRetention < 1 || billRetention > 365) {
    return { error: "账单文件保留天数需为 1–365 的整数。" };
  }
  const proofRetention = Number(site.paymentProofRetentionDays);
  if (!Number.isInteger(proofRetention) || proofRetention < 1 || proofRetention > 365) {
    return { error: "付款截图保留天数需为 1–365 的整数。" };
  }

  const baseUrl = campux.baseUrl.trim();
  const clientId = campux.clientId.trim();
  const campuxTouched = Boolean(baseUrl) || Boolean(clientId) || Boolean(campux.clientSecret);
  if (campuxTouched) {
    if (!baseUrl) return { error: "请填写校园墙站点地址。" };
    if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
      return { error: "校园墙站点地址必须以 http:// 或 https:// 开头。" };
    }
    if (!clientId) return { error: "请填写 OAuth Client ID。" };
    if (!secretConfigured && !campux.clientSecret) {
      return { error: "请填写 OAuth Client Secret。" };
    }
  }

  // Resend 发件时 SMTP 配置不生效，不再强制校验 SMTP 字段
  if (mailProvider !== "resend") {
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

  if (geo.blockNonChina) {
    const invalidPath = splitList(geo.bypassPaths).find(
      (item) => !item.startsWith("/"),
    );
    if (invalidPath) {
      return { error: `例外路径需以 / 开头：${invalidPath}` };
    }
  }
  const invalidIp = splitList(geo.ipWhitelist).find(
    (item) => !/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(item),
  );
  if (invalidIp) {
    return { error: `IP 白名单格式不正确：${invalidIp}` };
  }

  const entryPath = entry.entryPath.trim();
  if (entryPath) {
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(entryPath)) {
      return { error: "安全入口需为 4–32 位字母、数字、下划线或短横线。" };
    }
    if (RESERVED_ENTRY_NAMES.has(entryPath.toLowerCase())) {
      return { error: "该入口名与站点已有路径冲突，请换一个。" };
    }
  }

  return {};
}
