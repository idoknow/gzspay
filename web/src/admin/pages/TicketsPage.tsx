/**
 * 交易工单（后台只读）：仅用于了解交易双方的沟通与争议情况。
 * 按产品决定，管理员不参与对话、不关闭工单、不修改任何内容，页面不提供任何写操作。
 */
import { useState } from "react";
import { getAdminTicket, getAdminTickets } from "../api";
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Pagination, PageHeader, TableSkeleton, Tabs } from "../components/ui";
import { formatCents, formatDateTime, formatRelative } from "../format";
import { useAsync, useDebounced } from "../hooks";
import type { AdminTicket, AdminTicketClosedReason, AdminTicketDetail, AdminTicketStatus } from "../types";

type StatusTab = AdminTicketStatus | "all";

const STATUS_TABS: Array<{ key: StatusTab; label: string }> = [
  { key: "open", label: "进行中" },
  { key: "closed", label: "已结束" },
  { key: "all", label: "全部" },
];

const CLOSED_REASON_TEXT: Record<AdminTicketClosedReason, string> = {
  user: "双方处理后手动结束",
  timeout: "超过 7 天没有新消息，系统自动结束",
  admin: "管理员结束",
};

function statusBadge(status: AdminTicketStatus) {
  return status === "open" ? <Badge tone="primary">进行中</Badge> : <Badge tone="neutral">已结束</Badge>;
}

