import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  BLOCKED_MESSAGE,
  createGeoGuard,
  geoDataMeta,
  ipInCidr,
  isChinaMainlandIp,
  isPrivateOrLoopback,
  parseCidr,
  parseIp,
  type GeoGuardOptions,
} from "../src/lib/geo.js";

const DATA = JSON.parse(
  readFileSync(new URL("../assets/cn-ip-ranges.json", import.meta.url), "utf-8"),
) as { ipv6: string[]; ipv4: [number, number][] };

function buildApp(options: GeoGuardOptions): express.Express {
  const app = express();
  app.set("trust proxy", true);
  app.use(createGeoGuard(options));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/me", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/page", (_req, res) => {
    res.type("html").send("<h1>page</h1>");
  });
  return app;
}

const CN_LOOKUP = () => "CN";
const JP_LOOKUP = () => "JP";

describe("IP 解析与 CIDR 匹配", () => {
  it("解析 IPv4、IPv6 与 ::ffff: 映射地址", () => {
    expect(parseIp("114.114.114.114")).toEqual({ family: 4, value: BigInt(114 * 256 ** 3 + 114 * 256 ** 2 + 114 * 256 + 114) });
    expect(parseIp("::1")?.family).toBe(6);
    expect(parseIp("2001:db8::1")?.family).toBe(6);
    expect(parseIp("::ffff:1.2.3.4")?.family).toBe(4);
    expect(parseIp("not-an-ip")).toBeNull();
  });

  it("识别私有与回环地址", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.9", "192.168.1.1", "::1", "fe80::1"]) {
      const parsed = parseIp(ip);
      expect(parsed, ip).not.toBeNull();
      expect(isPrivateOrLoopback(parsed!), ip).toBe(true);
    }
    expect(isPrivateOrLoopback(parseIp("8.8.8.8")!)).toBe(false);
    expect(isPrivateOrLoopback(parseIp("2400:3200::1")!)).toBe(false);
  });

  it("CIDR 匹配（IPv4 与 IPv6）", () => {
    const v4 = parseCidr("1.2.3.0/24")!;
    expect(ipInCidr(parseIp("1.2.3.9")!, v4)).toBe(true);
    expect(ipInCidr(parseIp("1.2.4.9")!, v4)).toBe(false);
    const v6 = parseCidr("2400:3200::/32")!;
    expect(ipInCidr(parseIp("2400:3200:1::1")!, v6)).toBe(true);
    expect(ipInCidr(parseIp("2400:3201::1")!, v6)).toBe(false);
    expect(parseCidr("1.2.3.0/33")).toBeNull();
  });
});

describe("中国大陆 IP 判断", () => {
  it("数据文件包含 IPv4 与 IPv6 段", () => {
    const meta = geoDataMeta();
    expect(meta.ipv4Count).toBeGreaterThan(1000);
    expect(meta.ipv6Count).toBeGreaterThan(10);
    expect(meta.updatedAt).toBeTruthy();
  });

  it("国内地址判定为中国大陆，境外地址判定为非中国大陆", () => {
    expect(isChinaMainlandIp("114.114.114.114")).toBe(true);
    expect(isChinaMainlandIp("223.5.5.5")).toBe(true);
    expect(isChinaMainlandIp("8.8.8.8")).toBe(false);
    expect(isChinaMainlandIp("1.1.1.1")).toBe(false);
  });

  it("数据里的 IPv6 段也能命中", () => {
    const sample = DATA.ipv6.find((item) => !item.startsWith("::"));
    expect(sample).toBeTruthy();
    const prefix = sample!.split("/")[0] ?? "";
    expect(isChinaMainlandIp(prefix)).toBe(true);
    expect(isChinaMainlandIp("2001:4860:4860::8888")).toBe(false);
  });

  it("无法解析的地址返回 null", () => {
    expect(isChinaMainlandIp("")).toBeNull();
    expect(isChinaMainlandIp("unknown")).toBeNull();
  });
});

describe("地区访问中间件", () => {
  it("关闭时不拦截任何请求", async () => {
    const app = buildApp({ enabled: false, lookup: JP_LOOKUP });
    const response = await request(app).get("/api/me").set("X-Forwarded-For", "203.0.113.9");
    expect(response.status).toBe(200);
  });

  it("中国大陆 IP 放行，境外 IP 返回 403", async () => {
    const cnApp = buildApp({ enabled: true, lookup: CN_LOOKUP });
    const allowed = await request(cnApp).get("/api/me").set("X-Forwarded-For", "114.114.114.114");
    expect(allowed.status).toBe(200);

    const jpApp = buildApp({ enabled: true, lookup: JP_LOOKUP });
    const blocked = await request(jpApp).get("/api/me").set("X-Forwarded-For", "203.0.113.9");
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ error: { code: "REGION_BLOCKED", message: BLOCKED_MESSAGE } });
    expect(blocked.headers["cache-control"]).toBe("no-store");
  });

  it("未知归属按策略处理", async () => {
    const unknown = () => null;
    const denyApp = buildApp({ enabled: true, lookup: unknown, unknownPolicy: "deny" });
    const denied = await request(denyApp).get("/api/me").set("X-Forwarded-For", "198.51.100.7");
    expect(denied.status).toBe(403);

    const allowApp = buildApp({ enabled: true, lookup: unknown, unknownPolicy: "allow" });
    const allowed = await request(allowApp).get("/api/me").set("X-Forwarded-For", "198.51.100.7");
    expect(allowed.status).toBe(200);
  });

  it("白名单与例外路径始终放行", async () => {
    const app = buildApp({
      enabled: true,
      lookup: JP_LOOKUP,
      whitelist: ["203.0.113.0/24"],
      bypassPaths: ["/api/health"],
    });
    const whitelisted = await request(app).get("/api/me").set("X-Forwarded-For", "203.0.113.9");
    expect(whitelisted.status).toBe(200);

    const health = await request(app).get("/api/health").set("X-Forwarded-For", "198.51.100.7");
    expect(health.status).toBe(200);
  });

  it("本机 / 内网地址始终放行", async () => {
    const app = buildApp({ enabled: true, lookup: JP_LOOKUP });
    const loopback = await request(app).get("/api/me");
    expect(loopback.status).toBe(200);
  });

  it("可信 CDN 国家码请求头优先于 IP 查询", async () => {
    const app = buildApp({ enabled: true, lookup: JP_LOOKUP, trustHeader: "CF-IPCountry" });
    const cn = await request(app)
      .get("/api/me")
      .set("X-Forwarded-For", "198.51.100.7")
      .set("CF-IPCountry", "CN");
    expect(cn.status).toBe(200);

    const unknownHeader = await request(app)
      .get("/api/me")
      .set("X-Forwarded-For", "198.51.100.7")
      .set("CF-IPCountry", "XX");
    // XX 表示 CDN 也判断不出归属，退回 IP 查询（这里是 JP）
    expect(unknownHeader.status).toBe(403);
  });

  it("页面请求返回可读的 HTML 提示", async () => {
    const app = buildApp({ enabled: true, lookup: JP_LOOKUP });
    const response = await request(app)
      .get("/page")
      .set("X-Forwarded-For", "198.51.100.7")
      .set("Accept", "text/html");
    expect(response.status).toBe(403);
    expect(response.text).toContain("当前地区暂不支持访问");
  });
});
