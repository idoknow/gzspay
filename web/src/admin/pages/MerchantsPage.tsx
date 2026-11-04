/**
 * 商家管理：查看商家概况、收款方式与商品，支持停用/启用收款方式、暂停/恢复商家收款。
 */
import { useEffect, useState } from "react";
import {
  getMerchantDetail,
  getMerchants,
  getMerchantSummary,
  setMerchantChannel,
  setMerchantReceiving,
} from "../api";
import { ChannelIcon } from "../../components/ChannelIcon";
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  InfoBanner,
  KVGrid,
  OrderStatusBadge,
  PageHeader,
  Pagination,
  SectionTitle,
  StatCard,
  TableSkeleton,
  Tabs,
} from "../components/ui";
import { AdminAvatar } from "../components/AdminAvatar";
import { useFeedback } from "../components/dialogs";
import { useAdmin } from "../context";
import {
  formatCents,
  formatDateTime,
  formatNumber,
  formatRelative,
} from "../format";
import { useAsync, useDebounced } from "../hooks";
import { errorMessage } from "../../lib/http";
import type {
  AdminMerchant,
  AdminMerchantChannel,
  MerchantDetailPayload,
  MerchantStateFilter,
  MerchantSummary,
} from "../types";

const PAGE_SIZE = 20;

const EMPTY_SUMMARY: MerchantSummary = {
  total: 0,
  ready: 0,
  suspended: 0,
  newThisMonth: 0,
};

/** 渠道是否可真正用于收款：已启用且已上传收款码 */
function channelUsable(channel: AdminMerchantChannel): boolean {
  return channel.enabled && channel.hasQr;
}

function channelHint(channel: AdminMerchantChannel | undefined): string {
  if (!channel) return "未上传收款码";
  if (!channel.hasQr) return "未上传收款码";
  if (!channel.enabled) return "已停用";
  return "可收款";
}

