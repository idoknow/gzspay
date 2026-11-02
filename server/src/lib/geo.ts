// IP 归属地判断 + 「仅允许中国大陆访问」中间件（零依赖实现）。
//
// 数据：server/assets/cn-ip-ranges.json，由 scripts/geo/build-cn-ranges.mjs 从
// APNIC 的 delegated-apnic-latest 生成（只含 CN 注册的 IPv4 / IPv6 段）。
// 因此这里能明确回答「是中国大陆」或「不在数据里」，无法给出具体国家码；
// 需要更精细的国家判断时应换成商业 IP 库（见 docs/deploy.md）。
import { readFileSync } from "node:fs";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "../config.js";

interface GeoRangeData {
  updatedAt?: string;
  source?: string;
  ipv4?: [number, number][];
  ipv6?: string[];
}

interface Ipv6Prefix {
  words: number[];
  length: number;
}

const DATA_URL = new URL("../../assets/cn-ip-ranges.json", import.meta.url);

/** 私有 / 回环 / 链路本地地址：不可能是境外用户，始终放行 */
const ALWAYS_ALLOWED_CIDRS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "100.64.0.0/10",
  "0.0.0.0/8",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

/** 默认例外路径：健康检查、PWA 与开屏需要用到的静态请求 */
export const DEFAULT_BYPASS_PATHS = [
  "/api/health",
  "/theme-boot.js",
  "/sw.js",
  "/manifest.webmanifest",
  "/favicon.ico",
];

export const BLOCKED_MESSAGE = "当前地区暂不支持访问";

interface ParsedIp {
  family: 4 | 6;
  value: bigint;
}

