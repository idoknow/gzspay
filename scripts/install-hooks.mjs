#!/usr/bin/env node
/**
 * 安装本地 git 钩子：提交前自动校验 CHANGELOG.md 是否同步更新。
 *
 * 用法：npm run hooks:install
 * 卸载：删除 .git/hooks/pre-commit（或在 git 目录下找 pre-commit）
 * 跳过单次校验：GZSPAY_SKIP_CHANGELOG_CHECK=1 git commit ...
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "check-changelog.mjs --staged";

function gitHooksDir() {
  try {
    const relative = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }).trim();
    return path.resolve(REPO_ROOT, relative);
  } catch {
    console.error("\u2717 当前目录不是 git 仓库，或未安装 git。");
    process.exit(1);
  }
}

const hooksDir = gitHooksDir();
const hookPath = path.join(hooksDir, "pre-commit");
const nodePath = process.execPath.replace(/\\/g, "/");

const hookScript = `#!/bin/sh
# 由 npm run hooks:install 生成：提交前校验 CHANGELOG.md 是否同步更新。
# 紧急情况可用 GZSPAY_SKIP_CHANGELOG_CHECK=1 git commit ... 跳过。
if [ -n "$GZSPAY_SKIP_CHANGELOG_CHECK" ]; then
  echo "\u26a0 已跳过更新日志校验（GZSPAY_SKIP_CHANGELOG_CHECK）"
  exit 0
fi
"${nodePath}" scripts/check-changelog.mjs --staged || exit 1
`;

if (existsSync(hookPath)) {
  const existing = readFileSync(hookPath, "utf-8");
  if (!existing.includes(MARKER)) {
    const backup = `${hookPath}.bak-${Date.now()}`;
    writeFileSync(`${backup}`, existing, "utf-8");
    console.log(`\u26a0 已存在其它 pre-commit 钩子，原文件备份为 ${path.basename(backup)}`);
  }
}

mkdirSync(hooksDir, { recursive: true });
writeFileSync(hookPath, hookScript, "utf-8");
try {
  chmodSync(hookPath, 0o755);
} catch {
  // Windows 下 chmod 可能无效，git 不依赖它
}

console.log(`\u2713 已安装提交前钩子：${hookPath}`);
console.log("  以后提交时若改了 server/src、web/src 等代码却没更新 CHANGELOG.md，提交会被拦下。");
