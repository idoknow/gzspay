/**
 * 交易工单：查看订单双方的沟通记录与双方资料。
 * 运营（super / ops）可以「平台客服」身份介入沟通、结束工单；审计员只读。
 */
import { useState } from "react";
import { closeAdminTicket, getAdminTicket, getAdminTickets, sendAdminTicketMessage } from "../api";
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Pagination, PageHeader, TableSkeleton, Tabs } from "../components/ui";
import { useFeedback } from "../components/dialogs";
import { useAdmin } from "../context";
import { formatCents, formatDateTime, formatRelative } from "../format";
import { useAsync, useDebounced } from "../hooks";
import type {
  AdminTicket,
  AdminTicketClosedReason,
  AdminTicketDetail,
  AdminTicketMessage,
  AdminTicketParty,
  AdminTicketStatus,
} from "../types";

type StatusTab = AdminTicketStatus | "all";

const STATUS_TABS: Array<{ key: StatusTab; label: string }> = [
  { key: "open", label: "进行中" },
  { key: "closed", label: "已结束" },
  { key: "all", label: "全部" },
];

const CLOSED_REASON_TEXT: Record<AdminTicketClosedReason, string> = {
  user: "双方处理后手动结束",
  timeout: "超过 7 天没有新消息，系统自动结束",
  admin: "平台客服结束",
};

function statusBadge(status: AdminTicketStatus) {
  return status === "open" ? <Badge tone="primary">进行中</Badge> : <Badge tone="neutral">已结束</Badge>;
}

/** 平台客服头像：站点 logo */
function PlatformLogo({ size = 30 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--admin-bg-subtle, rgba(127,127,127,.1))",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        overflow: "hidden",
      }}
    >
      <img src="/logo.svg" alt="" style={{ width: "68%", height: "68%", objectFit: "contain" }} />
    </span>
  );
}

