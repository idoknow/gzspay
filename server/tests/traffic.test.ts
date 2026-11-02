import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execute, migrate, queryOne } from "../src/db/index.js";
import {
  classifyRegion,
  classifyUserAgent,
  flushTrafficCounters,
  normalizeRoute,
  pruneTrafficCounters,
  recordTraffic,
  resetTrafficCountersForTest,
  trafficStats,
} from "../src/lib/traffic.js";

beforeAll(() => {
  migrate();
});

beforeEach(() => {
  resetTrafficCountersForTest();
  execute("DELETE FROM traffic_counters");
});

describe("访问统计基础分类", () => {
  it("按 User-Agent 识别设备、浏览器与系统", () => {
    const wechatIphone = classifyUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44",
    );
    expect(wechatIphone).toEqual({ device: "mobile", browser: "微信", os: "iOS" });

    const windowsChrome = classifyUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    );
    expect(windowsChrome.device).toBe("desktop");
    expect(windowsChrome.browser).toBe("Chrome");
    expect(windowsChrome.os).toBe("Windows");

    const ipad = classifyUserAgent(
      "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15",
    );
    expect(ipad.device).toBe("tablet");

    expect(classifyUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)").device).toBe("bot");
    expect(classifyUserAgent("python-requests/2.31.0").device).toBe("bot");
    expect(classifyUserAgent("")).toEqual({ device: "unknown", browser: "未知", os: "未知" });
  });

  it("路由归一化把 ID、未知接口与未知页面收敛成稳定维度", () => {
    expect(normalizeRoute("GET", "/api/orders/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(
      "GET /api/orders/:id",
    );
    expect(normalizeRoute("GET", "/api/orders/12345")).toBe("GET /api/orders/:id");
    expect(normalizeRoute("POST", "/api/me/payment-password/reset/verify")).toBe(
      "POST /api/me/payment-password/reset/verify",
    );
    // 未知接口统一归入「其他接口」，避免扫描器制造无限维度
    expect(normalizeRoute("GET", "/api/whatever/foo")).toBe("GET /api/其他接口");
    expect(normalizeRoute("GET", "/")).toBe("GET 页面 首页");
    expect(normalizeRoute("GET", "/trades")).toBe("GET 页面 /trades");
    expect(normalizeRoute("GET", "/admin/traffic")).toBe("GET 页面 /admin");
    expect(normalizeRoute("GET", "/totally-unknown")).toBe("GET 页面 其他");
  });

  it("访问地区归类到国家 / 内网粒度", () => {
    expect(classifyRegion("127.0.0.1")).toBe("本机/内网");
    expect(classifyRegion("192.168.1.10")).toBe("本机/内网");
    expect(classifyRegion("114.114.114.114")).toBe("中国大陆");
    expect(classifyRegion("8.8.8.8")).toBe("境外（未识别国家）");
    expect(classifyRegion("not-an-ip")).toBe("未知");
    // CDN 国家头优先，未知国家码回退到 IP 归属
    expect(classifyRegion("8.8.8.8", "JP")).toBe("JP");
    expect(classifyRegion("114.114.114.114", "XX")).toBe("中国大陆");
    expect(classifyRegion("114.114.114.114", "CN")).toBe("中国大陆");
  });
});

describe("访问统计聚合与查询", () => {
  it("计数按类型聚合，扫码与安全防护单独统计", () => {
    recordTraffic("route", "GET /api/orders", 3);
    recordTraffic("route", "GET /api/orders", 2);
    recordTraffic("route", "GET 页面 /trades");
    recordTraffic("status", "200", 5);
    recordTraffic("status", "403");
    recordTraffic("device", "mobile", 4);
    recordTraffic("browser", "微信", 4);
    recordTraffic("os", "iOS", 4);
    recordTraffic("region", "中国大陆", 5);
    recordTraffic("scan", "campus_card");
    recordTraffic("scan", "platform_dynamic", 2);
    recordTraffic("security", "rate_limited");
    flushTrafficCounters();

    const stats = trafficStats(7);
    expect(stats.days).toBe(7);
    expect(stats.series).toHaveLength(7);
    expect(stats.requests.total).toBe(6);
    expect(stats.requests.today).toBe(6);
    expect(stats.routes[0]).toMatchObject({ key: "GET /api/orders", count: 5 });
    expect(stats.routes.find((item) => item.key === "GET /api/orders")?.share).toBeCloseTo(83.3, 1);
    expect(stats.statuses.find((item) => item.key === "200")?.count).toBe(5);
    expect(stats.statuses.find((item) => item.key === "403")?.label).toBe("拒绝访问");
    expect(stats.devices[0]).toMatchObject({ key: "mobile", label: "手机", count: 4 });
    expect(stats.scans.total).toBe(3);
    expect(stats.scans.items.find((item) => item.key === "campus_card")?.label).toBe("校园卡被扫");
    expect(stats.scans.items.find((item) => item.key === "platform_dynamic")?.label).toBe(
      "平台动态码被扫",
    );
    expect(stats.security.total).toBe(1);
    expect(stats.security.items[0]).toMatchObject({ key: "rate_limited", label: "限流拦截" });
    // 趋势里今天的请求数
    const today = stats.series[stats.series.length - 1];
    expect(today).toMatchObject({ requests: 6, scans: 3, security: 1 });
  });

  it("超过保留期的统计会被清理", () => {
    const now = new Date();
    const old = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    old.setDate(old.getDate() - 500);
    const pad = (value: number) => String(value).padStart(2, "0");
    const oldDay = `${old.getFullYear()}-${pad(old.getMonth() + 1)}-${pad(old.getDate())}`;
    const nowDay = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    execute(
      "INSERT INTO traffic_counters (day, kind, name, count, updated_at) VALUES (?, 'route', 'GET /old', 1, ?)",
      oldDay,
      new Date().toISOString(),
    );
    execute(
      "INSERT INTO traffic_counters (day, kind, name, count, updated_at) VALUES (?, 'route', 'GET /new', 1, ?)",
      nowDay,
      new Date().toISOString(),
    );
    pruneTrafficCounters(400);
    expect(queryOne("SELECT COUNT(*) AS total FROM traffic_counters WHERE day = ?", oldDay)).toMatchObject({
      total: 0,
    });
    expect(queryOne("SELECT COUNT(*) AS total FROM traffic_counters WHERE day = ?", nowDay)).toMatchObject({
      total: 1,
    });
  });
});
