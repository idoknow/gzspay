/**
 * 轻量压测脚本：对关键只读接口做并发压测，输出 req/s 与 p95。
 *
 * 用法：
 *   node scripts/bench-seed.mjs > .bench-meta.json       # 复制一份库并写入测试会话
 *   NODE_ENV=production PORT=3108 DATABASE_PATH=<bench 库绝对路径> node server/dist/index.js
 *   BENCH_BASE_URL=http://127.0.0.1:3108 BENCH_COOKIE="gzs_session=..." node scripts/bench.mjs
 *
 * 说明：
 *   - 没有会话 cookie 时只压测公开接口（health / about），其余接口会返回 401 并计入 errors。
 *   - 压测会写入 request_metrics 与 sessions.last_seen_at，请使用复制出来的库，不要指向生产库。
 */
import http from "node:http";

const base = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:3000";
const cookie = process.env.BENCH_COOKIE ?? "";
const label = process.env.BENCH_LABEL ?? "";
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        agent,
        headers: { "Accept-Encoding": "gzip", ...(cookie ? { Cookie: cookie } : {}), ...headers },
      },
      (res) => {
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
        });
        res.on("end", () => resolve({ status: res.statusCode, bytes }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function runPhase(name, path, total, concurrency) {
  // 预热，避免 JIT / 首次查询影响结果
  const warmup = Math.min(100, Math.floor(total / 10));
  await Promise.all(Array.from({ length: warmup }, () => request(path)));

  const latencies = [];
  let bytes = 0;
  let errors = 0;
  let index = 0;
  const startedAt = process.hrtime.bigint();

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= total) return;
      const begin = process.hrtime.bigint();
      try {
        const result = await request(path);
        bytes += result.bytes;
        if (result.status >= 400) errors += 1;
      } catch {
        errors += 1;
      }
      latencies.push(Number(process.hrtime.bigint() - begin) / 1e6);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;
  const avgBody = bytes / total / 1024;
  console.log(
    [
      name.padEnd(26),
      `${(total / (elapsedMs / 1000)).toFixed(0)} req/s`,
      `p50 ${pct(0.5).toFixed(1)}ms`,
      `p95 ${pct(0.95).toFixed(1)}ms`,
      `avgBody ${avgBody.toFixed(1)}KB`,
      errors ? `errors ${errors}` : "errors 0",
    ].join("  "),
  );
  return { rps: total / (elapsedMs / 1000), p95: pct(0.95), avgBody };
}

console.log(`== ${label || "bench"} (${base}) ==`);
const results = {};
results.health = await runPhase("GET /api/health", "/api/health", 3000, 64);
results.about = await runPhase("GET /api/about", "/api/about", 1200, 64);
results.me = await runPhase("GET /api/me", "/api/me", 1500, 64);
results.orders = await runPhase("GET /api/orders (list)", "/api/orders?scope=pay&status=all", 1200, 64);
results.stats = await runPhase("GET /api/stats/summary", "/api/stats/summary", 800, 32);
console.log(JSON.stringify({ label, results }));
agent.destroy();
