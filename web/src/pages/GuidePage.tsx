/** 使用文档：公共页面（/guide），无需登录即可查看，也可以直接把链接分享给同学。 */

import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LogoMark, Wordmark } from "../components/Logo";
import { SiteIcp } from "../components/SiteIcp";
import { GUIDE_SECTIONS, GUIDE_UPDATED_AT } from "../content/guide";
import { Markdown } from "../lib/markdown";
import { useAuth } from "../lib/session";

const REPO_URL = "https://github.com/idoknow/gzspay";

function ArrowLeftIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUpIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GitHubIcon(): ReactNode {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.9-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.9 1.57 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 2.5-.34c.85 0 1.7.12 2.5.34 1.9-1.33 2.74-1.05 2.74-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.35 4.8-4.58 5.05.36.32.68.94.68 1.9 0 1.38-.01 2.49-.01 2.83 0 .27.18.6.69.49A10.06 10.06 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

export function GuidePage(): ReactNode {
  const navigate = useNavigate();
  const { authenticated, onboarded } = useAuth();
  const home = authenticated ? (onboarded ? "/trades" : "/onboarding") : "/login";

  // 独立页面：同步浏览器标题，离开时还原
  useEffect(() => {
    const previous = document.title;
    document.title = "使用文档 · gzspay";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-app">
      <header className="glass safe-top sticky top-0 z-30 border-b border-line">
        <div className="mx-auto flex w-full max-w-[760px] items-center gap-3 px-4 py-2.5 watch:px-3">
          <button
            type="button"
            onClick={() => navigate(home)}
            aria-label="返回"
            className="-ml-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text transition active:bg-surface-2 watch:h-8 watch:w-8"
          >
            <ArrowLeftIcon />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <LogoMark size={22} />
            <span className="truncate text-sm font-semibold text-text">
              <Wordmark /> 使用文档
            </span>
          </div>
          <a
            href={home}
            onClick={(event) => {
              event.preventDefault();
              navigate(home);
            }}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-text transition active:bg-surface-2 watch:px-2.5 watch:py-1 watch:text-[11px]"
          >
            {authenticated ? "回到应用" : "去登录"}
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-4 watch:px-3 watch:pb-10">
        <section className="hero-gradient relative overflow-hidden rounded-[26px] p-5 shadow-[var(--shadow-card)] watch:rounded-2xl watch:p-4">
          <span aria-hidden="true" className="absolute -top-14 -right-10 h-32 w-32 rounded-full bg-white/30" />
          <span aria-hidden="true" className="absolute -bottom-16 -left-8 h-28 w-28 rounded-full bg-white/20" />
          <div className="relative">
            <p className="text-[11px] font-semibold tracking-[0.18em] text-[color:var(--hero-fg)]/70 uppercase">
              gzspay guide
            </p>
            <h1 className="mt-1.5 text-[25px] leading-tight font-bold text-[color:var(--hero-fg)] watch:text-[21px]">
              校园收付款使用说明
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--hero-fg)]/85 watch:text-xs">
              从登录、收付款到商家收款与后台管理的完整说明，也可以直接把链接分享给同学。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-[color:var(--hero-chip)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--hero-fg)]">
                更新于 {GUIDE_UPDATED_AT}
              </span>
              <span className="inline-flex items-center rounded-full bg-[color:var(--hero-chip)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--hero-fg)]">
                共 {GUIDE_SECTIONS.length} 节
              </span>
            </div>
          </div>
        </section>

        <nav aria-label="文档目录" className="card mt-4 p-4 watch:mt-3 watch:p-3.5">
          <h2 className="text-sm font-semibold text-text">目录</h2>
          <ol className="mt-2 grid gap-1 sm:grid-cols-2">
            {GUIDE_SECTIONS.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-[13px] text-text transition hover:bg-surface-2 active:bg-surface-2 watch:gap-2 watch:py-1.5 watch:text-xs"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted">
                    {index + 1}
                  </span>
                  <span className="truncate">{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-6 space-y-6 watch:mt-5 watch:space-y-5">
          {GUIDE_SECTIONS.map((section, index) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-[12px] font-bold text-brand watch:h-6 watch:w-6 watch:text-[11px]">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h2 className="text-[17px] font-bold text-text watch:text-[15px]">{section.title}</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{section.summary}</p>
                </div>
              </div>
              <div className="mt-2.5 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] watch:p-3.5">
                <Markdown text={section.body} />
              </div>
            </section>
          ))}
        </div>

        <section className="card mt-6 p-5 text-center watch:mt-5 watch:p-4">
          <p className="text-sm font-semibold text-text">还有问题？</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            可以先查看左侧目录里的对应章节；仍无法解决请联系站点管理员，或在开源仓库提交 issue。
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="btn btn-outline btn-block gap-2">
              <GitHubIcon />
              开源仓库
            </a>
            <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(home)}>
              {authenticated ? "回到应用" : "去登录"}
            </button>
          </div>
        </section>

        <div className="mt-5 flex items-center justify-center gap-4 text-[11px] text-muted">
          <a href="#start" className="inline-flex items-center gap-1 hover:text-text">
            <ArrowUpIcon />
            回到目录
          </a>
          <span aria-hidden="true">·</span>
          <span>gzspay · 资金通过第三方收款码流转</span>
        </div>
        <div className="mt-3 flex justify-center">
          <SiteIcp className="text-[10px]" />
        </div>
      </main>
    </div>
  );
}
