/**
 * 系统状态：服务可用性、接口耗时与错误率、邮件成功率、校园墙连通性、存储与队列指标。
 */
import { getAdminEntryVisits, getSystemStatus } from "../api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressBar,
  SectionTitle,
  SkeletonCards,
  StatCard,
  TableSkeleton,
} from "../components/ui";
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatPercent,
  serviceHealthLabel,
  serviceHealthTone,
} from "../format";
import { useAsync, usePolling } from "../hooks";
import { errorMessage } from "../../lib/http";
import type {
  AdminEntryVisitsPayload,
  ServiceStatus,
  SystemStatus,
} from "../types";

export function SystemPage() {
  const { data, loading, error, refresh } = useAsync<SystemStatus>(
    () => getSystemStatus(),
    [],
  );

  // 30 秒自动刷新一次；页面隐藏时跳过
  usePolling(() => {
    refresh();
  }, 30_000);

  const services = data?.services ?? [];
  const downCount = services.filter((service) => service.status === "down").length;
  const degradedCount = services.filter(
    (service) => service.status === "degraded",
  ).length;
  const abnormalCount = downCount + degradedCount;

  return (
    <>
      <PageHeader
        title="系统状态"
        description="服务可用性、接口性能与资源占用。"
        actions={
          <button
            type="button"
            className="admin-btn admin-btn-subtle admin-btn-sm"
            onClick={() => refresh()}
            disabled={loading}
          >
            立即刷新
          </button>
        }
      />

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refresh()} />
      ) : loading && !data ? (
        <>
          <SkeletonCards count={4} />
          <div className="admin-card" style={{ marginTop: 18 }}>
            <TableSkeleton rows={5} cols={4} />
          </div>
        </>
      ) : data ? (
        <div className="admin-stack">
          {(data.alerts ?? []).length > 0 ? (
            <div className="admin-alerts">
              {data.alerts.map((alert) => (
                <div key={alert.id} className="admin-alert-item">
                  <Badge tone={alert.level === "danger" ? "danger" : "warning"} dot>
                    {alert.level === "danger" ? "严重" : "告警"}
                  </Badge>
                  <span>{alert.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="admin-inline-alert is-info">
              当前没有系统告警。
            </div>
          )}

          <div className="admin-stat-grid">
            <StatCard
              label="异常服务"
              value={`${abnormalCount} / ${services.length}`}
              hint={
                abnormalCount > 0
                  ? `${downCount} 个不可用，${degradedCount} 个降级`
                  : "所有服务运行正常"
              }
              tone={abnormalCount > 0 ? "accent" : "success"}
            />
            <StatCard
              label="邮件发送成功率"
              value={formatPercent(data.mail.successRate)}
              hint={`成功 ${formatNumber(data.mail.sent)} / 失败 ${formatNumber(
                data.mail.failed,
              )}`}
              tone={data.mail.successRate >= 95 ? "success" : "accent"}
            />
            <StatCard
              label="校园墙授权连通性"
              value={data.campux.ok ? "连通" : "异常"}
              hint={`探测耗时 ${formatNumber(data.campux.latencyMs)} ms`}
              tone={data.campux.ok ? "success" : "accent"}
            />
            <StatCard
              label="磁盘使用率"
              value={formatPercent(data.storage.diskUsedPercent)}
              hint={`数据库 ${formatBytes(data.storage.dbSizeBytes)} · 上传 ${
                formatBytes(data.storage.uploadsSizeBytes)
              }`}
              tone={(data.storage.diskUsedPercent ?? 0) >= 85 ? "accent" : "primary"}
            />
          </div>

          <Card
            title="服务可用性"
            subtitle="可用状态、平均耗时与错误率"
            extra={
              <span className="admin-text-sm admin-muted">
                更新于 {formatDateTime(data.updatedAt)}
              </span>
            }
          >
            {services.length === 0 ? (
              <EmptyState title="暂无服务指标" />
            ) : (
              <div className="admin-service-grid">
                {services.map((service) => (
                  <ServiceCard
                    key={service.name}
                    service={service}
                  />
                ))}
              </div>
            )}
          </Card>

          <div className="admin-grid-2">
            <Card title="邮件服务">
              <div className="admin-stack">
                <div className="admin-flex" style={{ justifyContent: "space-between" }}>
                  <span className="admin-text-sm admin-muted">发送成功率</span>
                  <span className="admin-strong">
                    {formatPercent(data.mail.successRate)}
                  </span>
                </div>
                <ProgressBar
                  percent={data.mail.successRate}
                  tone={
                    data.mail.successRate >= 95
                      ? "success"
                      : data.mail.successRate >= 80
                        ? "warning"
                        : "danger"
                  }
                />
                <div className="admin-kv-grid">
                  <div className="admin-kv">
                    <span className="admin-kv-label">发送成功</span>
                    <span className="admin-kv-value">
                      {formatNumber(data.mail.sent)} 封
                    </span>
                  </div>
                  <div className="admin-kv">
                    <span className="admin-kv-label">发送失败</span>
                    <span
                      className={
                        data.mail.failed > 0
                          ? "admin-kv-value admin-text-danger"
                          : "admin-kv-value"
                      }
                    >
                      {formatNumber(data.mail.failed)} 封
                    </span>
                  </div>
                </div>
                <p className="admin-readonly-hint">
                  成功率持续偏低时，请检查「系统配置」中的 SMTP 参数。
                </p>
              </div>
            </Card>

            <Card title="校园墙授权连通性" subtitle="登录依赖校园墙授权">
              <div className="admin-stack">
                <div className="admin-flex" style={{ gap: 8 }}>
                  {data.campux.ok ? (
                    <Badge tone="success" dot>
                      连通正常
                    </Badge>
                  ) : (
                    <Badge tone="danger" dot>
                      连接异常
                    </Badge>
                  )}
                  <span className="admin-text-sm admin-muted">
                    探测耗时 {formatNumber(data.campux.latencyMs)} ms
                  </span>
                </div>
                {data.campux.message ? (
                  <div className="admin-inline-alert is-warning">
                    {data.campux.message}
                  </div>
                ) : (
                  <p className="admin-text-sm admin-muted">
                    授权正常，可用校园墙账号登录。
                  </p>
                )}
              </div>
            </Card>
          </div>

          <div className="admin-grid-2">
            <Card title="存储" subtitle="数据库与上传占用">
              <div className="admin-stack">
                <div className="admin-kv-grid">
                  <div className="admin-kv">
                    <span className="admin-kv-label">数据库占用</span>
                    <span className="admin-kv-value">
                      {formatBytes(data.storage.dbSizeBytes)}
                    </span>
                  </div>
                  <div className="admin-kv">
                    <span className="admin-kv-label">上传文件占用</span>
                    <span className="admin-kv-value">
                      {formatBytes(data.storage.uploadsSizeBytes)}
                    </span>
                  </div>
                </div>
                <div className="admin-flex" style={{ justifyContent: "space-between" }}>
                  <span className="admin-text-sm admin-muted">磁盘使用率</span>
                  <span className="admin-strong">
                    {formatPercent(data.storage.diskUsedPercent)}
                  </span>
                </div>
                <ProgressBar
                  percent={data.storage.diskUsedPercent ?? 0}
                  tone={
                    (data.storage.diskUsedPercent ?? 0) >= 90
                      ? "danger"
                      : (data.storage.diskUsedPercent ?? 0) >= 80
                        ? "warning"
                        : "primary"
                  }
                />
                {(data.storage.diskUsedPercent ?? 0) >= 80 ? (
                  <div className="admin-inline-alert is-warning">
                    磁盘使用率偏高，请清理或扩容。
                  </div>
                ) : null}
              </div>
            </Card>

            <Card title="队列">
              <div className="admin-kv-grid">
                <div className="admin-kv">
                  <span className="admin-kv-label">等待处理</span>
                  <span className="admin-kv-value">
                    {formatNumber(data.queue.pending)}
                  </span>
                </div>
                <div className="admin-kv">
                  <span className="admin-kv-label">处理失败</span>
                  <span
                    className={
                      data.queue.failed > 0
                        ? "admin-kv-value admin-text-danger"
                        : "admin-kv-value"
                    }
                  >
                    {formatNumber(data.queue.failed)}
                  </span>
                </div>
                <div className="admin-kv">
                  <span className="admin-kv-label">累计处理</span>
                  <span className="admin-kv-value">
                    {formatNumber(data.queue.processed)}
                  </span>
                </div>
              </div>
              {data.queue.failed > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div className="admin-inline-alert is-danger">
                    有 {formatNumber(data.queue.failed)} 个失败任务，请查看系统错误日志。
                  </div>
                </div>
              ) : null}
            </Card>
          </div>

          <Card
            title="严重错误告警"
            subtitle="严重错误会主动推送给管理员"
            extra={
              <Badge
                tone={
                  data.alerting.webhookConfigured || data.alerting.emailEnabled
                    ? "success"
                    : "warning"
                }
                dot
              >
                {data.alerting.webhookConfigured || data.alerting.emailEnabled
                  ? "告警已启用"
                  : "尚未配置告警"}
              </Badge>
            }
          >
            <div className="admin-stack">
              <div className="admin-flex" style={{ gap: 8, flexWrap: "wrap" }}>
                <Badge tone={data.alerting.webhookConfigured ? "success" : "neutral"}>
                  Webhook {data.alerting.webhookConfigured ? "已配置" : "未配置"}
                </Badge>
                <Badge tone={data.alerting.emailEnabled ? "success" : "neutral"}>
                  邮件通知 {data.alerting.emailEnabled ? "已开启" : "未开启"}
                </Badge>
                <span className="admin-text-sm admin-muted">
                  收件管理员 {formatNumber(data.alerting.recipients)} 位
                </span>
              </div>
              <div className="admin-kv-grid">
                <div className="admin-kv">
                  <span className="admin-kv-label">最近一次主动告警</span>
                  <span className="admin-kv-value">
                    {data.alerting.lastAlertAt
                      ? formatDateTime(data.alerting.lastAlertAt)
                      : "尚未触发"}
                  </span>
                </div>
                <div className="admin-kv">
                  <span className="admin-kv-label">最近一小时告警</span>
                  <span className="admin-kv-value">
                    {formatNumber(data.alerting.dispatchedLastHour)} 次
                  </span>
                </div>
              </div>
              <p className="admin-readonly-hint">
                同一类错误短时间内只告警一次。
              </p>
              {!data.alerting.webhookConfigured && !data.alerting.emailEnabled ? (
                <div className="admin-inline-alert is-warning">
                  当前没有告警通道：请配置 SMTP 并给管理员绑定邮箱。
                </div>
              ) : null}
            </div>
          </Card>

          <AdminEntryVisitsCard />
        </div>
      ) : (
        <EmptyState title="暂无系统状态" />
      )}
    </>
  );
}

