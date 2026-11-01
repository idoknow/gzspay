import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("config.version", () => {
  it("与 server/package.json 的版本号一致", async () => {
    vi.resetModules();
    const { config } = await import("../src/config.js");
    const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const pkg = JSON.parse(readFileSync(path.join(serverRoot, "package.json"), "utf-8")) as {
      version: string;
    };
    expect(config.version).toBe(pkg.version);
    expect(config.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

/** 环境变量在模块加载时读取，因此每个用例重新加载配置模块 */
describe("config.extraAllowedOrigins", () => {
  afterEach(() => {
    delete process.env.EXTRA_ALLOWED_ORIGINS;
    vi.resetModules();
  });

  it("未配置时为空数组", async () => {
    // 仓库根可能有 .env（开发用），显式置空让 dotenv 不覆盖
    process.env.EXTRA_ALLOWED_ORIGINS = "";
    vi.resetModules();
    const { config } = await import("../src/config.js");
    expect(config.extraAllowedOrigins).toEqual([]);
  });

  it("解析逗号分隔的来源并去掉末尾斜杠", async () => {
    process.env.EXTRA_ALLOWED_ORIGINS = "http://192.168.1.10:5173/, http://gzspay.local:5173";
    vi.resetModules();
    const { config } = await import("../src/config.js");
    expect(config.extraAllowedOrigins).toEqual(["http://192.168.1.10:5173", "http://gzspay.local:5173"]);
  });
});
