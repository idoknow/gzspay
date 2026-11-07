/**
 * IP 归属地：只测纯解析逻辑（格式化、省市拆分、内网判定）。
 *
 * 真正的网络查询不在这里测：结果取决于外部接口，测试里不能依赖网络；
 * 缓存与降级行为由 `lookupIpLocation` 在接口失败时返回 null 保证。
 */
import { describe, expect, it } from "vitest";
import { formatIpLocation, isLocalIp, splitChineseLocation } from "../src/lib/ip-location.js";

describe("IP 归属地", () => {
  it("把国家省市区拼成一行，国内省略国家", () => {
    expect(
      formatIpLocation({ country: "中国", region: "江苏省", city: "南京市" }),
    ).toBe("江苏省 · 南京市");
    expect(
      formatIpLocation({ country: "日本", region: "东京都", city: "东京" }),
    ).toBe("日本 · 东京都 · 东京");
    // 省市同名只写一次
    expect(formatIpLocation({ country: "中国", region: "北京市", city: "北京市" })).toBe(
      "北京市",
    );
    expect(formatIpLocation({ country: "中国" })).toBeNull();
    expect(formatIpLocation({})).toBeNull();
  });

  it("把「江苏省南京市 电信」拆成省与市", () => {
    expect(splitChineseLocation("江苏省南京市 电信")).toEqual({
      region: "江苏省",
      city: "南京市",
    });
    expect(splitChineseLocation("北京市 联通")).toEqual({ region: "北京市", city: null });
    expect(splitChineseLocation("内蒙古自治区呼和浩特市")).toEqual({
      region: "内蒙古自治区",
      city: "呼和浩特市",
    });
    expect(splitChineseLocation("")).toEqual({ region: null, city: null });
  });

  it("内网、回环与链路本地地址不查归属地", () => {
    for (const ip of [
      "",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.9",
      "172.31.255.1",
      "192.168.1.10",
      "169.254.3.4",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:192.168.1.1",
      "not-an-ip",
    ]) {
      expect(isLocalIp(ip), ip).toBe(true);
    }
    for (const ip of ["114.114.114.114", "8.8.8.8", "172.32.0.1", "2400:3200::1"]) {
      expect(isLocalIp(ip), ip).toBe(false);
    }
  });
});
