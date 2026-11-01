import { describe, expect, it } from "vitest";
import { sniffImageKind } from "../src/lib/image.js";
import {
  DEV_SESSION_SECRET,
  MIN_SESSION_SECRET_LENGTH,
  securityConfigProblems,
  type SecurityConfigInput,
} from "../src/lib/security.js";

const PROD_BASE: SecurityConfigInput = {
  isProduction: true,
  sessionSecret: "a".repeat(MIN_SESSION_SECRET_LENGTH + 8),
  appBaseUrl: "https://pay.example.com",
  publicBaseUrl: "https://pay.example.com",
  allowInsecureBaseUrl: false,
};

describe("生产环境安全配置自检", () => {
  it("合规配置没有问题", () => {
    expect(securityConfigProblems(PROD_BASE)).toEqual([]);
  });

  it("开发环境不校验", () => {
    expect(
      securityConfigProblems({
        ...PROD_BASE,
        isProduction: false,
        sessionSecret: DEV_SESSION_SECRET,
        appBaseUrl: "http://localhost:5173",
      }),
    ).toEqual([]);
  });

  it("示例密钥、过短密钥与 http 地址都会被拦下", () => {
    const problems = securityConfigProblems({
      ...PROD_BASE,
      sessionSecret: DEV_SESSION_SECRET,
      appBaseUrl: "http://localhost:5173",
      publicBaseUrl: "http://localhost:5173",
    });
    expect(problems.length).toBe(3);
    expect(problems[0]).toContain("SESSION_SECRET");
    expect(problems.join("\n")).toContain("https://");
  });

  it("内网部署可用 ALLOW_INSECURE_BASE_URL 放行 http，但密钥仍要合规", () => {
    const problems = securityConfigProblems({
      ...PROD_BASE,
      sessionSecret: "short",
      appBaseUrl: "http://192.168.1.10:3000",
      publicBaseUrl: "http://192.168.1.10:3000",
      allowInsecureBaseUrl: true,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("至少需要");
  });
});

describe("图片类型嗅探", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  it("识别 PNG 与 JPEG 文件头", () => {
    expect(sniffImageKind(png)).toBe("png");
    expect(sniffImageKind(jpeg)).toBe("jpeg");
  });

  it("拒绝 SVG、HTML 与过短内容", () => {
    expect(sniffImageKind(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"))).toBeNull();
    expect(sniffImageKind(Buffer.from("<!DOCTYPE html><html></html>"))).toBeNull();
    expect(sniffImageKind(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageKind(Buffer.alloc(0))).toBeNull();
  });
});
