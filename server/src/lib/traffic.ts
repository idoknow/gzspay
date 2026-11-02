// 访问统计：把请求维度（路由、状态码、设备、地区）、扫码与安全防护事件
// 按「天 + 类型 + 名称」聚合成计数，内存里攒一批再批量写入 traffic_counters。
//
// 设计取舍：
// - 只存聚合计数，不存原始 IP / UA，避免把个人信息写进统计表；
// - 路由名会做归一化（UUID、数字、长令牌替换成 :id，未知接口归入「其他接口」），
//   防止扫描器制造无限多的维度把表撑大；
// - 写入失败不影响业务请求（统计永远是可选的旁路）。
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "../config.js";
import { queryAll, runBatch } from "../db/index.js";
import { isChinaMainlandIp, isPrivateOrLoopback, parseIp } from "./geo.js";

export type TrafficKind =
  | "route"
  | "status"
  | "device"
  | "browser"
  | "os"
  | "region"
  | "scan"
  | "security";

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 300;
const MAX_BUFFER_KEYS = 4000;
const MAX_NAME_LENGTH = 120;
const KEY_SEPARATOR = "\u0000";

interface BufferEntry {
  day: string;
  kind: TrafficKind;
  name: string;
  count: number;
}

let buffer = new Map<string, BufferEntry>();
let timer: NodeJS.Timeout | null = null;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 服务器本地时区的日期键（与交易统计的桶保持一致） */
export function dayKeyOf(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 记录一次计数（默认 +1） */
export function recordTraffic(kind: TrafficKind, name: string, count = 1): void {
  if (!Number.isFinite(count) || count <= 0) return;
  const safeName = typeof name === "string" ? name.trim().slice(0, MAX_NAME_LENGTH) : "";
  if (!safeName) return;
  const day = dayKeyOf();
  const key = `${day}${KEY_SEPARATOR}${kind}${KEY_SEPARATOR}${safeName}`;
  const existing = buffer.get(key);
  if (existing) {
    existing.count += count;
  } else {
    if (buffer.size >= MAX_BUFFER_KEYS) flushTrafficCounters();
    buffer.set(key, { day, kind, name: safeName, count });
  }
  if (buffer.size >= FLUSH_THRESHOLD) {
    flushTrafficCounters();
    return;
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setInterval(() => {
    flushTrafficCounters();
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

/** 立即把缓冲区写入数据库（定时器、进程退出前调用） */
export function flushTrafficCounters(): void {
  if (buffer.size === 0) return;
  const pending = [...buffer.values()];
  buffer = new Map();
  try {
    const now = new Date().toISOString();
    runBatch(
      pending.map((entry) => ({
        sql: `INSERT INTO traffic_counters (day, kind, name, count, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(day, kind, name) DO UPDATE SET count = count + excluded.count, updated_at = excluded.updated_at`,
        params: [entry.day, entry.kind, entry.name, entry.count, now],
      })),
    );
  } catch {
    // 统计写入失败不影响业务
  }
}

/** 测试用：清空缓冲区与定时器 */
export function resetTrafficCountersForTest(): void {
  buffer = new Map();
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 清理过期统计（保留最近 retentionDays 天） */
export function pruneTrafficCounters(retentionDays = 400): void {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const day = dayKeyOf(cutoff);
  try {
    runBatch([
      {
        sql: "DELETE FROM traffic_counters WHERE day < ?",
        params: [day],
      },
    ]);
  } catch {
    // 清理失败不影响业务
  }
}

/* ------------------------------------------------------------ 客户端识别 */

export type DeviceKind = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export interface ClientInfo {
  device: DeviceKind;
  browser: string;
  os: string;
}

const BOT_PATTERN =
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headlesschrome|phantomjs|python-requests|python-urllib|aiohttp|curl\/|wget\/|go-http-client|java\/|okhttp|axios\/|node-fetch|libwww/i;

const DEVICE_LABELS: Record<DeviceKind, string> = {
  desktop: "电脑",
  mobile: "手机",
  tablet: "平板",
  bot: "机器人",
  unknown: "未知",
};

export function deviceLabel(kind: DeviceKind | string): string {
  return DEVICE_LABELS[kind as DeviceKind] ?? "未知";
}

/** 根据 User-Agent 粗略识别设备类型、浏览器与操作系统（只用于统计） */
export function classifyUserAgent(userAgent: string | null | undefined): ClientInfo {
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (!ua.trim()) return { device: "unknown", browser: "未知", os: "未知" };
  if (BOT_PATTERN.test(ua)) {
    return { device: "bot", browser: "爬虫/脚本", os: "未知" };
  }
  const isTablet = /ipad|tablet|playbook|silk|kindle/i.test(ua) && !/mobile/i.test(ua);
  const isMobile = !isTablet && /android|iphone|ipod|mobile|harmonyos|windows phone/i.test(ua);
  const device: DeviceKind = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let browser = "其他";
  if (/micromessenger/i.test(ua)) browser = "微信";
  else if (/\bqq\//i.test(ua) || /qqbrowser/i.test(ua)) browser = "QQ 浏览器";
  else if (/edg\//i.test(ua) || /edga\//i.test(ua) || /edgios\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/crios|chrome|chromium/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua)) browser = "Safari";
  else if (/msie|trident/i.test(ua)) browser = "IE";

  let os = "其他";
  if (/harmonyos/i.test(ua)) os = "HarmonyOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  return { device, browser, os };
}

/* ------------------------------------------------------------ 地区识别 */

/** 把 IP 归类成统计用的地区名（只到国家/地区粒度，不保存 IP） */
export function classifyRegion(rawIp: string | null | undefined, countryHeader?: string | null): string {
  const ip = typeof rawIp === "string" ? rawIp : "";
  const parsed = parseIp(ip);
  if (!parsed) return "未知";
  if (isPrivateOrLoopback(parsed)) return "本机/内网";
  const header = typeof countryHeader === "string" ? countryHeader.trim().toUpperCase() : "";
  if (header && !["XX", "T1", "A1", "A2", "O1"].includes(header)) {
    if (header === "CN" || header === "CHN") return "中国大陆";
    return header;
  }
  const china = isChinaMainlandIp(ip);
  if (china === true) return "中国大陆";
  if (china === false) return "境外（未识别国家）";
  return "未知";
}

/** 读取请求头里的国家码（仅在配置了 GEO_TRUST_HEADER 时生效） */
export function countryHeaderOf(headers: Record<string, unknown>): string | null {
  const name = config.geo.trustHeader;
  if (!name) return null;
  const value = headers[name.toLowerCase()];
  return typeof value === "string" ? value : null;
}

/* ------------------------------------------------------------ 路由归一化 */

/** 已知的 /api 一级路径：未知路径统一归入「其他接口」，避免维度爆炸 */
const API_ROOTS = new Set([
  "health",
  "about",
  "announcements",
  "events",
  "setup",
  "auth",
  "onboarding",
  "me",
  "merchant",
  "orders",
  "scan",
  "dynamic-code",
  "stats",
  "admin",
]);

const PAGE_ROOTS = new Set([
  "",
  "login",
  "guide",
  "onboarding",
  "trades",
  "announcements",
  "orders",
  "pay",
  "dynamic-code",
  "me",
  "merchant",
  "admin",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 长随机串（令牌、哈希）：字母数字下划线短横线，长度 >= 20 且至少含一位数字，避免误伤 payment-password 这类路径词 */
const TOKEN_PATTERN = /^(?=.*\d)[A-Za-z0-9_-]{20,}$/;

function normalizeSegment(segment: string): string {
  if (!segment) return segment;
  if (UUID_PATTERN.test(segment)) return ":id";
  if (/^\d+$/.test(segment)) return ":id";
  if (TOKEN_PATTERN.test(segment)) return ":id";
  return segment;
}

/** 把请求路径归一化成稳定的统计维度名，例如 `GET /api/orders/:id` */
export function normalizeRoute(method: string, pathname: string): string {
  const verb = method.toUpperCase();
  const path = pathname || "/";
  if (path === "/" || path === "") return `${verb} 页面 首页`;
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "api") {
    const root = segments[1] ?? "";
    if (!API_ROOTS.has(root)) return `${verb} /api/其他接口`;
    const rest = segments.slice(1, 6).map(normalizeSegment).join("/");
    return `${verb} /api/${rest}`;
  }
  const page = segments[0] ?? "";
  if (!PAGE_ROOTS.has(page)) return `${verb} 页面 其他`;
  return `${verb} 页面 /${page}`;
}

/* ------------------------------------------------------------ 中间件 */

const SKIP_PREFIXES = ["/media/", "/assets/", "/api/events/stream"];

function shouldSkip(pathname: string): boolean {
  return SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * 访问统计中间件：在响应结束时记录路由、状态码、设备、地区与安全防护次数。
 * 必须挂在地区限制 / 扫描器拦截之前，这样被拦截的请求也能统计到。
 */
export function createTrafficMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (shouldSkip(req.path)) {
      next();
      return;
    }
    const userAgent = req.headers["user-agent"];
    const client = classifyUserAgent(typeof userAgent === "string" ? userAgent : "");
    const region = classifyRegion(req.ip, countryHeaderOf(req.headers as Record<string, unknown>));
    const route = normalizeRoute(req.method, req.path);
    res.on("finish", () => {
      try {
        const status = res.statusCode;
        recordTraffic("route", route);
        recordTraffic("status", String(status));
        recordTraffic("device", client.device);
        recordTraffic("browser", client.browser);
        recordTraffic("os", client.os);
        recordTraffic("region", region);
        // 安全防护次数：由各中间件/错误处理打标记，统一在这里入库
        const locals = res.locals as Record<string, unknown>;
        if (locals.regionBlocked === true) recordTraffic("security", "region_blocked");
        if (locals.scannerBlocked === true) recordTraffic("security", "scanner_blocked");
        if (locals.adminEntryProbe === true) recordTraffic("security", "admin_entry_probe");
        if (locals.csrfRejected === true) recordTraffic("security", "csrf_rejected");
        if (locals.paymentPasswordWrong === true) {
          recordTraffic("security", "payment_password_wrong");
        }
        if (locals.paymentPasswordLocked === true) {
          recordTraffic("security", "payment_password_locked");
        }
        if (status === 429) recordTraffic("security", "rate_limited");
        else if (status === 401) recordTraffic("security", "unauthorized");
        else if (status === 403 && locals.csrfRejected !== true) {
          recordTraffic("security", "forbidden");
        }
      } catch {
        // 统计失败不影响业务
      }
    });
    next();
  };
}

/* ------------------------------------------------------------ 查询统计 */

export interface TrafficBreakdownItem {
  key: string;
  label: string;
  count: number;
  share: number;
}

export interface TrafficSeriesPoint {
  day: string;
  label: string;
  requests: number;
  scans: number;
  security: number;
}

export interface TrafficStatsPayload {
  days: number;
  since: string;
  until: string;
  requests: { total: number; today: number; averagePerDay: number };
  scans: { total: number; items: TrafficBreakdownItem[] };
  security: { total: number; items: TrafficBreakdownItem[] };
  routes: TrafficBreakdownItem[];
  statuses: TrafficBreakdownItem[];
  devices: TrafficBreakdownItem[];
  browsers: TrafficBreakdownItem[];
  systems: TrafficBreakdownItem[];
  regions: TrafficBreakdownItem[];
  series: TrafficSeriesPoint[];
  generatedAt: string;
}

const SCAN_LABELS: Record<string, string> = {
  platform_dynamic: "平台动态码被扫",
  platform_dynamic_request: "动态码发起收款",
  campus_card: "校园卡被扫",
};

const SECURITY_LABELS: Record<string, string> = {
  rate_limited: "限流拦截",
  csrf_rejected: "CSRF 拦截",
  region_blocked: "地区拦截",
  admin_entry_probe: "后台入口探测",
  scanner_blocked: "扫描器路径拦截",
  unauthorized: "未登录访问",
  forbidden: "越权访问",
  payment_password_wrong: "支付密码错误",
  payment_password_locked: "支付密码锁定",
};

const STATUS_LABELS: Record<string, string> = {
  "200": "成功",
  "201": "创建成功",
  "204": "无内容",
  "301": "永久跳转",
  "302": "临时跳转",
  "304": "未修改",
  "400": "参数错误",
  "401": "未登录",
  "403": "拒绝访问",
  "404": "不存在",
  "409": "状态冲突",
  "413": "内容过大",
  "423": "已锁定",
  "429": "触发限流",
  "500": "服务器错误",
  "502": "网关错误",
  "503": "服务未就绪",
};

function shareOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function breakdown(
  rows: { name: string; count: number }[],
  total: number,
  labels: Record<string, string> = {},
  limit = 20,
): TrafficBreakdownItem[] {
  const sorted = [...rows].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const head = sorted.slice(0, limit).map((row) => ({
    key: row.name,
    label: labels[row.name] ?? row.name,
    count: row.count,
    share: shareOf(row.count, total),
  }));
  const rest = sorted.slice(limit);
  if (rest.length > 0) {
    const restCount = rest.reduce((sum, row) => sum + row.count, 0);
    head.push({
      key: "__other__",
      label: "其他",
      count: restCount,
      share: shareOf(restCount, total),
    });
  }
  return head;
}

interface CounterRow {
  day: string;
  kind: string;
  name: string;
  count: number;
}

/** 读取最近 days 天的访问统计（含按天趋势与各维度排行） */
export function trafficStats(days = 7): TrafficStatsPayload {
  flushTrafficCounters();
  const range = Math.min(Math.max(Math.trunc(days) || 7, 1), 90);
  const today = new Date();
  const since = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  since.setDate(since.getDate() - (range - 1));
  const sinceDay = dayKeyOf(since);
  const untilDay = dayKeyOf(today);

  const rows = queryAll<CounterRow>(
    "SELECT day, kind, name, count FROM traffic_counters WHERE day >= ? AND day <= ?",
    sinceDay,
    untilDay,
  );

  const byKind = new Map<TrafficKind, Map<string, number>>();
  const byDay = new Map<string, { requests: number; scans: number; security: number }>();
  for (const row of rows) {
    const kind = row.kind as TrafficKind;
    const kindMap = byKind.get(kind) ?? new Map<string, number>();
    kindMap.set(row.name, (kindMap.get(row.name) ?? 0) + row.count);
    byKind.set(kind, kindMap);
    if (kind === "route" || kind === "scan" || kind === "security") {
      const dayEntry = byDay.get(row.day) ?? { requests: 0, scans: 0, security: 0 };
      if (kind === "route") dayEntry.requests += row.count;
      else if (kind === "scan") dayEntry.scans += row.count;
      else dayEntry.security += row.count;
      byDay.set(row.day, dayEntry);
    }
  }

  const toRows = (kind: TrafficKind): { name: string; count: number }[] =>
    [...(byKind.get(kind) ?? new Map<string, number>()).entries()].map(([name, count]) => ({
      name,
      count,
    }));
  const sum = (kind: TrafficKind): number =>
    toRows(kind).reduce((total, row) => total + row.count, 0);

  const routeRows = toRows("route");
  const requestTotal = sum("route");
  const todayRequests = routeRows
    .filter((row) => rows.some((item) => item.kind === "route" && item.name === row.name && item.day === untilDay))
    .reduce((total, row) => total + row.count, 0);

  const series: TrafficSeriesPoint[] = [];
  for (let offset = 0; offset < range; offset += 1) {
    const date = new Date(since.getFullYear(), since.getMonth(), since.getDate());
    date.setDate(date.getDate() + offset);
    const day = dayKeyOf(date);
    const entry = byDay.get(day) ?? { requests: 0, scans: 0, security: 0 };
    series.push({
      day,
      label: `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
      requests: entry.requests,
      scans: entry.scans,
      security: entry.security,
    });
  }

  const scanRows = toRows("scan");
  const securityRows = toRows("security");
  const statusRows = toRows("status");

  return {
    days: range,
    since: sinceDay,
    until: untilDay,
    requests: {
      total: requestTotal,
      today: todayRequests,
      averagePerDay: range > 0 ? Math.round(requestTotal / range) : 0,
    },
    scans: {
      total: sum("scan"),
      items: breakdown(scanRows, sum("scan"), SCAN_LABELS),
    },
    security: {
      total: sum("security"),
      items: breakdown(securityRows, sum("security"), SECURITY_LABELS),
    },
    routes: breakdown(routeRows, requestTotal, {}, 15),
    statuses: breakdown(statusRows, sum("status"), STATUS_LABELS),
    devices: breakdown(toRows("device"), sum("device"), {
      desktop: "电脑",
      mobile: "手机",
      tablet: "平板",
      bot: "机器人",
      unknown: "未知",
    }),
    browsers: breakdown(toRows("browser"), sum("browser")),
    systems: breakdown(toRows("os"), sum("os")),
    regions: breakdown(toRows("region"), sum("region")),
    series,
    generatedAt: new Date().toISOString(),
  };
}
