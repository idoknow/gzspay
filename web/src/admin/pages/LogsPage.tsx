/**
 * 日志查看：操作日志 / 登录日志 / 风控日志 / 系统错误 四个页签，支持筛选、分页与导出。
 * 日志为审计留痕数据，只读，不可修改或删除。
 */
import { useState } from "react";
import { exportLogs, getLogs } from "../api";
import { useFeedback } from "../components/dialogs";
import {
  Badge,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  InfoBanner,
  KVGrid,
  PageHeader,
  Pagination,
  TableSkeleton,
  Tabs,
} from "../components/ui";
import type { TabItem } from "../components/ui";
import {
  formatDateTime,
  fromDateInputEnd,
  fromDateInputStart,
  logLevelMeta,
  logTypeLabel,
} from "../format";
import { useAsync } from "../hooks";
import { errorMessage } from "../../lib/http";
import type { AdminLog, LogFilters, LogType } from "../types";

type LogTabKey = LogType;

const TABS: TabItem<LogTabKey>[] = [
  { key: "audit", label: "操作日志" },
  { key: "login", label: "登录日志" },
  { key: "risk", label: "风控日志" },
  { key: "error", label: "系统错误" },
];

const TAB_DESCRIPTIONS: Record<LogTabKey, string> = {
  audit: "管理员在后台执行的关键写操作留痕，用于追溯与审计。",
  login: "管理员登录、退出与权限变更的记录，可用于排查异常登录。",
  risk: "支付风控规则命中记录，包括金额超限、密码错误、异常设备等。",
  error: "服务端异常与接口错误堆栈摘要，便于定位系统故障。",
};

interface LogFilterState {
  fromDate: string;
  toDate: string;
  keyword: string;
}

const EMPTY_FILTERS: LogFilterState = { fromDate: "", toDate: "", keyword: "" };

function toLogFilters(state: LogFilterState): LogFilters {
  return {
    from: state.fromDate ? fromDateInputStart(state.fromDate) : undefined,
    to: state.toDate ? fromDateInputEnd(state.toDate) : undefined,
    query: state.keyword.trim() || undefined,
  };
}