export function MerchantsPage() {
  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebounced(keyword, 300);
  const [stateFilter, setStateFilter] = useState<MerchantStateFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

  const list = useAsync(
    () => getMerchants(debouncedKeyword, stateFilter, page, pageSize),
    [debouncedKeyword, stateFilter, page, pageSize],
  );
  const summary = useAsync(() => getMerchantSummary(), []);

  useEffect(() => {
    setPage(1);
  }, [debouncedKeyword, stateFilter]);

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const stats = summary.data ?? EMPTY_SUMMARY;

  const changeKeyword = (value: string) => {
    setKeyword(value);
  };

  const refreshAll = () => {
    list.refresh();
    summary.refresh();
  };

  return (
    <>
      <PageHeader
        title="商家管理"
        description="查看商家的收款方式、商品与收款情况；可停用单个收款方式，或暂停商家收款。"
        actions={
          <Button
            variant="ghost"
            size="sm"
            loading={list.loading || summary.loading}
            onClick={refreshAll}
          >
            刷新
          </Button>
        }
      />

      <div className="admin-stack">
        <div className="admin-stat-grid">
          <StatCard
            label="商家总数"
            value={formatNumber(stats.total)}
            hint="已开通商家身份的用户"
          />
          <StatCard
            label="可正常收款"
            value={formatNumber(stats.ready)}
            hint="至少有一个可用收款方式"
            tone="success"
          />
          <StatCard
            label="已暂停收款"
            value={formatNumber(stats.suspended)}
            hint="所有收款方式均已停用"
            tone="accent"
          />
          <StatCard
            label="本月新增"
            value={formatNumber(stats.newThisMonth)}
            hint="按商家开通时间统计"
          />
        </div>

        <Card
          title="商家列表"
          subtitle="支持商家名称、负责人、学号模糊搜索"
          extra={
            <div className="admin-flex" style={{ gap: 8 }}>
              <input
                className="admin-input admin-input-sm"
                style={{ width: 240 }}
                value={keyword}
                placeholder="搜索商家 / 负责人 / 学号"
                aria-label="搜索商家"
                onChange={(event) => changeKeyword(event.target.value)}
              />
              {keyword ? (
                <button
                  type="button"
                  className="admin-btn admin-btn-ghost admin-btn-sm"
                  onClick={() => changeKeyword("")}
                >
                  清空
                </button>
              ) : null}
            </div>
          }
          flush
        >
          <div className="admin-toolbar">
            <Tabs<MerchantStateFilter>
              items={[
                { key: "all", label: "全部", count: stats.total },
                { key: "ready", label: "可收款", count: stats.ready },
                { key: "suspended", label: "已暂停", count: stats.suspended },
              ]}
              active={stateFilter}
              onChange={setStateFilter}
            />
          </div>

          {list.error && !list.data ? (
            <div style={{ padding: 18 }}>
              <ErrorState
                message={errorMessage(list.error)}
                onRetry={() => list.refresh()}
              />
            </div>
          ) : list.loading && !list.data ? (
            <div style={{ padding: 18 }}>
              <TableSkeleton rows={8} cols={7} />
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 18 }}>
              <EmptyState
                title={
                  debouncedKeyword || stateFilter !== "all"
                    ? "没有匹配的商家"
                    : "暂无商家"
                }
                description={
                  debouncedKeyword || stateFilter !== "all"
                    ? "请尝试其他关键词，或切换到「全部」。"
                    : "还没有用户开通商家身份。"
                }
                action={
                  debouncedKeyword || stateFilter !== "all" ? (
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => {
                        changeKeyword("");
                        setStateFilter("all");
                      }}
                    >
                      清空筛选条件
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>商家</th>
                    <th>学号</th>
                    <th>收款方式</th>
                    <th className="admin-num">商品</th>
                    <th className="admin-num">收款笔数</th>
                    <th className="admin-num">累计收款</th>
                    <th>最近收款</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((merchant) => (
                    <MerchantRow
                      key={merchant.userId}
                      merchant={merchant}
                      onOpen={() => setDetailUserId(merchant.userId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > 0 ? (
            <div style={{ padding: "0 18px 16px" }}>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={(next) => {
                  setPageSize(next);
                  setPage(1);
                }}
                disabled={list.loading}
              />
            </div>
          ) : null}
        </Card>
      </div>

      {detailUserId !== null ? (
        <MerchantDetailDrawer
          userId={detailUserId}
          onClose={() => setDetailUserId(null)}
          onChanged={refreshAll}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------ 列表行 */

function MerchantRow({
  merchant,
  onOpen,
}: {
  merchant: AdminMerchant;
  onOpen: () => void;
}) {
  const channels: Array<"alipay" | "wechat" | "qq"> = ["alipay", "wechat", "qq"];
  return (
    <tr>
      <td>
        <div className="admin-flex" style={{ gap: 10 }}>
          <AdminAvatar name={merchant.merchantName} avatarUrl={merchant.avatarUrl} />
          <div>
            <div className="admin-cell-primary">{merchant.merchantName}</div>
            <div className="admin-cell-sub admin-text-xs">
              {merchant.displayName}
              {merchant.frozen ? " · 已冻结" : ""}
            </div>
          </div>
        </div>
      </td>
      <td className="admin-mono admin-text-sm">
        {merchant.studentNo || merchant.studentNoMasked || "—"}
      </td>
      <td>
        <div className="admin-tag-list">
          {channels.map((channel) => {
            const item = merchant.channels.find(
              (entry) => entry.channel === channel,
            );
            return (
              <span
                key={channel}
                className="admin-channel-chip"
                style={{ opacity: item && channelUsable(item) ? 1 : 0.32 }}
                title={`${item?.label ?? channel} · ${channelHint(item)}`}
              >
                <ChannelIcon channel={channel} size={16} />
              </span>
            );
          })}
        </div>
      </td>
      <td className="admin-text-sm">
        {merchant.activeProductCount}/{merchant.productCount}
      </td>
      <td className="admin-num">{formatNumber(merchant.orderCount)}</td>
      <td className="admin-num">{formatCents(merchant.completedAmountCents)}</td>
      <td
        className="admin-text-sm admin-muted"
        title={merchant.lastOrderAt ? formatDateTime(merchant.lastOrderAt) : undefined}
      >
        {merchant.lastOrderAt ? formatRelative(merchant.lastOrderAt) : "—"}
      </td>
      <td>
        <div className="admin-cell-actions">
          <Button variant="link" size="sm" onClick={onOpen}>
            详情
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------ 详情抽屉 */

function MerchantDetailDrawer({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const feedback = useFeedback();
  const { canWrite } = useAdmin();
  const [detail, setDetail] = useState<MerchantDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);
  const [busyReceiving, setBusyReceiving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMerchantDetail(userId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(errorMessage(caught));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const merchant = detail?.merchant ?? null;

  const toggleChannel = async (channel: AdminMerchantChannel) => {
    const enabling = !channel.enabled;
    if (!enabling) {
      const confirmed = await feedback.confirm({
        title: `停用${channel.label}`,
        description: `停用后付款人将无法选择${channel.label}付款，确认停用？`,
        confirmText: "停用",
        danger: true,
      });
      if (!confirmed) return;
    }
    setBusyChannel(channel.channel);
    try {
      const next = await setMerchantChannel(userId, channel.channel, enabling);
      setDetail(next);
      feedback.success(
        enabling ? `已启用${channel.label}` : `已停用${channel.label}`,
      );
      onChanged();
    } catch (caught) {
      feedback.error(errorMessage(caught));
    } finally {
      setBusyChannel(null);
    }
  };

  const toggleReceiving = async (target: AdminMerchant) => {
    const enabling = target.suspended;
    const confirmed = await feedback.confirm({
      title: enabling ? "恢复商家收款" : "暂停商家收款",
      description: enabling
        ? "恢复后付款人可以继续使用该商家的收款码付款，确认恢复？"
        : "暂停后该商家的所有收款方式都会被停用，付款人无法再向其付款；已创建未支付的订单不受影响。确认暂停？",
      confirmText: enabling ? "恢复收款" : "暂停收款",
      danger: !enabling,
    });
    if (!confirmed) return;
    setBusyReceiving(true);
    try {
      const next = await setMerchantReceiving(userId, enabling);
      setDetail(next);
      feedback.success(enabling ? "已恢复商家收款" : "已暂停商家收款");
      onChanged();
    } catch (caught) {
      feedback.error(errorMessage(caught));
    } finally {
      setBusyReceiving(false);
    }
  };

  return (
    <Drawer
      title={merchant ? `${merchant.merchantName} · 商家详情` : "商家详情"}
      subtitle={merchant ? `负责人：${merchant.displayName}` : undefined}
      onClose={onClose}
      footer={
        canWrite && merchant ? (
          <div className="admin-flex" style={{ gap: 8, flexWrap: "wrap" }}>
            {merchant.suspended ? (
              <Button
                variant="primary"
                size="sm"
                loading={busyReceiving}
                disabled={busyReceiving}
                onClick={() => void toggleReceiving(merchant)}
              >
                恢复收款
              </Button>
            ) : (
              <Button
                variant="danger"
                size="sm"
                loading={busyReceiving}
                disabled={busyReceiving}
                onClick={() => void toggleReceiving(merchant)}
              >
                暂停收款
              </Button>
            )}
          </div>
        ) : (
          <span className="admin-text-sm admin-muted">
            {merchant ? "只读账号不可执行写操作" : "加载中…"}
          </span>
        )
      }
    >
      {error && !detail ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setLoading(true);
            getMerchantDetail(userId)
              .then(setDetail)
              .catch((caught: unknown) => setError(errorMessage(caught)))
              .finally(() => setLoading(false));
          }}
        />
      ) : loading && !detail ? (
        <TableSkeleton rows={6} cols={3} />
      ) : merchant ? (
        <div className="admin-stack">
          {!canWrite ? (
            <InfoBanner tone="info">
              当前角色为只读审计，可查看商家资料与收款情况，但无法修改收款方式。
            </InfoBanner>
          ) : null}
          {merchant.frozen ? (
            <InfoBanner tone="danger">
              该商家账号已被冻结，无法登录与发起交易。
            </InfoBanner>
          ) : null}
          {merchant.suspended ? (
            <InfoBanner tone="warning">
              该商家所有收款方式均已停用，付款人暂时无法向其付款。
            </InfoBanner>
          ) : null}

          <div className="admin-detail-banner">
            <div>
              <div className="admin-detail-amount">{merchant.merchantName}</div>
              <div className="admin-detail-meta">
                {merchant.suspended ? (
                  <Badge tone="warning">已暂停收款</Badge>
                ) : (
                  <Badge tone="success">可收款</Badge>
                )}
                {merchant.frozen ? <Badge tone="danger">已冻结</Badge> : null}
                <Badge tone="accent">
                  {merchant.enabledChannelCount}/{merchant.channels.length} 收款方式
                </Badge>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="admin-text-xs admin-muted">开通时间</div>
              <div className="admin-strong">
                {formatDateTime(merchant.createdAt)}
              </div>
            </div>
          </div>

          <SectionTitle>商家资料</SectionTitle>
          <KVGrid
            items={[
              { label: "用户 ID", value: merchant.userId, mono: true },
              { label: "负责人", value: merchant.displayName },
              {
                label: "学号",
                value: merchant.studentNo || merchant.studentNoMasked || "—",
                mono: true,
              },
              {
                label: "备注要求",
                value: merchant.noteRequirement || "未填写",
              },
              {
                label: "最近收款",
                value: merchant.lastOrderAt
                  ? formatDateTime(merchant.lastOrderAt)
                  : "暂无",
              },
            ]}
          />

          <SectionTitle>收款概况</SectionTitle>
          <div
            className="admin-stat-grid"
            style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
          >
            <StatCard
              label="收款笔数"
              value={formatNumber(merchant.orderCount)}
            />
            <StatCard
              label="累计收款"
              value={formatCents(merchant.completedAmountCents)}
              tone="accent"
            />
            <StatCard
              label="商品数"
              value={`${merchant.activeProductCount}/${merchant.productCount}`}
              hint="上架 / 全部"
              tone="success"
            />
          </div>

          <SectionTitle>收款方式</SectionTitle>
          <div className="admin-channel-list">
            {merchant.channels.map((channel) => (
              <div className="admin-channel-row" key={channel.channel}>
                <div className="admin-channel-row-main">
                  <span className="admin-channel-chip" style={{ opacity: channelUsable(channel) ? 1 : 0.45 }}>
                    <ChannelIcon channel={channel.channel} size={18} />
                  </span>
                  <div>
                    <div className="admin-channel-row-title">{channel.label}</div>
                    <div className="admin-cell-sub admin-text-xs">
                      {channel.enabled ? "已启用" : "已停用"}
                      {" · "}
                      {channel.hasQr ? "已上传收款码" : "未上传收款码"}
                      {channel.updatedAt
                        ? ` · 更新于 ${formatDateTime(channel.updatedAt)}`
                        : ""}
                    </div>
                  </div>
                </div>
                <div className="admin-channel-row-actions">
                  {channel.enabled ? (
                    <Badge tone="success">可收款</Badge>
                  ) : (
                    <Badge tone="neutral">已停用</Badge>
                  )}
                  <Button
                    variant={channel.enabled ? "danger-ghost" : "subtle"}
                    size="sm"
                    disabled={!canWrite || busyChannel !== null}
                    loading={busyChannel === channel.channel}
                    onClick={() => void toggleChannel(channel)}
                  >
                    {channel.enabled ? "停用" : "启用"}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <SectionTitle>商品</SectionTitle>
          {(detail?.products.length ?? 0) === 0 ? (
            <EmptyState title="暂无商品" description="该商家还没有发布商品。" />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th className="admin-num">价格</th>
                    <th>状态</th>
                    <th className="admin-num">排序</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.products ?? []).map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="admin-cell-primary">{product.name}</div>
                        {product.description ? (
                          <div className="admin-cell-sub admin-text-xs">
                            {product.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="admin-num">{formatCents(product.priceCents)}</td>
                      <td>
                        {product.active ? (
                          <Badge tone="success">已上架</Badge>
                        ) : (
                          <Badge tone="neutral">已下架</Badge>
                        )}
                      </td>
                      <td className="admin-num">{formatNumber(product.sortOrder)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <SectionTitle>最近收款订单</SectionTitle>
          {(detail?.recentOrders.length ?? 0) === 0 ? (
            <EmptyState title="暂无收款记录" description="该商家还没有收到付款。" />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>订单号</th>
                    <th>标题</th>
                    <th className="admin-num">金额</th>
                    <th>状态</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.recentOrders ?? []).map((order) => (
                    <tr key={order.id}>
                      <td className="admin-mono admin-text-xs">{order.orderNo}</td>
                      <td className="admin-cell-primary">{order.title}</td>
                      <td className="admin-num">{formatCents(order.amountCents)}</td>
                      <td>
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td className="admin-text-sm admin-muted">
                        {formatDateTime(order.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="未找到商家" description="该商家可能已注销。" />
      )}
    </Drawer>
  );
}
