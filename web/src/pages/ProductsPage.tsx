/** 商品与发布：商品增删改、上下架、排序、备注要求编辑、预览付款人视角。 */

import { useEffect, useState, type ReactNode } from "react";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorBlock, LoadingBlock, Spinner } from "../components/Loading";
import { MoneyText } from "../components/MoneyText";
import { Toggle } from "../components/Toggle";
import { useToast } from "../components/Toast";
import {
  createProduct,
  deleteProduct,
  getMerchant,
  listProducts,
  sortProducts,
  updateMerchant,
  updateProduct,
} from "../lib/api";
import { cn, centsToYuan, yuanToCents } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useAsync } from "../lib/hooks";
import type { MerchantInfo, Product } from "../lib/types";

interface ProductDraft {
  id: string | null;
  name: string;
  priceYuan: string;
  description: string;
  active: boolean;
}

const EMPTY_DRAFT: ProductDraft = { id: null, name: "", priceYuan: "", description: "", active: true };

function draftFromProduct(product: Product): ProductDraft {
  return {
    id: product.id,
    name: product.name,
    priceYuan: centsToYuan(product.priceCents),
    description: product.description ?? "",
    active: product.active,
  };
}

export function ProductsPage(): ReactNode {
  const toast = useToast();
  const merchantQuery = useAsync(() => getMerchant(), []);
  const productsQuery = useAsync(() => listProducts(), []);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const merchant: MerchantInfo | null = merchantQuery.data?.registered ? merchantQuery.data.merchant : null;
  const products = productsQuery.data ?? [];

  useEffect(() => {
    if (merchant) setNote(merchant.noteRequirement);
  }, [merchant]);

  const saveNote = async (): Promise<void> => {
    setSavingNote(true);
    try {
      await updateMerchant({ noteRequirement: note.trim() });
      toast.success("备注要求已保存");
      merchantQuery.reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSavingNote(false);
    }
  };

  const saveProduct = async (): Promise<void> => {
    if (!draft) return;
    const name = draft.name.trim();
    const priceCents = yuanToCents(draft.priceYuan);
    if (!name) {
      toast.error("请填写商品名称");
      return;
    }
    if (priceCents === null || priceCents <= 0) {
      toast.error("请填写正确的价格");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        priceCents,
        description: draft.description.trim(),
        active: draft.active,
      };
      if (draft.id) {
        await updateProduct(draft.id, payload);
        toast.success("商品已更新");
      } else {
        await createProduct(payload);
        toast.success("商品已创建");
      }
      setDraft(null);
      productsQuery.reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (product: Product, next: boolean): Promise<void> => {
    setBusyId(product.id);
    try {
      await updateProduct(product.id, { active: next });
      toast.success(next ? "商品已上架" : "商品已下架");
      productsQuery.reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  const removeProduct = async (): Promise<void> => {
    if (!deleting) return;
    try {
      await deleteProduct(deleting.id);
      toast.success("商品已删除");
      setDeleting(null);
      productsQuery.reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const move = async (index: number, direction: -1 | 1): Promise<void> => {
    const target = index + direction;
    if (target < 0 || target >= products.length) return;
    const next = [...products];
    const current = next[index];
    const swapped = next[target];
    if (!current || !swapped) return;
    next[index] = swapped;
    next[target] = current;
    setBusyId(current.id);
    try {
      await sortProducts(next.map((item) => item.id));
      productsQuery.reload();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  };

  const loading = merchantQuery.loading || productsQuery.loading;
  const error = merchantQuery.error ?? productsQuery.error;

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader
        title="商品与发布"
        back
        right={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewOpen(true)}>
            预览
          </button>
        }
      />

      <main className="page space-y-4 pb-10 pt-4">
        {loading && !merchant ? (
          <LoadingBlock text="正在加载商品…" />
        ) : error && !merchant ? (
          <ErrorBlock
            message={error}
            onRetry={() => {
              merchantQuery.reload();
              productsQuery.reload();
            }}
          />
        ) : !merchant ? (
          <EmptyState title="尚未注册商家" description="请先在「商家」中完成注册，再发布商品。" />
        ) : (
          <>
            <section className="card p-4">
              <h2 className="text-sm font-semibold text-text">备注要求</h2>
              <textarea
                className="input mt-2 min-h-20 py-3"
                value={note}
                maxLength={120}
                placeholder="付款人创建订单前需要确认的备注要求，留空表示无要求"
                onChange={(event) => setNote(event.target.value)}
              />
              <button type="button" className="btn btn-outline btn-block mt-2" disabled={savingNote} onClick={() => void saveNote()}>
                {savingNote ? <Spinner size={16} /> : null}
                保存备注要求
              </button>
            </section>

            <section className="card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text">商品列表</h2>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setDraft({ ...EMPTY_DRAFT, name: "" })}>
                  新建商品
                </button>
              </div>

              {products.length === 0 ? (
                <EmptyState
                  compact
                  title="还没有商品"
                  description="发布商品后，付款人扫码时可以直接选择商品并自动计算金额。"
                />
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {products.map((product, index) => (
                    <li key={product.id} className="flex items-start gap-2 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={cn("truncate text-sm font-medium", product.active ? "text-text" : "text-muted line-through")}>
                            {product.name}
                          </p>
                          {!product.active ? (
                            <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">已下架</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <MoneyText cents={product.priceCents} size="sm" />
                          {product.description ? <span className="truncate text-[11px] text-muted">{product.description}</span> : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Toggle
                          checked={product.active}
                          disabled={busyId === product.id}
                          onChange={(next) => void toggleActive(product, next)}
                          label={`${product.name}上下架`}
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded-lg bg-surface-2 px-2 py-1 text-xs text-muted disabled:opacity-40"
                            disabled={index === 0 || busyId !== null}
                            aria-label="上移"
                            onClick={() => void move(index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="rounded-lg bg-surface-2 px-2 py-1 text-xs text-muted disabled:opacity-40"
                            disabled={index === products.length - 1 || busyId !== null}
                            aria-label="下移"
                            onClick={() => void move(index, 1)}
                          >
                            ↓
                          </button>
                          <button type="button" className="rounded-lg bg-surface-2 px-2 py-1 text-xs text-brand" onClick={() => setDraft(draftFromProduct(product))}>
                            编辑
                          </button>
                          <button type="button" className="rounded-lg bg-danger-soft px-2 py-1 text-xs text-danger" onClick={() => setDeleting(product)}>
                            删除
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {productsQuery.error ? <p className="text-center text-xs text-danger">{productsQuery.error}</p> : null}
          </>
        )}
      </main>

      {/* 商品编辑弹窗 */}
      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? "编辑商品" : "新建商品"}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveProduct()}>
              {saving ? <Spinner size={16} /> : null}
              保存
            </button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="product-name">
                商品名称
              </label>
              <input
                id="product-name"
                className="input"
                value={draft.name}
                maxLength={40}
                placeholder="例如：手冲咖啡"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="product-price">
                价格（元）
              </label>
              <input
                id="product-price"
                className="input"
                value={draft.priceYuan}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(event) => setDraft({ ...draft, priceYuan: event.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="product-desc">
                商品说明（可选）
              </label>
              <textarea
                id="product-desc"
                className="input min-h-16 py-2"
                value={draft.description}
                maxLength={120}
                placeholder="口味、规格等补充说明"
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2.5">
              <div>
                <p className="text-sm text-text">立即上架</p>
                <p className="text-[11px] text-muted">下架后付款人不会看到该商品</p>
              </div>
              <Toggle checked={draft.active} onChange={(next) => setDraft({ ...draft, active: next })} label="立即上架" />
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title="删除商品"
        description={deleting ? `确定删除「${deleting.name}」吗？删除后不可恢复。` : ""}
        confirmText="删除"
        danger
        onConfirm={() => void removeProduct()}
        onClose={() => setDeleting(null)}
      />

      {/* 预览付款人视角 */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title="付款人视角预览" footer={
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setPreviewOpen(false)}>
          关闭
        </button>
      }>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-lg font-bold text-brand">
              {(merchant?.name ?? "商").slice(0, 1)}
            </div>
            <div>
              <p className="text-sm font-semibold text-text">{merchant?.name ?? "商家"}</p>
              <p className="text-[11px] text-muted">扫码后看到的商家信息</p>
            </div>
          </div>
          {merchant?.noteRequirement ? (
            <div className="rounded-2xl bg-accent-soft px-3 py-2.5">
              <p className="text-[11px] font-medium text-accent-strong">备注要求</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-text">{merchant.noteRequirement}</p>
            </div>
          ) : null}
          {products.filter((item) => item.active).length === 0 ? (
            <p className="rounded-2xl bg-surface-2 px-3 py-3 text-center text-xs text-muted">还没有上架商品，付款人只能自定义金额</p>
          ) : (
            <ul className="space-y-2">
              {products
                .filter((item) => item.active)
                .map((product) => (
                  <li key={product.id} className="flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text">{product.name}</p>
                      {product.description ? <p className="truncate text-[11px] text-muted">{product.description}</p> : null}
                    </div>
                    <MoneyText cents={product.priceCents} size="sm" />
                  </li>
                ))}
            </ul>
          )}
          <p className="text-center text-[11px] text-muted">预览仅用于检查展示效果，实际以扫码页面为准</p>
        </div>
      </Dialog>
    </div>
  );
}