function PersonAvatar({
  name,
  avatarUrl,
  size = 30,
}: {
  name: string;
  avatarUrl: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flex: "none" }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--admin-bg-subtle, rgba(127,127,127,.1))",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        color: "var(--admin-text-muted, #667)",
        flex: "none",
      }}
    >
      {name.trim().slice(0, 1) || "?"}
    </span>
  );
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
        description="交易双方在订单内发起的沟通记录。运营可以「平台客服」身份介入沟通或结束工单，审计员只读。"
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

      {detailId ? (
        <TicketDetailDrawer
          ticketId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            tickets.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function TicketDetailDrawer({
  ticketId,
  onClose,
  onChanged,
}: {
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useAsync(() => getAdminTicket(ticketId), [ticketId]);
  const { canWrite } = useAdmin();
  const feedback = useFeedback();

  const ticket = detail.data;
  const canReply = Boolean(canWrite && ticket && ticket.status === "open");

  const handleChanged = () => {
    detail.reload();
    onChanged();
  };

  return (
    <Drawer
      title="工单详情"
      subtitle={ticket ? `${ticket.orderTitle} · ${ticket.orderNo}` : ticketId}
      onClose={onClose}
      footer={
        <div className="admin-flex" style={{ gap: 8 }}>
          <span className="admin-muted" style={{ fontSize: 12 }}>
            {canWrite ? "运营可介入沟通或结束工单；结束会通知双方。" : "当前账号为只读，不能发言或结束工单。"}
          </span>
          <span className="admin-spacer" />
          {canReply ? (
            <Button
              variant="danger"
              onClick={async () => {
                const note = await feedback.prompt({
                  title: "结束工单",
                  description: "结束前可以填写处理说明（双方都能看到），不填也可以。",
                  label: "处理说明（可选）",
                  placeholder: "例如：双方已协商一致，工单关闭",
                  multiline: true,
                  confirmText: "结束工单",
                  danger: true,
                });
                if (note === null) return;
                try {
                  await closeAdminTicket(ticketId, note);
                  handleChanged();
                  feedback.success("工单已结束");
                } catch (error) {
                  feedback.error(error instanceof Error ? error.message : "结束工单失败");
                }
              }}
            >
              结束工单
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      {detail.loading && !ticket ? <TableSkeleton rows={4} cols={2} /> : null}
      {detail.error ? <ErrorState message={detail.error} onRetry={() => detail.reload()} /> : null}
      {ticket ? (
        <TicketDetailBody
          ticket={ticket}
          canReply={canReply}
          onChanged={handleChanged}
          onFeedback={(message, tone) => (tone === "error" ? feedback.error(message) : feedback.success(message))}
        />
      ) : null}
    </Drawer>
  );
}

function PartyBlock({ party, tone }: { party: AdminTicketParty; tone: "payer" | "merchant" }) {
  return (
    <div className="admin-flex" style={{ gap: 10, alignItems: "flex-start" }}>
      <PersonAvatar name={party.displayName} avatarUrl={party.avatarUrl} size={36} />
      <div className="admin-stack" style={{ gap: 2, minWidth: 0 }}>
        <div className="admin-flex" style={{ gap: 8, alignItems: "center" }}>
          <strong style={{ fontSize: 13 }}>{party.displayName}</strong>
          <Badge tone="neutral">{tone === "merchant" ? "商家" : "付款人"}</Badge>
        </div>
        <span className="admin-muted" style={{ fontSize: 12 }}>
          学号 {party.studentNo ?? "未填写"} · QQ {party.qq ?? "未填写"} · 邮箱 {party.email ?? "未填写"}
        </span>
      </div>
    </div>
  );
}

function MessageAvatar({ message }: { message: AdminTicketMessage }) {
  if (message.senderRole === "admin") return <PlatformLogo />;
  return <PersonAvatar name={message.senderName} avatarUrl={message.senderAvatarUrl} />;
}

function TicketDetailBody({
  ticket,
  canReply,
  onChanged,
  onFeedback,
}: {
  ticket: AdminTicketDetail;
  canReply: boolean;
  onChanged: () => void;
  onFeedback: (message: string, tone: "success" | "error") => void;
}) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const body = reply.trim();
    if (!body) return;
    setSending(true);
    try {
      await sendAdminTicketMessage(ticket.id, body);
      setReply("");
      onChanged();
      onFeedback("已以平台客服身份回复", "success");
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "发送失败", "error");
    } finally {
      setSending(false);
    }
  };

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
        <span className="admin-muted">消息数</span>
        <span>{ticket.messageCount}</span>
      </div>

      <div className="admin-stack" style={{ gap: 8 }}>
        <span className="admin-muted" style={{ fontSize: 12 }}>
          双方资料
        </span>
        <PartyBlock party={ticket.parties.payer} tone="payer" />
        <PartyBlock party={ticket.parties.merchant} tone="merchant" />
      </div>

      {ticket.status === "closed" ? (
        <div className="admin-muted" style={{ fontSize: 12 }}>
          结束时间 {formatDateTime(ticket.closedAt)}
          {ticket.closedReason ? ` · ${CLOSED_REASON_TEXT[ticket.closedReason]}` : ""}
          {ticket.resolutionNote ? ` · 处理说明：${ticket.resolutionNote}` : ""}
        </div>
      ) : null}

      <div className="admin-stack" style={{ gap: 12 }}>
        {ticket.messages.map((message) => (
          <div key={message.id} className="admin-flex" style={{ gap: 8, alignItems: "flex-start" }}>
            <MessageAvatar message={message} />
            <div className="admin-stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
              <div className="admin-flex" style={{ gap: 8, alignItems: "baseline" }}>
                <strong style={{ fontSize: 13 }}>{message.senderName}</strong>
                <span className="admin-muted" style={{ fontSize: 12 }}>
                  {message.senderRole === "merchant"
                    ? "商家"
                    : message.senderRole === "payer"
                      ? "付款人"
                      : "平台客服"}{" "}
                  · {formatDateTime(message.createdAt)}
                </span>
              </div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background:
                    message.senderRole === "admin"
                      ? "var(--admin-primary-soft, rgba(59,130,246,.12))"
                      : "var(--admin-bg-subtle, rgba(127,127,127,.08))",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 13,
                  lineHeight: 1.65,
                }}
              >
                {message.body}
              </div>
            </div>
          </div>
        ))}
      </div>

      {ticket.status === "open" ? (
        canReply ? (
          <div className="admin-stack" style={{ gap: 8 }}>
            <textarea
              className="admin-input"
              style={{ minHeight: 84, resize: "vertical", lineHeight: 1.6 }}
              placeholder="以「平台客服」身份回复双方…"
              maxLength={1000}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
            />
            <div className="admin-flex" style={{ gap: 8, alignItems: "center" }}>
              <span className="admin-muted" style={{ fontSize: 12 }}>
                {reply.length} / 1000
              </span>
              <span className="admin-spacer" />
              <Button variant="primary" disabled={!reply.trim() || sending} onClick={() => void send()}>
                {sending ? "发送中…" : "发送回复"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="admin-muted" style={{ fontSize: 12 }}>
            只读账号不能发言。
          </div>
        )
      ) : null}
    </div>
  );
}

/** 供列表页判断是否可点的辅助类型（保持导出，避免未使用告警） */
export type { AdminTicket };
