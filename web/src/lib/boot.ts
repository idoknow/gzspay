/** 启动加载：统计真实加载字节（fetch + ReadableStream）+ 会话检查。 */

import { ApiError } from "./http";
import type { SessionResponse } from "./types";

/** 最少停留时间，避免进度条一闪而过 */
const MIN_DURATION_MS = 600;

export interface BootProgress {
  /** 已加载字节 */
  loaded: number;
  /** 预计总字节（未知时为 0） */
  total: number;
  /** 0..1 进度（总字节未知时为 0，界面显示为不确定进度） */
  ratio: number;
}

export interface BootOptions {
  onProgress?: (progress: BootProgress) => void;
  minDurationMs?: number;
}

export interface BootResult {
  session: SessionResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** 收集需要预加载并计入进度的同源资源（核心 JS/CSS/图标/清单） */
function collectResourceUrls(): string[] {
  const origin = window.location.origin;
  const urls = new Set<string>();
  const consider = (raw: string | null | undefined): void => {
    if (!raw) return;
    try {
      const url = new URL(raw, origin);
      if (url.origin !== origin) return;
      urls.add(url.href);
    } catch {
      // 非法 URL 直接忽略
    }
  };

  for (const script of document.querySelectorAll<HTMLScriptElement>("script[src]")) {
    consider(script.src);
  }
  for (const link of document.querySelectorAll<HTMLLinkElement>("link[href]")) {
    const rel = link.rel.toLowerCase();
    if (
      rel === "stylesheet" ||
      rel === "modulepreload" ||
      rel === "preload" ||
      rel === "manifest" ||
      rel === "icon" ||
      rel === "apple-touch-icon"
    ) {
      consider(link.href);
    }
  }
  // 启动页会展示的 logo 与图标也计入加载进度
  consider("/logo.svg");
  consider("/icons/icon-192.png");
  consider("/fonts/nunito-latin.woff2");

  return [...urls];
}

type ByteSink = (loadedDelta: number, totalDelta: number) => void;

/** 读取响应体并统计字节；解压后长度未知时在结束时一次性计入 */
async function readBytesWithProgress(response: Response, sink: ByteSink): Promise<Uint8Array> {
  const header = response.headers.get("content-length");
  const declaredTotal = header ? Number(header) : Number.NaN;
  const hasDeclared = Number.isFinite(declaredTotal) && declaredTotal > 0;

  if (hasDeclared) sink(0, declaredTotal);

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    sink(buffer.byteLength, hasDeclared ? 0 : buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    loaded += value.byteLength;
    if (hasDeclared) sink(value.byteLength, 0);
  }

  if (!hasDeclared) sink(loaded, loaded);

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** 预加载单个资源；资源失败不阻塞启动（重试一次） */
async function loadResource(url: string, sink: ByteSink): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "default" });
      // 404/500 等资源错误不计入进度，也不影响启动
      if (!response.ok) return;
      await readBytesWithProgress(response, sink);
      return;
    } catch {
      if (attempt === 1) return;
    }
  }
}

/** 会话检查：读取字节并解析登录态 */
async function checkSession(sink: ByteSink): Promise<SessionResponse> {
  const response = await fetch("/api/auth/session", {
    credentials: "same-origin",
    headers: { "X-Requested-With": "gzspay" },
  });
  const bytes = await readBytesWithProgress(response, sink);

  if (response.status === 401) {
    return { authenticated: false };
  }
  if (!response.ok) {
    throw new ApiError(response.status, "SESSION_FAILED", `会话检查失败（${response.status}），请重试`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ApiError(500, "SESSION_INVALID", "会话响应异常，请重试");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ApiError(500, "SESSION_INVALID", "会话响应异常，请重试");
  }
  return parsed as SessionResponse;
}

/** 执行启动加载：资源字节进度 + 会话检查 + 最少停留时间 */
export async function runBoot(options: BootOptions = {}): Promise<BootResult> {
  const startedAt = performance.now();
  let loaded = 0;
  let total = 0;
  const report = (): void => {
    options.onProgress?.({
      loaded,
      total,
      ratio: total > 0 ? Math.min(1, loaded / total) : 0,
    });
  };
  const sink: ByteSink = (loadedDelta, totalDelta) => {
    loaded += loadedDelta;
    total += totalDelta;
    report();
  };
  report();

  const urlList = collectResourceUrls();
  // 同步先“登记”未知资源的数量，保证进度条不会一开始就是 100%
  if (urlList.length > 0 && total === 0) {
    total = urlList.length;
    report();
  }

  const assetsTask = Promise.all(urlList.map((url) => loadResource(url, sink)));
  const sessionTask = checkSession(sink);

  const [, session] = await Promise.all([assetsTask, sessionTask]);

  const elapsed = performance.now() - startedAt;
  const minimum = options.minDurationMs ?? MIN_DURATION_MS;
  if (elapsed < minimum) {
    await sleep(minimum - elapsed);
  }
  report();

  return { session };
}

/** 判断当前会话是否需要进入引导流程 */
export function needsOnboarding(session: SessionResponse): boolean {
  if (!session.authenticated) return false;
  if (session.me?.onboarded) return false;
  const step = session.me?.onboardStep ?? session.onboardStep;
  return step !== "done";
}
