/**
 * IP 归属地：把「114.114.114.114」翻成「江苏省 · 南京市」这种给人看的位置。
 *
 * 做法与边界：
 * - 只用公开的免密接口，查询结果按 IP 缓存在内存里（成功 7 天、失败 10 分钟），
 *   进程重启后重新查；接口不可用时整段返回 null，界面就不显示归属地。
 * - 内网 / 回环 / 链路本地地址直接判为「内网地址」，不发出任何请求。
 * - 归属地只用于「我的设备」「后台日志」这类辅助信息，**不能作为风控或审计依据**：
 *   接口按网段估算，移动网络、CDN、代理都可能让结果偏移。
 * - 关闭方式：环境变量 `IP_LOCATION_ENABLED=0`（见 config.ipLocationEnabled）。
 */
import { isIP } from "node:net";
import { config } from "../config.js";

/** 成功结果缓存多久 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 查不到的结果只记一会儿，免得对方接口临时抽风之后一直显示不出来 */
const FAIL_TTL_MS = 10 * 60 * 1000;
/** 单次查询超时 */
const TIMEOUT_MS = 2500;
/** 缓存上限，超出后按插入顺序淘汰最旧的 */
const CACHE_LIMIT = 4000;
/** 并发查询上限 */
const CONCURRENCY = 4;

interface CacheEntry {
  value: string | null;
  at: number;
  ttl: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<string | null>>();

const LOCAL_TEXT = "内网地址";

/** 是否是本机 / 内网地址：这类地址查不到归属地，也不该发出去查 */
export function isLocalIp(ip: string | null | undefined): boolean {
  const value = (ip ?? "").trim();
  if (!value) return true;
  const family = isIP(value);
  if (family === 4) {
    const octets = value.split(".").map((part) => Number(part));
    const [a = 0, b = 0] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (family === 6) {
    const normalized = value.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (/^f[cd]/.test(normalized)) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    // ::ffff:192.168.1.1 这种映射地址，按内层 IPv4 判断
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isLocalIp(mapped[1]);
    return false;
  }
  return true;
}

/**
 * 把国家 / 省 / 市拼成人看的一行。
 * 国内省略「中国」，省市相同只写一次；国外的带上国家。
 */
export function formatIpLocation(parts: {
  country?: string | null;
  region?: string | null;
  city?: string | null;
}): string | null {
  const clean = (value: string | null | undefined) => (value ?? "").trim();
  const country = clean(parts.country);
  const region = clean(parts.region);
  const city = clean(parts.city);
  const isChina = /^(中国|中国大陆|china|cn)$/i.test(country);
  const pieces: string[] = [];
  if (country && !isChina) pieces.push(country);
  if (region && region !== city) pieces.push(region);
  if (city) pieces.push(city);
  const text = pieces.join(" · ");
  return text || null;
}

/**
 * 「江苏省南京市」拆成省与市；只有一个层级时整体当作 region。
 * 百度接口返回的「江苏省南京市 电信」先去点运营商部分再拆。
 */
export function splitChineseLocation(raw: string): { region: string | null; city: string | null } {
  const text = (raw.split(/\s+/)[0] ?? "").trim();
  if (!text) return { region: null, city: null };
  const matched = text.match(/^(.*?(?:省|自治区|特别行政区|市))(.*)$/);
  if (!matched) return { region: text, city: null };
  const region = matched[1] ?? null;
  const city = (matched[2] ?? "").trim() || null;
  return { region, city };
}

function readCache(ip: string): string | null | undefined {
  const entry = cache.get(ip);
  if (!entry) return undefined;
  if (Date.now() - entry.at > entry.ttl) {
    cache.delete(ip);
    return undefined;
  }
  return entry.value;
}

function writeCache(ip: string, value: string | null): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(ip, { value, at: Date.now(), ttl: value ? CACHE_TTL_MS : FAIL_TTL_MS });
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "gzspay/1.0" },
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface IpwhoResponse {
  success?: boolean;
  country?: string;
  region?: string;
  city?: string;
}

async function queryIpwho(ip: string): Promise<string | null> {
  const data = (await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}?lang=zh-CN`)) as
    | IpwhoResponse
    | null;
  if (!data || data.success === false) return null;
  return formatIpLocation({ country: data.country, region: data.region, city: data.city });
}

interface BaiduResponse {
  status?: string;
  data?: { location?: string }[];
}

/** 备用接口：百度开放数据，国内地址精度更好，只有中文 */
async function queryBaidu(ip: string): Promise<string | null> {
  const url = `https://opendata.baidu.com/api.php?query=${encodeURIComponent(ip)}&resource_id=6006&oe=utf8`;
  const data = (await fetchJson(url)) as BaiduResponse | null;
  const raw = data?.data?.[0]?.location;
  if (!raw) return null;
  const parts = splitChineseLocation(raw);
  return formatIpLocation({ region: parts.region, city: parts.city });
}

async function queryRemote(ip: string): Promise<string | null> {
  const first = await queryIpwho(ip);
  if (first) return first;
  return queryBaidu(ip);
}

/**
 * 查 IP 归属地（异步）。命中缓存立即返回；
 * 内网地址返回「内网地址」；接口失败返回 null。
 */
export function lookupIpLocation(ip: string | null | undefined): Promise<string | null> {
  const value = (ip ?? "").trim();
  if (!value) return Promise.resolve(null);
  const cached = readCache(value);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = pending.get(value);
  if (running) return running;
  if (!config.ipLocationEnabled) return Promise.resolve(null);
  if (isLocalIp(value)) {
    writeCache(value, LOCAL_TEXT);
    return Promise.resolve(LOCAL_TEXT);
  }
  const task = queryRemote(value)
    .catch(() => null)
    .then((result) => {
      writeCache(value, result);
      return result;
    })
    .finally(() => {
      pending.delete(value);
    });
  pending.set(value, task);
  return task;
}

/** 同步读缓存：列表接口先用它填，未命中时由调用方先 await fillIpLocations */
export function getCachedIpLocation(ip: string | null | undefined): string | null {
  const value = (ip ?? "").trim();
  if (!value) return null;
  const cached = readCache(value);
  return cached ?? null;
}

/** 批量把一批 IP 查进缓存，供后续同步读取；失败的保持 null */
export async function fillIpLocations(ips: (string | null | undefined)[]): Promise<void> {
  const targets = [...new Set(ips.map((ip) => (ip ?? "").trim()).filter(Boolean))];
  const missing = targets.filter((ip) => readCache(ip) === undefined);
  if (missing.length === 0) return;
  for (let index = 0; index < missing.length; index += CONCURRENCY) {
    const batch = missing.slice(index, index + CONCURRENCY);
    await Promise.all(batch.map((ip) => lookupIpLocation(ip)));
  }
}