export function AdminTicketsPage() {
  const [tab, setTab] = useState<StatusTab>("open");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailId, setDetailId] = useState<string | null>(null);
  const debouncedKeyword = useDebounced(keywordDraft, 300);

  const tickets = useAsync(
    () => getAdminTickets({ status: tab, keyword: debouncedKeyword }, page, pageSize),
    [tab, debouncedKeyword, page, pageSize],
  );

  const rows = tickets.data?.items ?? [];
  const total = tickets.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title="交易工单"
        description="交易双方在订单内发起的沟通记录。后台仅供查看，管理员不参与对话、不修改内容。"
      />

      <Tabs
        items={STATUS_TABS.map((item) => ({ key: item.key, label: item.label }))}
        active={tab}
        onChange={(key) => {
          setTab(key);
          setPage(1);
        }}
      />

      <Card>
        <div className="admin-flex admin-flex-wrap" style={{ gap: 8, marginBottom: 14 }}>
          <input
            className="admin-input"
            style={{ maxWidth: 280 }}
            placeholder="搜索订单号、标题或用户姓名"
            value={keywordDraft}
            onChange={(event) => {
              setKeywordDraft(event.target.value);
              setKeyword(event.target.value);
              setPage(1);
            }}
          />
          <span className="admin-spacer" />
          <Button variant="ghost" onClick={() => tickets.refresh()}>
            刷新
          </Button>
        </div>

        {tickets.loading && !tickets.data ? <TableSkeleton rows={6} cols={5} /> : null}
        {tickets.error ? <ErrorState message={tickets.error} onRetry={() => tickets.reload()} /> : null}

        {!tickets.error && rows.length === 0 && !tickets.loading ? (
          <EmptyState
            title={tab === "open" ? "暂无进行中的工单" : tab === "closed" ? "暂无已结束的工单" : "暂无交易工单"}
            description="工单只会在「已支付」或「已完成」的订单里产生。"
          />
        ) : null}

        {rows.length > 0 ? (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>订单</th>
                    <th>分类</th>
                    <th className="admin-num">金额</th>
                    <th>发起人</th>
                    <th>双方</th>
                    <th>消息</th>
                    <th>最后消息</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((ticket) => (
                    <tr key={ticket.id} onClick={() => setDetailId(ticket.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{ticket.orderTitle}</div>
                        <div className="admin-muted admin-mono" style={{ fontSize: 12 }}>
                          {ticket.orderNo}
                        </div>
                      </td>
                      <td>{ticket.categoryLabel}</td>
                      <td className="admin-num">{formatCents(ticket.amountCents)}</td>
                      <td>{ticket.openerName}</td>
                      <td className="admin-muted" style={{ fontSize: 12 }}>
                        付款人 {ticket.payerName} · 商家 {ticket.merchantName}
                      </td>
                      <td className="admin-num">{ticket.messageCount}</td>
                      <td title={formatDateTime(ticket.lastMessageAt)}>{formatRelative(ticket.lastMessageAt)}</td>
                      <td>{statusBadge(ticket.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={tickets.data?.page ?? page}
              pageSize={tickets.data?.pageSize ?? pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              disabled={tickets.loading}
            />
          </>
        ) : null}
      </Card>

      {detailId ? <TicketDetailDrawer ticketId={detailId} onClose={() => setDetailId(null)} /> : null}
    </>
  );
}

function TicketDetailDrawer({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const detail = useAsync(() => getAdminTicket(ticketId), [ticketId]);

  return (
    <Drawer
      title="工单详情"
      subtitle={detail.data ? `${detail.data.orderTitle} · ${detail.data.orderNo}` : ticketId}
      onClose={onClose}
      footer={
        <div className="admin-flex" style={{ gap: 8 }}>
          <span className="admin-muted" style={{ fontSize: 12 }}>
            后台只读，如需处理请让双方继续在工单里沟通或自行结束。
          </span>
          <span className="admin-spacer" />
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      {detail.loading && !detail.data ? <TableSkeleton rows={4} cols={2} /> : null}
      {detail.error ? <ErrorState message={detail.error} onRetry={() => detail.reload()} /> : null}
      {detail.data ? <TicketDetailBody ticket={detail.data} /> : null}
    </Drawer>
  );
}

function TicketDetailBody({ ticket }: { ticket: AdminTicketDetail }) {
  return (
    <div className="admin-stack">
      <div className="admin-flex admin-flex-wrap" style={{ gap: 8, alignItems: "center" }}>
        {statusBadge(ticket.status)}
        <Badge tone="neutral">{ticket.categoryLabel}</Badge>
        <span className="admin-muted">{formatCents(ticket.amountCents)}</span>
        <span className="admin-spacer" />
        <span className="admin-muted" style={{ fontSize: 12 }}>
          发起于 {formatDateTime(ticket.createdAt)}
        </span>
      </div>

      <div className="admin-kv-grid">
        <span className="admin-muted">订单号</span>
        <span className="admin-mono">{ticket.orderNo}</span>
        <span className="admin-muted">订单内容</span>
        <span>{ticket.orderTitle}</span>
        <span className="admin-muted">发起人</span>
        <span>{ticket.openerName}</span>
        <span className="admin-muted">付款人</span>
        <span>{ticket.payerName}</span>
        <span className="admin-muted">商家</span>
        <span>{ticket.merchantName}</span>
        <span className="admin-muted">消息数</span>
        <span>{ticket.messageCount}</span>
      </div>

      {ticket.status === "closed" ? (
        <div className="admin-muted" style={{ fontSize: 12 }}>
          结束时间 {formatDateTime(ticket.closedAt)}
          {ticket.closedReason ? ` · ${CLOSED_REASON_TEXT[ticket.closedReason]}` : ""}
          {ticket.resolutionNote ? ` · 备注：${ticket.resolutionNote}` : ""}
        </div>
      ) : null}

      <div className="admin-stack" style={{ gap: 12 }}>
        {ticket.messages.map((message) => (
          <div key={message.id} className="admin-stack" style={{ gap: 4 }}>
            <div className="admin-flex" style={{ gap: 8, alignItems: "baseline" }}>
              <strong style={{ fontSize: 13 }}>{message.senderName}</strong>
              <span className="admin-muted" style={{ fontSize: 12 }}>
                {message.senderRole === "merchant" ? "商家" : message.senderRole === "payer" ? "付款人" : "管理员"} ·{" "}
                {formatDateTime(message.createdAt)}
              </span>
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "var(--admin-bg-subtle, rgba(127,127,127,.08))",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 13,
                lineHeight: 1.65,
              }}
            >
              {message.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 供列表页判断是否可点的辅助类型（保持导出，避免未使用告警） */
export type { AdminTicket };
