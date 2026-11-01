/** 关于：版本号、更新日志、隐私协议与服务条款。 */

import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "../components/Dialog";
import { ErrorBlock, LoadingBlock } from "../components/Loading";
import { LogoMark, Tagline, Wordmark } from "../components/Logo";
import { PageHeader } from "../components/PageHeader";
import { getAbout } from "../lib/api";
import { cn } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { Markdown } from "../lib/markdown";

type DocKey = "privacy" | "terms" | null;

const REPO_URL = "https://github.com/idoknow/gzspay";
const ORG_URL = "https://github.com/idoknow";

function GitHubIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="text-text">
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.9 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 2.5-.34c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.8-4.58 5.05.36.32.68.94.68 1.9 0 1.38-.01 2.49-.01 2.83 0 .27.18.6.69.49A10.06 10.06 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function OrgIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-text">
      <rect x="3.5" y="8" width="17" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 8V6.5A2.5 2.5 0 0 1 10.5 4h3A2.5 2.5 0 0 1 16 6.5V8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 13h17" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ExternalIcon(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BookIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-text">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M8 7.5h8M8 11h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0 text-muted transition-transform duration-200", open && "rotate-180")}
    >
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AboutPage(): ReactNode {
  const { data, loading, error, reload } = useAsync(() => getAbout(), []);
  const [doc, setDoc] = useState<DocKey>(null);
  const [openEntries, setOpenEntries] = useState<string[]>([]);

  const version = data?.version ?? "";

  // 默认只展开最新一个版本，其余收起
  useEffect(() => {
    const first = data?.changelog[0];
    setOpenEntries(first ? [`${first.version}-${first.date}`] : []);
  }, [data]);

  const allEntriesOpen = data ? data.changelog.length > 0 && openEntries.length === data.changelog.length : false;

  function toggleEntry(id: string): void {
    setOpenEntries((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  }

  function toggleAllEntries(): void {
    if (!data) return;
    setOpenEntries(allEntriesOpen ? [] : data.changelog.map((entry) => `${entry.version}-${entry.date}`));
  }

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
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">更新日志</h2>
            {data && data.changelog.length > 0 ? (
              <button
                type="button"
                className="text-[11px] font-medium text-brand transition active:opacity-70"
                onClick={toggleAllEntries}
              >
                {allEntriesOpen ? "全部收起" : "全部展开"}
              </button>
            ) : null}
          </div>
          {loading ? (
            <LoadingBlock text="加载中…" />
          ) : error ? (
            <ErrorBlock message={error} onRetry={reload} compact />
          ) : data && data.changelog.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {data.changelog.map((entry) => {
                const id = `${entry.version}-${entry.date}`;
                const open = openEntries.includes(id);
                const unreleased = entry.version === "未发布";
                // 未发布的记录按「新增 / 变更 / 修复」分组展示，组内最新写的排在最前
                const groups =
                  entry.groups.length > 0
                    ? entry.groups.map((group) => ({
                        title: group.title,
                        items: unreleased ? [...group.items].reverse() : group.items,
                      }))
                    : [{ title: "", items: entry.items }];
                return (
                  <li key={id} className="overflow-hidden rounded-2xl border border-line bg-surface-2/50">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition active:bg-surface-2"
                      aria-expanded={open}
                      onClick={() => toggleEntry(id)}
                    >
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
                        {unreleased ? entry.version : `v${entry.version}`}
                      </span>
                      {entry.date ? <span className="text-[11px] text-muted">{entry.date}</span> : null}
                      <span className="ml-auto text-[11px] text-muted">{entry.items.length} 条</span>
                      <ChevronIcon open={open} />
                    </button>
                    {open ? (
                      <div className="space-y-2 px-3 pb-3">
                        {groups.map((group) => (
                          <div key={group.title || entry.version}>
                            {group.title ? (
                              <p className="text-[11px] font-medium text-muted">{group.title}</p>
                            ) : null}
                            <ul className="mt-1 space-y-1 pl-1">
                              {group.items.map((item, index) => (
                                <li
                                  key={`${group.title}-${index}`}
                                  className="flex gap-1.5 text-xs leading-relaxed text-text"
                                >
                                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted">暂无更新记录。</p>
          )}
        </section>

        <section className="card divide-y divide-line p-0">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors active:bg-surface-2"
          >
            <span className="flex items-center gap-2.5 text-sm text-text">
              <GitHubIcon />
              开源仓库
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              idoknow/gzspay
              <ExternalIcon />
            </span>
          </a>
          <a
            href={ORG_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors active:bg-surface-2"
          >
            <span className="flex items-center gap-2.5 text-sm text-text">
              <OrgIcon />
              维护组织
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              idoknow
              <ExternalIcon />
            </span>
          </a>
        </section>

        <section className="card divide-y divide-line p-0">
          <a
            href="/guide"
            target="_blank"
            rel="noreferrer noopener"
            className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors active:bg-surface-2"
          >
            <span className="flex items-center gap-2.5 text-sm text-text">
              <BookIcon />
              使用文档
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              无需登录查看
              <ExternalIcon />
            </span>
          </a>
        </section>

        <section className="card divide-y divide-line p-0">
          <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left" onClick={() => setDoc("privacy")}>
            <span className="text-sm text-text">隐私协议</span>
            <span className="flex items-center gap-2 text-[11px] text-muted">
              {data?.privacyUpdatedAt ? `最后更新 ${data.privacyUpdatedAt}` : null}
              <span className="text-muted">›</span>
            </span>
          </button>
          <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left" onClick={() => setDoc("terms")}>
            <span className="text-sm text-text">服务条款</span>
            <span className="flex items-center gap-2 text-[11px] text-muted">
              {data?.termsUpdatedAt ? `最后更新 ${data.termsUpdatedAt}` : null}
              <span className="text-muted">›</span>
            </span>
          </button>
        </section>
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
        <Markdown
          className="max-h-[60vh] overflow-y-auto pr-1"
          text={(doc === "privacy" ? data?.privacy : data?.terms) || "内容加载中或暂不可用。"}
        />
      </Dialog>
    </div>
  );
}
