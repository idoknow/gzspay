/** 入口：应用主题、挂载 React、移除首帧兜底启动屏、生产环境注册 Service Worker。 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { ContextMenuProvider } from "./components/ContextMenu";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import { initTheme } from "./lib/theme";

// index.html 已做首帧主题兜底，这里再与本地存储对齐一次
initTheme();

// 兜底：没被业务捕获的异步错误只写控制台，避免浏览器把原始错误直接暴露在页面上
window.addEventListener("unhandledrejection", (event) => {
  console.error("[gzspay] 未处理的异步错误", event.reason);
  event.preventDefault();
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到 #root 挂载节点");
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <ContextMenuProvider>
          <App />
        </ContextMenuProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// React 挂载后移除 index.html 里的首帧启动屏（等待两帧避免闪白）
const splash = document.getElementById("boot-splash");
if (splash) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      splash.remove();
    });
  });
}

// 仅生产环境注册 Service Worker（开发态避免缓存干扰）
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败不影响主流程
    });
  });
}
