#!/usr/bin/env node
/**
 * 构建期静态资源预压缩：为 `web/dist` 下的文本资源生成同名 `.br` 与 `.gz`。
 *
 * 为什么在构建期做：
 * - 服务端运行时压缩会占用事件循环/线程池，且每次冷启动都要重复算；
 * - Traefik / Nginx 反代默认不一定压缩，实测线上主包 377KB 原样传输；
 * - 预压缩后由 `server/src/lib/static-assets.ts` 按 `Accept-Encoding` 做内容协商。
 *
 * 用法：`node scripts/compress-dist.mjs [目录]`，默认 `web/dist`。
 * 由根 `package.json` 的 `build` 脚本在 `npm run build -w @gzspay/web` 之后自动调用。
 */
import { constants as zlibConstants, brotliCompressSync, gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_DIR = path.join(REPO_ROOT, "web", "dist");

/** 只压缩文本类资源，图片/字体/已压缩格式跳过 */
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

/** 小于 1KB 的文本压缩收益很低，跳过（与运行时阈值一致） */
const MIN_BYTES = 1024;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function compress(input, dir) {
  let raw;
  try {
    raw = readFileSync(input);
  } catch {
    return;
  }
  if (raw.length < MIN_BYTES) return;

  const br = brotliCompressSync(raw, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  const gz = gzipSync(raw, { level: 9 });

  // 压缩后反而更大（极小或已高度压缩的内容）就不要产物，避免白白多传
  const wroteBr = br.length < raw.length;
  const wroteGz = gz.length < raw.length;
  if (wroteBr) writeFileSync(`${input}.br`, br);
  if (wroteGz) writeFileSync(`${input}.gz`, gz);

  stats.files += 1;
  stats.rawBytes += raw.length;
  stats.brBytes += wroteBr ? br.length : raw.length;
  stats.gzBytes += wroteGz ? gz.length : raw.length;
  if (!quiet) {
    const rel = path.relative(dir, input).split(path.sep).join("/");
    console.log(
      `  ${rel}  ${formatBytes(raw.length)} → br ${wroteBr ? formatBytes(br.length) : "-"} / gz ${
        wroteGz ? formatBytes(gz.length) : "-"
      }`,
    );
  }
}

const quiet = process.argv.includes("--quiet");
const target = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const dir = path.resolve(target ?? DEFAULT_DIR);

const stats = { files: 0, rawBytes: 0, brBytes: 0, gzBytes: 0 };

if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`[compress-dist] 目录不存在：${dir}`);
  console.error("[compress-dist] 请先执行 npm run build -w @gzspay/web");
  process.exit(1);
}

console.log(`[compress-dist] 预压缩 ${dir}`);
for (const file of walk(dir)) {
  if (!COMPRESSIBLE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
  compress(file, dir);
}

if (stats.files === 0) {
  console.log("[compress-dist] 没有找到可压缩的文本资源");
  process.exit(0);
}

const ratio = (value) => `${((value / stats.rawBytes) * 100).toFixed(1)}%`;
console.log(
  `[compress-dist] 完成：${stats.files} 个文件，原始 ${formatBytes(stats.rawBytes)} → br ${formatBytes(
    stats.brBytes,
  )} (${ratio(stats.brBytes)}) / gzip ${formatBytes(stats.gzBytes)} (${ratio(stats.gzBytes)})`,
);