export function LogsPage() {
  const feedback = useFeedback();
  const [activeTab, setActiveTab] = useState<LogTabKey>("audit");
  const [draft, setDraft] = useState<LogFilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<LogFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState<AdminLog | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data, loading, error, refresh } = useAsync(
    () => getLogs(activeTab, toLogFilters(applied), page, pageSize),
    [activeTab, applied, page, pageSize],
  );

  function changeTab(key: LogTabKey) {
    setActiveTab(key);
    setPage(1);
  }

  function handleSearch() {
    setApplied(draft);
    setPage(1);
  }

  function handleReset() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportLogs(activeTab, toLogFilters(applied));
      feedback.success(`${logTypeLabel(activeTab)}已开始导出`);
    } catch (err) {
      feedback.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const rows = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="日志查看"
        description="审计、登录、风控与系统错误日志，仅供追溯排查，不可修改或删除。"
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

      <Tabs items={TABS} active={activeTab} onChange={changeTab} />

      <InfoBanner tone="info">
        {TAB_DESCRIPTIONS[activeTab]} 日志数据由系统自动写入，后台仅支持查询与导出，任何管理员都无法修改或删除。
      </InfoBanner>

      <div className="admin-card">
        <div className="admin-toolbar">
          <Field label="开始日期">
            <input
              type="date"
              className="admin-input admin-input-sm"
              value={draft.fromDate}
              onChange={(event) =>
                setDraft({ ...draft, fromDate: event.target.value })
              }
            />
          </Field>
          <Field label="结束日期">
            <input
              type="date"
              className="admin-input admin-input-sm"
              value={draft.toDate}
              onChange={(event) => setDraft({ ...draft, toDate: event.target.value })}
            />
          </Field>
          <Field label="关键词" className="admin-toolbar-grow">
            <input
              className="admin-input admin-input-sm"
              placeholder="操作、对象、IP、错误信息等"
              value={draft.keyword}
              onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSearch();
              }}
            />
          </Field>
          <div className="admin-flex">
            <button
              type="button"
              className="admin-btn admin-btn-primary admin-btn-sm"
              onClick={handleSearch}
            >
              查询
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-ghost admin-btn-sm"
              onClick={handleReset}
            >
              重置
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-accent admin-btn-sm"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? "正在导出…" : "导出 CSV"}
            </button>
          </div>
        </div>

        {error && !data ? (
          <div style={{ padding: 20 }}>
            <ErrorState message={errorMessage(error)} onRetry={() => refresh()} />
          </div>
        ) : loading && !data ? (
          <TableSkeleton rows={8} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="暂无日志"
            description="当前筛选条件下没有日志记录，可尝试调整时间范围或关键词。"
            action={
              <button
                type="button"
                className="admin-btn admin-btn-ghost admin-btn-sm"
                onClick={handleReset}
              >
                清空筛选
              </button>
            }
          />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>操作 / 事件</th>
                  <th>对象</th>
                  <th>结果 / 级别</th>
                  <th>IP</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr key={log.id}>
                    <td className="admin-text-sm admin-mono">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="admin-text-sm">{log.actorName || "—"}</td>
                    <td>
                      <div className="admin-cell-primary">{log.action || log.type}</div>
                      <div className="admin-text-xs admin-muted">
                        {logTypeLabel(log.type)}
                      </div>
                    </td>
                    <td className="admin-text-sm">{log.target || "—"}</td>
                    <td>
                      <LogResultCell log={log} />
                    </td>
                    <td className="admin-text-sm admin-mono">{log.ip || "—"}</td>
                    <td>
                      <div className="admin-flex" style={{ gap: 8 }}>
                        <span className="admin-text-sm admin-muted admin-clamp-2">
                          {log.detail || log.message || "—"}
                        </span>
                        <button
                          type="button"
                          className="admin-btn admin-btn-link admin-btn-sm"
                          onClick={() => setDetail(log)}
                        >
                          查看
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: "0 20px" }}>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            disabled={loading}
          />
        </div>
      </div>

      {detail ? (
        <Drawer
          title="日志详情"
          subtitle={`${logTypeLabel(detail.type)} · ${formatDateTime(detail.createdAt)}`}
          onClose={() => setDetail(null)}
        >
          <KVGrid
            items={[
              { label: "日志 ID", value: detail.id, mono: true },
              { label: "日志类型", value: logTypeLabel(detail.type) },
              { label: "时间", value: formatDateTime(detail.createdAt) },
              { label: "操作人", value: detail.actorName || "—" },
              { label: "操作 / 事件", value: detail.action || "—" },
              { label: "对象", value: detail.target || "—" },
              { label: "结果", value: detail.result || "—" },
              { label: "级别", value: detail.level || "—" },
              { label: "IP 地址", value: detail.ip || "—", mono: true },
              { label: "User-Agent", value: detail.userAgent || "—" },
            ]}
          />
          <div className="admin-section-title" style={{ marginTop: 18 }}>
            详细内容
          </div>
          <p className="admin-text-sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
            {detail.detail || detail.message || "无更多信息"}
          </p>
          <p className="admin-readonly-hint" style={{ marginTop: 16 }}>
            日志为审计留痕数据，不可修改或删除。
          </p>
        </Drawer>
      ) : null}
    </>
  );
}

function LogResultCell({ log }: { log: AdminLog }) {
  if (log.level) {
    const meta = logLevelMeta(log.level);
    return <Badge tone={meta.tone}>{meta.label}</Badge>;
  }
  if (!log.result) return <span className="admin-text-sm admin-muted">—</span>;
  const normalized = log.result.toLowerCase();
  const tone =
    normalized === "success" || normalized === "ok" || normalized === "成功"
      ? "success"
      : normalized === "failed" ||
          normalized === "failure" ||
          normalized === "error" ||
          normalized === "失败"
        ? "danger"
        : "neutral";
  return <Badge tone={tone}>{log.result}</Badge>;
}
