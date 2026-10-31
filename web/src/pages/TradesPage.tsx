/** 交易页：待付款 / 待收款 + 状态筛选 + 订单列表 + 公告 + 空态。 */

import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnnouncementBanner } from "../components/AnnouncementBanner";
import { Avatar } from "../components/Avatar";
import { BottomNav } from "../components/BottomNav";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock, Spinner } from "../components/Loading";
import { Logo } from "../components/Logo";
import { OrderCard } from "../components/OrderCard";
import { listOrders, subscribeEvents } from "../lib/api";
import { errorMessage } from "../lib/http";
import { cn } from "../lib/format";
import { useAuth } from "../lib/session";
import type { Order } from "../lib/types";

type Scope = "pay" | "receive";
type StatusFilter = "pending" | "paid" | "closed";

const PAGE_SIZE = 20;

const SCOPE_LABELS: Record<Scope, string> = { pay: "待付款", receive: "待收款" };
const STATUS_LABELS: Record<StatusFilter, string> = { pending: "待处理", paid: "已支付", closed: "已结束" };
const EMPTY_TEXT: Record<Scope, Record<StatusFilter, string>> = {
  pay: { pending: "暂无待付款订单", paid: "暂无已支付订单", closed: "暂无已结束订单" },
  receive: { pending: "暂无待收款订单", paid: "暂无已支付订单", closed: "暂无已结束订单" },
};

export function TradesPage(): ReactNode {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [scope, setScope] = useState<Scope>("pay");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listOrders({ scope, status, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (!active) return;
        setOrders((previous) => (page === 1 ? result.items : [...previous, ...result.items]));
        setTotal(result.total);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, status, page, reloadKey]);

  // 服务端事件：订单状态变化后刷新列表（回到第一页）
  useEffect(() => {
    return subscribeEvents({
      onOrderUpdate: () => {
        setOrders([]);
        setPage(1);
        setReloadKey((value) => value + 1);
      },
    });
  }, []);

  const changeScope = (next: Scope): void => {
    if (next === scope) return;
    setOrders([]);
    setTotal(0);
    setPage(1);
    setScope(next);
  };

  const changeStatus = (next: StatusFilter): void => {
    if (next === status) return;
    setOrders([]);
    setTotal(0);
    setPage(1);
    setStatus(next);
  };

  const hasMore = orders.length < total;

  return (
    <div className="bg-app min-h-[100dvh]">
      <header className="sticky top-0 z-30 border-b border-line glass safe-top">
        <div className="page flex items-center justify-between py-3">
          <Logo size={30} wordmark />
          <button type="button" aria-label="我的" className="rounded-full" onClick={() => navigate("/me")}>
            <Avatar name={me?.displayName ?? "我"} avatarUrl={me?.avatarUrl ?? null} size={34} />
          </button>
        </div>
      </header>

      <main className="page page-with-nav pt-4">
        <div className="flex rounded-full bg-surface-2 p-1">
          {(Object.keys(SCOPE_LABELS) as Scope[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => changeScope(item)}
              className={cn(
                "flex-1 rounded-full py-2 text-sm font-semibold transition",
                scope === item ? "bg-surface text-brand shadow-sm" : "text-muted",
              )}
            >
              {SCOPE_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => changeStatus(item)}
              className={cn("chip", status === item && "chip-active")}
            >
              {STATUS_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <AnnouncementBanner />
        </div>

        {error && orders.length === 0 ? (
          <ErrorBlock
            message={error}
            onRetry={() => {
              setReloadKey((value) => value + 1);
            }}
          />
        ) : loading && orders.length === 0 ? (
          <LoadingBlock text="正在加载订单…" />
        ) : orders.length === 0 ? (
          <EmptyState
            title={EMPTY_TEXT[scope][status]}
            description="扫码付款或让对方向你发起收款，订单会出现在这里"
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate("/pay")}>
                去收付款
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} onClick={() => navigate(`/orders/${order.id}`)} />
            ))}
            {hasMore ? (
              <button
                type="button"
                className="btn btn-secondary btn-block"
                disabled={loading}
                onClick={() => setPage((value) => value + 1)}
              >
                {loading ? <Spinner size={18} /> : null}
                加载更多
              </button>
            ) : orders.length > 0 ? (
              <p className="pt-1 text-center text-[11px] text-muted">没有更多了</p>
            ) : null}
            {error ? (
              <p className="pt-1 text-center text-xs text-danger">
                {error}
                <button
                  type="button"
                  className="ml-2 font-semibold text-brand"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  重试
                </button>
              </p>
            ) : null}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
