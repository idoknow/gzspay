/** 商品选择器：多商品数量加减，自动算价（付款人扫码后的商家主页、商家代客户下单共用）。 */

import type { ReactNode } from "react";
import { cn, formatCents } from "../lib/format";
import type { Product } from "../lib/types";

export interface ProductPickerProps {
  products: Product[];
  /** productId -> quantity */
  selected: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  disabled?: boolean;
}

export function sumProductCents(products: Product[], selected: Record<string, number>): number {
  return products.reduce((total, product) => {
    const quantity = selected[product.id] ?? 0;
    return total + product.priceCents * quantity;
  }, 0);
}

export function selectedToItems(
  products: Product[],
  selected: Record<string, number>,
): { productId: string; quantity: number }[] {
  return products
    .filter((product) => (selected[product.id] ?? 0) > 0)
    .map((product) => ({ productId: product.id, quantity: selected[product.id] ?? 0 }));
}

export function ProductPicker({ products, selected, onChange, disabled = false }: ProductPickerProps): ReactNode {
  if (products.length === 0) {
    return <p className="py-3 text-sm text-muted">该商家还没有发布商品，可直接输入金额付款。</p>;
  }

  const adjust = (product: Product, delta: number): void => {
    const current = selected[product.id] ?? 0;
    const nextQuantity = Math.max(0, Math.min(99, current + delta));
    const next = { ...selected };
    if (nextQuantity === 0) {
      delete next[product.id];
    } else {
      next[product.id] = nextQuantity;
    }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {products.map((product) => {
        const quantity = selected[product.id] ?? 0;
        return (
          <div
            key={product.id}
            className={cn(
              "flex items-center gap-3 rounded-2xl border p-3 transition",
              quantity > 0 ? "border-brand bg-brand-soft/60" : "border-line bg-surface",
            )}
          >
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded-xl object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg">
                {product.name.slice(0, 1)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text">{product.name}</p>
              {product.description ? (
                <p className="mt-0.5 truncate text-xs text-muted">{product.description}</p>
              ) : null}
              <p className="mt-0.5 text-sm font-bold text-brand">¥{formatCents(product.priceCents)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label={`减少 ${product.name}`}
                disabled={disabled || quantity === 0}
                onClick={() => adjust(product, -1)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-lg text-text transition active:bg-surface-2 disabled:opacity-35"
              >
                −
              </button>
              <span className="w-5 text-center text-sm font-semibold text-text">{quantity}</span>
              <button
                type="button"
                aria-label={`增加 ${product.name}`}
                disabled={disabled || quantity >= 99}
                onClick={() => adjust(product, 1)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-lg text-white transition active:opacity-80 disabled:opacity-35"
              >
                +
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