/** 未通过安全入口直接访问后台的尝试记录 */
function AdminEntryVisitsCard() {
  const visits = useAsync<AdminEntryVisitsPayload>(
    () => getAdminEntryVisits(10),
    [],
  );
  const items = visits.data?.items ?? [];
  const total = visits.data?.total ?? 0;
  return (
    <Card
      title="后台入口访问尝试"
      subtitle="绕过入口直接访问 /admin 会被记录，并返回 404"
      extra={
        <div className="admin-flex" style={{ gap: 8, alignItems: "center" }}>
          <Badge tone={total > 0 ? "warning" : "neutral"} dot>
            {formatNumber(total)} 条记录
          </Badge>
          <Button
            size="sm"
            variant="subtle"
            onClick={() => visits.refresh()}
            disabled={visits.loading}
          >
            刷新
          </Button>
        </div>
      }
    >
      {visits.error && !visits.data ? (
        <ErrorState
          message={errorMessage(visits.error)}
          onRetry={() => visits.refresh()}
        />
      ) : visits.loading && !visits.data ? (
        <TableSkeleton rows={4} cols={5} />
      ) : items.length === 0 ? (
        <EmptyState
          title="暂无访问记录"
        />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>来源 IP</th>
                <th>请求</th>
                <th>设备</th>
                <th>来源页面</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="admin-text-sm admin-muted">
                    {formatDateTime(item.createdAt)}
                  </td>
                  <td className="admin-mono">{item.ip ?? "未知"}</td>
                  <td className="admin-cell-primary">
                    <span className="admin-cell-sub admin-text-xs">
                      {item.method} {item.path}
                      {item.query ? `?${item.query}` : ""}
                    </span>
                  </td>
                  <td
                    className="admin-text-sm admin-muted"
                    title={item.userAgent ?? ""}
                  >
                    {shortAgent(item.userAgent)}
                  </td>
                  <td
                    className="admin-text-sm admin-muted"
                    title={item.referer ?? ""}
                  >
                    {item.referer ? shortAgent(item.referer) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** 截断过长的 UA / 来源地址，完整内容放在 title 里 */
function shortAgent(value: string | null): string {
  if (!value) return "未知设备";
  const trimmed = value.trim();
  return trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed;
}

function ServiceCard({ service }: { service: ServiceStatus }) {
  const tone = serviceHealthTone(service.status);
  const isAbnormal = service.status === "down" || service.status === "degraded";
  return (
    <div
      className={`admin-service-card${
        service.status === "down"
          ? " is-down"
          : service.status === "degraded"
            ? " is-degraded"
            : ""
      }`}
    >
      <div className="admin-service-head">
        <span className="admin-strong">{service.name}</span>
        <Badge tone={tone} dot>
          {serviceHealthLabel(service.status)}
        </Badge>
      </div>
      <div className="admin-metrics">
        <div className="admin-metric-row">
          <span className="admin-text-sm admin-muted">接口耗时</span>
          <span className={isAbnormal ? "admin-metric-value admin-text-danger" : "admin-metric-value"}>
            {formatNumber(service.latencyMs)} ms
          </span>
        </div>
        <div className="admin-metric-row">
          <span className="admin-text-sm admin-muted">错误率</span>
          <span
            className={
              (service.errorRate ?? 0) >= 5
                ? "admin-metric-value admin-text-danger"
                : "admin-metric-value"
            }
          >
            {formatPercent(service.errorRate)}
          </span>
        </div>
        <div className="admin-metric-row">
          <span className="admin-text-sm admin-muted">可用率</span>
          <span className="admin-metric-value">{formatPercent(service.uptime)}</span>
        </div>
      </div>
    </div>
  );
}
