/** 我的收付款码：进入即展示动态二维码（自动刷新 + 到期失效），也可扫码解析他人的动态码。 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { InlineQrScanner } from "../components/InlineQrScanner";
import { PageHeader } from "../components/PageHeader";
import { InlineError, Spinner } from "../components/Loading";
import { Logo } from "../components/Logo";
import { QrImage } from "../components/QrImage";
import { useToast } from "../components/Toast";
import { createDynamicCode } from "../lib/api";
import { formatCountdown } from "../lib/format";
import { errorMessage } from "../lib/http";
import { useNow } from "../lib/hooks";
import { useQrDataUrl } from "../lib/qr";
import { extractDynamicToken, parseQrContent } from "../lib/scan";
import type { DynamicCodeResponse } from "../lib/types";

export function DynamicCodePage(): ReactNode {
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState<DynamicCodeResponse | null>(null);
  const [refreshAt, setRefreshAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const loadingRef = useRef(false);
  const now = useNow(1000);

  const load = useCallback(async (): Promise<void> => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    try {
      const next = await createDynamicCode();
      setCode(next);
      setRefreshAt(Date.now() + Math.max(1, next.refreshAfterSeconds) * 1000);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  // 进入页面即获取动态码；离开页面由服务端令牌自然过期
  useEffect(() => {
    void load();
  }, [load]);

  // 自动刷新：每 refreshAfterSeconds 秒换一张新码
  useEffect(() => {
    if (!code || refreshing) return;
    if (refreshAt > 0 && now >= refreshAt) void load();
  }, [code, refreshing, refreshAt, now, load]);

  const expiresMs = code ? Date.parse(code.expiresAt) : 0;
  const expiresIn = Number.isFinite(expiresMs) ? Math.max(0, Math.ceil((expiresMs - now) / 1000)) : 0;
  const refreshIn = refreshAt > 0 ? Math.max(0, Math.ceil((refreshAt - now) / 1000)) : 0;
  const expired = Boolean(code) && expiresIn <= 0;
  const { dataUrl, error: qrError } = useQrDataUrl(code?.qrContent ?? null, 520);

  const handleScanned = (raw: string): void => {
    setScannerOpen(false);
    const parsed = parseQrContent(raw);
    if (parsed.kind === "dynamic") {
      const token = extractDynamicToken(raw) ?? parsed.value;
      navigate(`/pay?token=${encodeURIComponent(token)}`);
      return;
    }
    if (parsed.kind === "card") {
      navigate(`/pay?card=${encodeURIComponent(parsed.value)}`);
      return;
    }
    toast.error("无法识别的二维码");
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="我的收付款码" back />

      <main className="page page-with-nav space-y-4 pt-4">
        <section className="card p-4">
          <div className="flex items-center gap-3">
            <Logo size={34} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text">动态收付款码</p>
              <p className="mt-0.5 text-[11px] text-muted">可收款，也可付款</p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              实时
            </span>
          </div>
        </section>

        <section className="card p-4">
          <div className="flex flex-col items-center">
            {qrError ? (
              <p className="py-10 text-center text-xs text-danger">{qrError}</p>
            ) : !dataUrl ? (
              <div className="skeleton h-[232px] w-[232px] watch:h-[176px] watch:w-[176px]" />
            ) : (
              <div className="relative rounded-3xl border border-line bg-white p-4 watch:rounded-2xl watch:p-2">
                <QrImage dataUrl={dataUrl} size={232} alt="我的动态收付款码" />
                {expired ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl bg-black/55 text-white">
                    <p className="text-sm font-semibold">二维码已失效</p>
                    <button type="button" className="btn btn-sm btn-accent mt-3" onClick={() => void load()}>
                      刷新
                    </button>
                  </div>
                ) : null}
              </div>
            )}

            <p className="mt-4 text-center text-xs leading-relaxed text-muted">
              {expired
                ? "正在刷新…"
                : `${formatCountdown(expiresIn)} 后失效 · ${refreshIn > 0 ? `${refreshIn} 秒后自动刷新` : "正在刷新…"}`}
            </p>

            {code ? (
              <button
                type="button"
                className="btn btn-outline btn-sm mt-3"
                disabled={refreshing}
                onClick={() => void load()}
              >
                {refreshing ? <Spinner size={14} /> : null}
                刷新
              </button>
            ) : null}
          </div>

          <div className="divider my-4" />
          <InlineError message={error} />
          <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
            <li>· 他人扫此码可向你付款，收款需先开通商家收款。</li>
            <li>· 商家扫此码可向你发起收款，在你手机上输入密码。</li>
            <li>· 密码只在自己手机上输入，不要告诉任何人。</li>
            <li>· 资金通过第三方收款码流转，不代收代付。</li>
          </ul>
        </section>

        {scannerOpen ? (
          <section className="card overflow-hidden p-0">
            <InlineQrScanner
              active={scannerOpen}
              hint="对准对方的收付款码或校园卡二维码"
              onResult={handleScanned}
            />
            <div className="p-4">
              <button
                type="button"
                className="btn btn-outline btn-block"
                onClick={() => setScannerOpen(false)}
              >
                停止扫码
              </button>
            </div>
          </section>
        ) : (
          <button
            type="button"
            className="card flex w-full items-center gap-3 p-4 text-left"
            onClick={() => setScannerOpen(true)}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3M3 12h18"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-text">扫一扫</span>
              <span className="mt-0.5 block text-xs text-muted">扫收付款码或校园卡付款</span>
            </span>
            <span className="text-muted">›</span>
          </button>
        )}
      </main>

      <BottomNav icp />
    </div>
  );
}
