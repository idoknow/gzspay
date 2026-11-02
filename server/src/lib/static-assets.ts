import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { createGzip } from "node:zlib";
import type { NextFunction, Request, Response } from "express";

/**
 * 前端静态资源托管：优先发送构建期预压缩的 `.br` / `.gz` 变体。
 *
 * 背景：Express 的 `express.static` 不会压缩，Traefik / Nginx 反代默认也不一定压缩，
 * 结果 377KB 的主包原样传输，首屏要多等几百毫秒到数秒。前端构建时用
 * `scripts/compress-dist.mjs` 生成同名 `.br` / `.gz`，这里按 `Accept-Encoding` 选最省流量的版本。
 */

/** 需要压缩的文本类型（按扩展名判断，避免压缩已压缩的图片/字体） */
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".webmanifest",
  ".svg",
  ".txt",
  ".xml",
  ".map",
]);

/** 小于这个体积不值得压缩（压缩后几乎不会变小，还浪费一次传输协商） */
const MIN_COMPRESS_BYTES = 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
};

interface AssetVariant {
  /** 原文件状态（用于 ETag 与 Content-Length） */
  size: number;
  mtimeMs: number;
  etag: string;
  /** 预压缩变体是否存在 */
  br: boolean;
  gz: boolean;
}

/** 预压缩文件是否存在按绝对路径缓存，避免每个请求都 stat 三次；mtime 变化时失效（本地重新构建） */
const variantCache = new Map<string, AssetVariant>();

function readVariant(filePath: string): AssetVariant | null {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    variantCache.delete(filePath);
    return null;
  }
  if (!stat.isFile()) return null;
  const cached = variantCache.get(filePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached;
  const hasFile = (suffix: string): boolean => {
    try {
      return statSync(filePath + suffix).isFile();
    } catch {
      return false;
    }
  };
  const variant: AssetVariant = {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    etag: `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`,
    br: hasFile(".br"),
    gz: hasFile(".gz"),
  };
  variantCache.set(filePath, variant);
  if (variantCache.size > 2000) variantCache.clear();
  return variant;
}

/** 解析客户端接受哪种压缩：br 优先，其次 gzip；q=0 视为拒绝 */
export function pickEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
  if (typeof acceptEncoding !== "string" || !acceptEncoding) return null;
  const accepted = new Map<string, number>();
  for (const part of acceptEncoding.toLowerCase().split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName?.trim();
    if (!name) continue;
    let quality = 1;
    for (const param of params) {
      const [key, value] = param.trim().split("=");
      if (key === "q") {
        const parsed = Number(value);
        quality = Number.isFinite(parsed) ? parsed : 1;
      }
    }
    accepted.set(name, quality);
  }
  const wildcard = accepted.get("*");
  const qualityOf = (name: string): number => accepted.get(name) ?? wildcard ?? 0;
  if (qualityOf("br") > 0) return "br";
  if (qualityOf("gzip") > 0) return "gzip";
  return null;
}

function isCompressible(filePath: string): boolean {
  return COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (typeof header !== "string" || !header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((value) => value.trim() === etag);
}

export interface SendAssetOptions {
  /** 自定义 Cache-Control；不传则按 immutable 前缀与文件名推断 */
  cacheControl?: string;
  /** 命中这些路径前缀（如 `/assets/`）时使用一年强缓存 */
  immutablePrefixes?: string[];
  /** 没有预压缩文件时是否即时 gzip（兜底，正常构建产物都应该有） */
  onTheFlyGzip?: boolean;
}

function cacheControlOf(filePath: string, root: string, fileUrlPath: string, options: SendAssetOptions): string {
  if (options.cacheControl) return options.cacheControl;
  const prefixes = options.immutablePrefixes ?? ["/assets/"];
  if (prefixes.some((prefix) => fileUrlPath.startsWith(prefix))) {
    return "public, max-age=31536000, immutable";
  }
  const base = path.basename(filePath);
  if (base === "index.html") return "no-cache";
  return "public, max-age=3600";
}

/**
 * 发送单个静态文件：自动在 `.br` / `.gz` 与原始文件之间选择，并处理 ETag / 304 / HEAD。
 * 文件不存在或不是文件时交给下一个中间件。
 */
export function sendAsset(
  req: Request,
  res: Response,
  next: NextFunction,
  filePath: string,
  fileUrlPath: string,
  options: SendAssetOptions = {},
): void {
  const variant = readVariant(filePath);
  if (!variant) {
    next();
    return;
  }
  const cacheControl = cacheControlOf(filePath, path.dirname(filePath), fileUrlPath, options);
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("ETag", variant.etag);
  // 304 只比较 ETag，避免把完整文件再传一遍
  if (matchesEtag(req.headers["if-none-match"], variant.etag)) {
    res.status(304).end();
    return;
  }

  const encoding = isCompressible(filePath) ? pickEncoding(req.headers["accept-encoding"]) : null;
  const useBr = encoding === "br" && variant.br;
  const useGz = encoding === "gzip" && variant.gz;
  const useOnTheFly = !encoding ? false : !useBr && !useGz && encoding === "gzip" && options.onTheFlyGzip !== false;

  res.setHeader("Content-Type", CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream");
  if (useBr || useGz || useOnTheFly) {
    res.setHeader("Vary", "Accept-Encoding");
  }

  if (useBr || useGz) {
    const compressedPath = filePath + (useBr ? ".br" : ".gz");
    const compressedSize = statSync(compressedPath).size;
    res.setHeader("Content-Encoding", useBr ? "br" : "gzip");
    res.setHeader("Content-Length", String(compressedSize));
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    const stream = createReadStream(compressedPath);
    stream.on("error", (error) => {
      if (!res.headersSent) {
        next(error);
        return;
      }
      res.destroy(error);
    });
    stream.pipe(res);
    return;
  }

  if (useOnTheFly && variant.size >= MIN_COMPRESS_BYTES) {
    res.setHeader("Content-Encoding", "gzip");
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    const stream = createReadStream(filePath);
    const gzipStream = createGzip({ level: 6 });
    stream.on("error", (error) => {
      if (!res.headersSent) {
        next(error);
        return;
      }
      res.destroy(error);
    });
    gzipStream.on("error", (error) => {
      if (!res.headersSent) {
        next(error);
        return;
      }
      res.destroy(error);
    });
    stream.pipe(gzipStream).pipe(res);
    return;
  }

  res.setHeader("Content-Length", String(variant.size));
  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on("error", (error) => {
    if (!res.headersSent) {
      next(error);
      return;
    }
    res.destroy(error);
  });
  stream.pipe(res);
}

/**
 * 静态资源中间件：只处理 GET/HEAD，路径解析做目录穿越防护，
 * 命中文件后交给 sendAsset 完成压缩协商；未命中交给后续中间件（SPA 兜底）。
 */
export function createStaticAssets(
  rootDir: string,
  options: SendAssetOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const root = path.resolve(rootDir);
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(req.path);
    } catch {
      next();
      return;
    }
    if (decoded.includes("\0")) {
      next();
      return;
    }
    // 不直接暴露预压缩文件本身（真正的传输由内容协商完成）
    if (decoded.endsWith(".br") || decoded.endsWith(".gz")) {
      res.status(404).type("text/plain; charset=utf-8").send("Not Found");
      return;
    }
    const relative = decoded.replace(/^\/+/, "").split("/").filter(Boolean).join(path.sep);
    const filePath = path.join(root, relative);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      next();
      return;
    }
    if (relative === "") {
      next();
      return;
    }
    sendAsset(req, res, next, filePath, req.path, options);
  };
}
