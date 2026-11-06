/**
 * 全局渲染错误兜底。
 * 页面组件渲染时抛错会让 React 卸载整棵树、出现白屏；这里统一拦截并给出可操作的提示，
 * 不把异常信息、组件栈等内部细节展示给用户（只写控制台，便于排查）。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 只在开发/运维控制台保留细节，用户界面不展示
    console.error("[gzspay] 页面渲染出错", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleHome = (): void => {
    window.location.assign("/");
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="bg-app flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-danger-soft text-danger">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7.5v5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="16.4" r="1.1" fill="currentColor" />
          </svg>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-base font-semibold text-text">页面出了点问题</h1>
          <p className="max-w-[300px] text-sm leading-relaxed text-muted">
            刷新通常可以恢复，一直出现请联系管理员。
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={this.handleReload}>
            刷新页面
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={this.handleHome}>
            返回首页
          </button>
        </div>
      </div>
    );
  }
}