function ipv4ToInt(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** 把 IPv6 文本展开成 8 个 16 位分组；支持 `::` 缩写与末尾内嵌 IPv4 */
function expandIpv6(input: string): number[] | null {
  let text = input.trim().toLowerCase();
  const zoneIndex = text.indexOf("%");
  if (zoneIndex >= 0) text = text.slice(0, zoneIndex);
  if (!text.includes(":")) return null;

  const v4Match = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4Match) {
    const v4 = ipv4ToInt(v4Match[1] ?? "");
    if (v4 === null) return null;
    const high = Math.floor(v4 / 65536).toString(16);
    const low = (v4 % 65536).toString(16);
    text = `${text.slice(0, v4Match.index)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 && fill !== 0) return null;
  if (fill < 0) return null;
  const groups = [...head, ...new Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;

  const words: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    words.push(Number.parseInt(group, 16));
  }
  return words;
}

/** 解析 IP（兼容 IPv4、IPv6、`::ffff:` 映射与端口格式） */
export function parseIp(input: string): ParsedIp | null {
  let text = input.trim();
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end < 0) return null;
    text = text.slice(1, end);
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  const v4 = ipv4ToInt(mapped ? (mapped[1] ?? "") : text);
  if (v4 !== null) return { family: 4, value: BigInt(v4) };
  const words = expandIpv6(text);
  if (!words) return null;
  let value = 0n;
  for (const word of words) value = (value << 16n) | BigInt(word);
  return { family: 6, value };
}

interface Cidr {
  base: ParsedIp;
  length: number;
}

export function parseCidr(input: string): Cidr | null {
  const text = input.trim();
  if (!text) return null;
  const [address, lengthText] = text.split("/");
  const base = parseIp(address ?? "");
  if (!base) return null;
  const maxLength = base.family === 4 ? 32 : 128;
  const length = lengthText === undefined || lengthText === "" ? maxLength : Number(lengthText);
  if (!Number.isInteger(length) || length < 0 || length > maxLength) return null;
  return { base, length };
}

export function ipInCidr(ip: ParsedIp, cidr: Cidr): boolean {
  if (ip.family !== cidr.base.family) return false;
  const totalBits = ip.family === 4 ? 32 : 128;
  if (cidr.length === 0) return true;
  const shift = BigInt(totalBits - cidr.length);
  const mask = ((1n << BigInt(cidr.length)) - 1n) << shift;
  return (ip.value & mask) === (cidr.base.value & mask);
}

export function isPrivateOrLoopback(ip: ParsedIp): boolean {
  return ALWAYS_ALLOWED_CIDRS.some((item) => {
    const cidr = parseCidr(item);
    return cidr !== null && ipInCidr(ip, cidr);
  });
}

let geoData: GeoRangeData | null = null;
let geoLoadError: string | null = null;
let ipv4Ranges: [number, number][] = [];
let ipv6Prefixes: Ipv6Prefix[] = [];

function loadGeoData(): GeoRangeData | null {
  if (geoData || geoLoadError) return geoData;
  try {
    const raw = readFileSync(DATA_URL, "utf-8");
    const parsed = JSON.parse(raw) as GeoRangeData;
    ipv4Ranges = Array.isArray(parsed.ipv4)
      ? parsed.ipv4
          .filter((item): item is [number, number] => Array.isArray(item) && item.length === 2)
          .map(([start, end]) => [start, end] as [number, number])
          .sort((a, b) => a[0] - b[0])
      : [];
    ipv6Prefixes = Array.isArray(parsed.ipv6)
      ? parsed.ipv6
          .map((text) => {
            const cidr = parseCidr(text);
            if (!cidr || cidr.base.family !== 6) return null;
            const words = expandIpv6(text.split("/")[0] ?? "") ?? [];
            return { words, length: cidr.length };
          })
          .filter((item): item is Ipv6Prefix => item !== null)
      : [];
    geoData = parsed;
  } catch (cause) {
    geoLoadError = cause instanceof Error ? cause.message : String(cause);
  }
  return geoData;
}

/** 数据文件是否已成功加载（启动时用于打印日志） */
export function isGeoDataLoaded(): boolean {
  loadGeoData();
  return geoData !== null;
}

export function geoDataError(): string | null {
  loadGeoData();
  return geoLoadError;
}

export function geoDataMeta(): { updatedAt: string | null; source: string | null; ipv4Count: number; ipv6Count: number } {
  loadGeoData();
  return {
    updatedAt: geoData?.updatedAt ?? null,
    source: geoData?.source ?? null,
    ipv4Count: ipv4Ranges.length,
    ipv6Count: ipv6Prefixes.length,
  };
}

function inIpv4Ranges(value: number): boolean {
  let low = 0;
  let high = ipv4Ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ipv4Ranges[middle];
    if (!range) return false;
    if (value < range[0]) high = middle - 1;
    else if (value > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

function isInChina(ip: ParsedIp): boolean {
  if (ip.family === 4) return inIpv4Ranges(Number(ip.value));
  return ipv6Prefixes.some((prefix) => {
    const totalBits = 128;
    const fullWords = prefix.length >> 4;
    for (let index = 0; index < fullWords; index += 1) {
      const word = Number((ip.value >> BigInt((totalBits - 16 * (index + 1)))) & 0xffffn);
      if (word !== prefix.words[index]) return false;
    }
    const rest = prefix.length % 16;
    if (rest === 0) return true;
    const shift = BigInt(16 - rest);
    const mask = (1n << BigInt(rest)) - 1n;
    const word = Number((ip.value >> BigInt(totalBits - 16 * (fullWords + 1))) & 0xffffn);
    const expected = prefix.words[fullWords] ?? 0;
    return ((BigInt(word) >> shift) & mask) === ((BigInt(expected) >> shift) & mask);
  });
}

const COUNTRY_ALIASES: Record<string, string> = {
  CN: "CN",
  CHN: "CN",
  "CN-": "CN",
};

function normalizeCountry(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim().toUpperCase();
  if (!text) return null;
  if (["XX", "T1", "A1", "A2", "O1"].includes(text)) return null;
  return COUNTRY_ALIASES[text] ?? text;
}

/**
 * 判断 IP 是否属于中国大陆。
 * 返回 true / false；解析失败或数据缺失时返回 null（调用方按未知归属处理）。
 */
export function isChinaMainlandIp(rawIp: string): boolean | null {
  if (!loadGeoData()) return null;
  const ip = parseIp(rawIp);
  if (!ip) return null;
  if (isPrivateOrLoopback(ip)) return true;
  return isInChina(ip);
}

function matchesBypassPath(pathname: string, entry: string): boolean {
  if (entry.endsWith("*")) return pathname.startsWith(entry.slice(0, -1));
  if (entry.endsWith("/")) return pathname.startsWith(entry);
  return pathname === entry;
}

function parseIpWhitelist(value: string): Cidr[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseCidr(item))
    .filter((item): item is Cidr => item !== null);
}

function splitWhitelist(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 白名单解析结果按原始字符串缓存：后台配置变化时键也会变 */
let whitelistCache: { key: string; value: Cidr[] } | null = null;

function whitelistFrom(values: string[]): Cidr[] {
  const key = values.join(",");
  if (whitelistCache && whitelistCache.key === key) return whitelistCache.value;
  const value = parseIpWhitelist(key);
  whitelistCache = { key, value };
  return value;
}

/** 阻断日志节流：同一 IP 10 分钟内只打印一次，避免被刷日志 */
const warnedIps = new Map<string, number>();
const WARN_WINDOW_MS = 10 * 60 * 1000;

function warnBlocked(ip: string, logger: (message: string) => void): void {
  const now = Date.now();
  for (const [key, at] of warnedIps) {
    if (now - at > WARN_WINDOW_MS) warnedIps.delete(key);
  }
  if (warnedIps.has(ip)) return;
  if (warnedIps.size >= 500) warnedIps.clear();
  warnedIps.set(ip, now);
  logger(`[gzspay] 已拦截非中国大陆 IP 访问：${ip}`);
}

export interface GeoGuardResolved {
  /** 是否启用；默认读 GEO_BLOCK_NON_CHINA 或后台配置 */
  enabled?: boolean;
  /** 允许的国家码，默认 CN */
  allowedCountry?: string;
  /** 例外路径：精确匹配，或以 `/` / `*` 结尾表示前缀匹配 */
  bypassPaths?: string[];
  /** 白名单 IP / CIDR */
  whitelist?: string[];
  /** 归属未知时的策略：deny = 拦截（推荐），allow = 放行 */
  unknownPolicy?: "deny" | "allow";
  /** CDN 提供的国家码请求头（如 CF-IPCountry）；仅回源可信时启用 */
  trustHeader?: string | null;
}

export interface GeoGuardOptions extends GeoGuardResolved {
  /** 每请求读取最新配置（后台改完立即生效）；不提供时使用上面的静态值 */
  resolve?: () => GeoGuardResolved;
  /** 归属查询注入，便于测试 */
  lookup?: (ip: string) => string | null;
  logger?: (message: string) => void;
}

const BLOCKED_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>当前地区暂不支持访问</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f5f5f2;color:#1c1c1a;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.card{max-width:360px;padding:32px 26px;border-radius:20px;background:#fff;
box-shadow:0 18px 48px -28px rgba(0,0,0,.35);text-align:center}
h1{margin:0 0 10px;font-size:17px}
p{margin:0;font-size:13px;line-height:1.7;color:#6b6b66}
</style></head>
<body><div class="card"><h1>当前地区暂不支持访问</h1>
<p>本站目前只对中国大陆地区开放。如果你已在大陆网络下访问，可能是网络出口被识别为境外，请更换网络后重试。</p>
</div></body></html>`;

/**
 * 创建「仅允许中国大陆访问」中间件。
 * 默认关闭；开关与白名单等可来自环境变量（默认值），也可通过 `resolve`
 * 每请求读取后台配置，做到保存后立即生效。
 */
export function createGeoGuard(options: GeoGuardOptions = {}): RequestHandler {
  const lookup = options.lookup ?? defaultLookup;
  const logger = options.logger ?? ((message: string) => console.warn(message));

  return function geoGuard(req: Request, res: Response, next: NextFunction): void {
    const current = options.resolve ? options.resolve() : options;
    const enabled = current.enabled ?? config.geo.blockNonChina;
    if (!enabled) {
      next();
      return;
    }
    const allowedCountry = normalizeCountry(current.allowedCountry ?? "CN") ?? "CN";
    const bypassPaths = current.bypassPaths ?? config.geo.bypassPaths;
    const whitelist = whitelistFrom(
      current.whitelist ?? splitWhitelist(config.geo.ipWhitelist),
    );
    const unknownPolicy =
      current.unknownPolicy ?? (config.geo.unknownPolicy === "allow" ? "allow" : "deny");
    const trustHeader =
      current.trustHeader !== undefined ? current.trustHeader : config.geo.trustHeader || null;

    const pathname = req.path;
    if (bypassPaths.some((entry) => matchesBypassPath(pathname, entry))) {
      next();
      return;
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? "";
    const parsed = parseIp(ip);
    if (parsed && isPrivateOrLoopback(parsed)) {
      next();
      return;
    }
    if (parsed && whitelist.some((cidr) => ipInCidr(parsed, cidr))) {
      next();
      return;
    }

    const headerCountry = trustHeader ? normalizeCountry(req.header(trustHeader)) : null;
    const country = headerCountry ?? (ip ? lookup(ip) : null);
    if (country !== null && country === allowedCountry) {
      next();
      return;
    }
    if (country === null && unknownPolicy === "allow") {
      next();
      return;
    }

    warnBlocked(ip || "unknown", logger);
    geoStats.blockedCount += 1;
    geoStats.lastBlockedAt = new Date().toISOString();
    geoStats.lastBlockedIp = ip || null;
    // 打标记：由访问统计中间件统一记录「地区拦截」次数（避免与 traffic 循环依赖）
    res.locals.regionBlocked = true;
    res.setHeader("Cache-Control", "no-store");
    if (pathname.startsWith("/api/") || req.accepts(["json", "html"]) === "json") {
      res.status(403).json({ error: { code: "REGION_BLOCKED", message: BLOCKED_MESSAGE } });
      return;
    }
    res.status(403).type("html").send(BLOCKED_HTML);
  };
}

function defaultLookup(ip: string): string | null {
  const china = isChinaMainlandIp(ip);
  if (china === null) return null;
  return china ? "CN" : null;
}

const geoStats = {
  blockedCount: 0,
  lastBlockedAt: null as string | null,
  lastBlockedIp: null as string | null,
};

/** 供启动日志 / 后台排查使用 */
export function geoStatus(): {
  enabled: boolean;
  dataUpdatedAt: string | null;
  ipv4Count: number;
  ipv6Count: number;
  blockedCount: number;
  lastBlockedAt: string | null;
} {
  const meta = geoDataMeta();
  return {
    enabled: config.geo.blockNonChina,
    dataUpdatedAt: meta.updatedAt,
    ipv4Count: meta.ipv4Count,
    ipv6Count: meta.ipv6Count,
    blockedCount: geoStats.blockedCount,
    lastBlockedAt: geoStats.lastBlockedAt,
  };
}

/** 测试用：重置内存计数与节流 */
export function resetGeoStats(): void {
  geoStats.blockedCount = 0;
  geoStats.lastBlockedAt = null;
  geoStats.lastBlockedIp = null;
  warnedIps.clear();
}
