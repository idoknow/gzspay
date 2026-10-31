#!/usr/bin/env node
/**
 * 本地开发：同时启动后端（tsx watch）与前端（vite dev server）。
 * 用法：npm run dev
 */
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const children = [
  spawn(npm, ["run", "dev", "-w", "@gzspay/server"], { stdio: "inherit" }),
  spawn(npm, ["run", "dev", "-w", "@gzspay/web"], { stdio: "inherit" }),
];

let exiting = false;

function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!exiting) shutdown(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(`[dev] 子进程启动失败：${error.message}`);
    shutdown(1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
