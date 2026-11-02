// 生成中国大陆 IP 段数据（零依赖方案，用于 server/src/lib/geo.ts）。
//
// 数据来源：APNIC 公开的 delegated-apnic-latest 文件（各 RIR 每日更新），
// 只取国家码为 CN 的 IPv4 / IPv6 分配记录。中国境内运营商与校园网基本都在
// 这份注册表里，但对「境外注册、境内使用」或云厂商跨境段会有少量误判，
// 这属于自建数据的固有精度上限；需要更高精度可换商业库（见 docs/deploy.md）。
//
// 用法：node scripts/geo/build-cn-ranges.mjs
// 输出：server/src/data/cn-ip-ranges.json
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const outFile = path.join(repoRoot, "server", "assets", "cn-ip-ranges.json");

const SOURCES = [
  "https://ftp.apnic.net/apnic/stats/apnic/delegated-apnic-latest",
  "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest",
];

function ipv4ToInt(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

async function fetchDelegated() {
  let lastError = null;
  for (const url of SOURCES) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "gzspay-geo-build" } });
      if (!response.ok) {
        lastError = new Error(`${url} 返回 HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      if (!text.includes("|CN|")) {
        lastError = new Error(`${url} 内容里没有 CN 记录`);
        continue;
      }
      return { url, text };
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
    }
  }
  throw lastError ?? new Error("无法获取 APNIC 分配数据");
}

const { url, text } = await fetchDelegated();

/** @type {Array<[number, number]>} */
const ipv4Ranges = [];
/** @type {string[]} */
const ipv6Prefixes = [];

for (const line of text.split(/\r?\n/)) {
  if (!line.startsWith("apnic|CN|")) continue;
  const fields = line.split("|");
  const type = fields[2];
  if (type === "ipv4") {
    const start = ipv4ToInt(fields[3] ?? "");
    const count = Number(fields[4]);
    if (start === null || !Number.isInteger(count) || count <= 0) continue;
    ipv4Ranges.push([start, start + count - 1]);
  } else if (type === "ipv6") {
    const prefix = fields[3] ?? "";
    const length = Number(fields[4]);
    if (!prefix || !Number.isInteger(length) || length < 0 || length > 128) continue;
    ipv6Prefixes.push(`${prefix}/${length}`);
  }
}

if (ipv4Ranges.length === 0) {
  throw new Error("解析后没有拿到任何 IPv4 段，数据源格式可能变了");
}

// 排序并合并相邻 / 重叠区间，减少条目数、加快二分查找
ipv4Ranges.sort((a, b) => a[0] - b[0]);
/** @type {Array<[number, number]>} */
const merged = [];
for (const [start, end] of ipv4Ranges) {
  const last = merged[merged.length - 1];
  if (last && start <= last[1] + 1) {
    if (end > last[1]) last[1] = end;
  } else {
    merged.push([start, end]);
  }
}

// IPv6 前缀去重（按长度从短到长，便于匹配时先命中更宽的段）
ipv6Prefixes.sort((a, b) => {
  const [pa, la] = a.split("/");
  const [pb, lb] = b.split("/");
  return Number(la) - Number(lb) || (pa ?? "").localeCompare(pb ?? "");
});
const uniqueIpv6 = [...new Set(ipv6Prefixes)];

const payload = {
  updatedAt: new Date().toISOString(),
  source: url,
  note: "中国大陆 IP 段（APNIC CN 注册记录，IPv4 为闭区间整数对，IPv6 为 CIDR）",
  ipv4Count: merged.length,
  ipv6Count: uniqueIpv6.length,
  ipv4: merged,
  ipv6: uniqueIpv6,
};

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(payload)}\n`, "utf-8");

const bytes = Buffer.byteLength(JSON.stringify(payload));
console.log(
  `[geo] 已生成 ${path.relative(repoRoot, outFile)}：IPv4 ${merged.length} 段 / IPv6 ${uniqueIpv6.length} 条，约 ${(bytes / 1024).toFixed(1)}KB`,
);
