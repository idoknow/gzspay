import { brotliCompressSync, gzipSync, gunzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticAssets, pickEncoding, sendAsset } from "../src/lib/static-assets.js";

const INDEX_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>测试站点</title></head><body><div id="root"></div>${"<!-- 占位注释 -->".repeat(
  40,
)}</body></html>`;
const APP_JS = `console.log("${"gzspay 静态资源压缩测试".repeat(40)}");`;
/** 只保留原始文件，用来验证「没有预压缩产物时的即时 gzip 兜底」 */
const FALLBACK_JS = `export const value = "${"x".repeat(4000)}";`;

let dir: string;
let server: http.Server;
let port: number;

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function get(requestPath: string, headers: Record<string, string> = {}, method = "GET"): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: requestPath, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

function writeAsset(relativePath: string, content: string, variants: { br?: boolean; gz?: boolean } = {}): void {
  const full = path.join(dir, ...relativePath.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  const raw = Buffer.from(content);
  if (variants.br) writeFileSync(`${full}.br`, brotliCompressSync(raw));
  if (variants.gz) writeFileSync(`${full}.gz`, gzipSync(raw));
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "gzspay-static-"));
  writeAsset("index.html", INDEX_HTML, { br: true, gz: true });
  writeAsset("assets/app-abc123.js", APP_JS, { br: true, gz: true });
  writeAsset("assets/plain-abc123.js", FALLBACK_JS, {});
  writeAsset("logo.svg", `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`);

  const indexFile = path.join(dir, "index.html");
  const app = express();
  app.use(createStaticAssets(dir));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    sendAsset(req, res, next, indexFile, "/index.html", { cacheControl: "no-cache" });
  });
  app.use((_req, res) => {
    res.status(404).type("text/plain; charset=utf-8").send("Not Found");
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      port = typeof address === "object" && address ? address.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("静态资源压缩协商", () => {
  it("解析 Accept-Encoding：br 优先，q=0 表示拒绝", () => {
    expect(pickEncoding("br, gzip")).toBe("br");
    expect(pickEncoding("gzip, deflate")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip")).toBe("gzip");
    expect(pickEncoding("identity")).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
    expect(pickEncoding("*")).toBe("br");
  });

  it("客户端支持 br 时发送预压缩的 .br 变体", async () => {
    const res = await get("/assets/app-abc123.js", { "accept-encoding": "br, gzip" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["vary"]).toBe("Accept-Encoding");
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.body.length).toBeLessThan(Buffer.byteLength(APP_JS));
    expect(res.headers["content-length"]).toBe(String(res.body.length));
  });

  it("只支持 gzip 时发送 .gz 变体", async () => {
    const res = await get("/assets/app-abc123.js", { "accept-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.body.length).toBeLessThan(Buffer.byteLength(APP_JS));
  });

  it("不支持压缩时不设置 Content-Encoding，长度等于原文件", async () => {
    const res = await get("/assets/app-abc123.js", { "accept-encoding": "identity" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers["content-length"]).toBe(String(Buffer.byteLength(APP_JS)));
    expect(res.body.toString("utf8")).toBe(APP_JS);
  });

  it("构建产物没有预压缩文件时回退到即时 gzip", async () => {
    const res = await get("/assets/plain-abc123.js", { "accept-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(res.body).toString("utf8")).toBe(FALLBACK_JS);
  });

  it("/assets 使用一年强缓存，index.html 使用 no-cache", async () => {
    const asset = await get("/assets/app-abc123.js", { "accept-encoding": "identity" });
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(asset.headers["cache-control"]).toContain("max-age=31536000");

    const page = await get("/trades", { "accept-encoding": "identity" });
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["cache-control"]).toBe("no-cache");
  });

  it("ETag 命中时返回 304 且不发响应体", async () => {
    const first = await get("/assets/app-abc123.js", { "accept-encoding": "identity" });
    const etag = first.headers["etag"];
    expect(etag).toBeTruthy();
    const second = await get("/assets/app-abc123.js", {
      "accept-encoding": "identity",
      "if-none-match": String(etag),
    });
    expect(second.status).toBe(304);
    expect(second.body.length).toBe(0);
  });

  it("HEAD 请求只返回头部", async () => {
    const res = await get("/assets/app-abc123.js", { "accept-encoding": "br" }, "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.body.length).toBe(0);
  });

  it("拒绝直接访问预压缩文件与目录穿越", async () => {
    const direct = await get("/assets/app-abc123.js.br");
    expect(direct.status).toBe(404);

    const traversal = await get("/..%2f..%2f..%2fetc%2fpasswd", { "accept-encoding": "identity" });
    // 目录穿越不会读到仓库外的文件，落到 SPA 兜底（index.html）
    expect(traversal.body.toString("utf8")).not.toContain("root:");
    expect(traversal.body.toString("utf8")).toContain("测试站点");
  });

  it("SVG 等文本资源同样参与压缩协商", async () => {
    const res = await get("/logo.svg", { "accept-encoding": "identity" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
  });
});
