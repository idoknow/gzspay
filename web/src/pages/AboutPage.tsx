/** 关于：版本号、更新日志、隐私协议与服务条款。 */

import { useState, type ReactNode } from "react";
import { Dialog } from "../components/Dialog";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { LogoMark, Tagline, Wordmark } from "../components/Logo";
import { PageHeader } from "../components/PageHeader";
import { getAbout } from "../lib/api";
import { useAsync } from "../lib/hooks";

type DocKey = "privacy" | "terms" | null;

export function AboutPage(): ReactNode {
  const { data, loading, error, reload } = useAsync(() => getAbout(), []);
  const [doc, setDoc] = useState<DocKey>(null);

  const version = data?.version ?? "";

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="关于" back />

      <main className="page space-y-4 pb-10 pt-4">
        <section className="card flex flex-col items-center p-6 text-center">
          <LogoMark size={72} />
          <Wordmark size="lg" className="mt-3" />
          <Tagline className="mt-2" />
          <p className="mt-2 text-xs text-muted">桂中校园收付款</p>
          <p className="mt-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-muted">版本 {version || "-"}</p>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            gzspay 提供校园内的收付款记录与沟通工具。
            <br />
            资金通过第三方收款码流转，gzspay 不代收代付。
          </p>
        </section>

        <section className="card p-4">
          <h2 className="text-sm font-semibold text-text">更新日志</h2>
          {loading ? (
            <LoadingBlock text="加载中…" />
          ) : error ? (
            <ErrorBlock message={error} onRetry={reload} compact />
          ) : data && data.changelog.length > 0 ? (
            <ul className="mt-2 space-y-3">
              {data.changelog.map((entry) => (
                <li key={`${entry.version}-${entry.date}`}>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">v{entry.version}</span>
                    <span className="text-[11px] text-muted">{entry.date}</span>
                  </div>
                  <ul className="mt-1 space-y-1 pl-1">
                    {entry.items.map((item, index) => (
                      <li key={`${entry.version}-${index}`} className="flex gap-1.5 text-xs leading-relaxed text-text">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">暂无更新记录。</p>
          )}
        </section>

        <section className="card divide-y divide-line p-0">
          <button type="button" className="flex w-full items-center justify-between px-4 py-3.5 text-left" onClick={() => setDoc("privacy")}>
            <span className="text-sm text-text">隐私协议</span>
            <span className="text-muted">›</span>
          </button>
          <button type="button" className="flex w-full items-center justify-between px-4 py-3.5 text-left" onClick={() => setDoc("terms")}>
            <span className="text-sm text-text">服务条款</span>
            <span className="text-muted">›</span>
          </button>
        </section>

        <p className="text-center text-[11px] text-muted">© {new Date().getFullYear()} gzspay · 桂中校园</p>
      </main>

      <Dialog
        open={doc !== null}
        onClose={() => setDoc(null)}
        title={doc === "privacy" ? "隐私协议" : "服务条款"}
        footer={
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setDoc(null)}>
            关闭
          </button>
        }
      >
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-text">
          {(doc === "privacy" ? data?.privacy : data?.terms) || "内容加载中或暂不可用。"}
        </div>
      </Dialog>
    </div>
  );
}
