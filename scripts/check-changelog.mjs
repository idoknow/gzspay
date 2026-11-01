#!/usr/bin/env node
/**
 * 校验 CHANGELOG.md 是否随代码改动同步更新。
 *
 * 用法：
 *   node scripts/check-changelog.mjs           校验 CHANGELOG.md 的「未发布」小节是否填写完整
 *   node scripts/check-changelog.mjs --staged  额外校验暂存区里的代码改动是否带上 CHANGELOG.md
 *
 * 跳过（仅限紧急情况）：GZSPAY_SKIP_CHANGELOG_CHECK=1
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG_PATH = path.join(REPO_ROOT, "CHANGELOG.md");
const CHANGELOG_NAME = "CHANGELOG.md";
/** 命中这些前缀的暂存文件视为「代码改动」，必须同时更新更新日志。 */
const CODE_PREFIXES = ["server/src/", "server/tests/", "web/src/", "scripts/"];
const SECTIONS = ["新增", "变更", "修复"];

function fail(message) {
  console.error(`\u2717 ${message}`);
  process.exit(1);
}

function readChangelog() {
  try {
    return readFileSync(CHANGELOG_PATH, "utf-8");
  } catch {
    fail(`找不到 ${CHANGELOG_NAME}（预期路径：${CHANGELOG_PATH}）`);
  }
}

/** 解析「未发布」小节，返回各分类下的条目。 */
function parseUnreleased(text) {
  const lines = text.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s+\[?未发布\]?\s*$/.test(line.trim()));
  if (headingIndex === -1) {
    fail(`「未发布」小节不存在：请在 ${CHANGELOG_NAME} 中保留 \`## [未发布]\` 标题并记录本次改动。`);
  }

  const body = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^##\s+/.test(line)) break;
    body.push(line);
  }

  const groups = new Map();
  let current = "其他";
  for (const line of body) {
    const sub = /^###\s+(.+?)\s*$/.exec(line);
    if (sub) {
      current = (sub[1] ?? "").trim();
      if (!groups.has(current)) groups.set(current, []);
      continue;
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!item) continue;
    const value = (item[1] ?? "").trim();
    if (!value) {
      fail(`「未发布 · ${current}」下存在空条目，请写清本次改动的内容。`);
    }
    if (!groups.has(current)) groups.set(current, []);
    groups.get(current).push(value);
  }

  return groups;
}

function checkStructure() {
  const text = readChangelog();
  if (!/^#\s+更新日志/m.test(text)) {
    fail(`${CHANGELOG_NAME} 缺少「# 更新日志」标题。`);
  }

  const groups = parseUnreleased(text);
  const total = [...groups.values()].reduce((sum, items) => sum + items.length, 0);
  if (total === 0) {
    // 刚发布版本后「未发布」会是空的，属于正常状态；防遗漏交给 --staged 模式的要点校验。
    console.log(`\u2713 ${CHANGELOG_NAME}「未发布」当前为空（刚发布过版本时正常），下次改动请按「新增 / 变更 / 修复」补条目。`);
    return groups;
  }

  for (const section of SECTIONS) {
    if (groups.has(section) && (groups.get(section) ?? []).length === 0) {
      fail(`「未发布 · ${section}」小标题下没有条目，请补内容或删掉这个小标题。`);
    }
  }

  const summary = SECTIONS.map((section) => `${section} ${(groups.get(section) ?? []).length} 条`).join(" / ");
  console.log(`\u2713 ${CHANGELOG_NAME}「未发布」已填写：${summary}（合计 ${total} 条）`);
  return groups;
}

/** --staged：CHANGELOG.md 的暂存改动里至少新增一条要点，避免只挪标题不算记录。 */
function assertStagedEntry() {
  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "--cached", "-U0", "--", CHANGELOG_NAME], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
  } catch {
    return;
  }

  const addedBullets = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .filter((line) => /^\s*[-*]\s+\S/.test(line));
  if (addedBullets.length === 0) {
    fail(
      `本次提交没有在 ${CHANGELOG_NAME} 新增任何条目：请在「未发布」小节按「新增 / 变更 / 修复」补一条。`,
    );
  }
}

/** --staged：有代码改动却没有暂存 CHANGELOG.md 时直接失败。 */
function checkStaged(groups) {
  let staged = [];
  try {
    const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
    staged = output.split(/\r?\n/).map((line) => line.trim().replace(/\\/g, "/")).filter(Boolean);
  } catch {
    console.warn("\u26a0 无法读取暂存区（git 不可用？），跳过「代码改动是否带更新日志」校验。");
    return;
  }

  if (staged.length === 0) {
    console.warn("\u26a0 暂存区为空，跳过「代码改动是否带更新日志」校验。");
    return;
  }

  const codeFiles = staged.filter((file) => CODE_PREFIXES.some((prefix) => file.startsWith(prefix)));
  if (codeFiles.length === 0) return;

  if (!staged.includes(CHANGELOG_NAME)) {
    fail(
      [
        "代码有改动，但本次提交没有更新 " + CHANGELOG_NAME + "：",
        ...codeFiles.slice(0, 8).map((file) => `    ${file}`),
        ...(codeFiles.length > 8 ? [`    …还有 ${codeFiles.length - 8} 个文件`] : []),
        `请在 ${CHANGELOG_NAME} 的「未发布」小节补一条（新增 / 变更 / 修复）后重新 git add。`,
      ].join("\n"),
    );
  }

  assertStagedEntry();
  console.log(`\u2713 本次提交包含代码改动（${codeFiles.length} 个文件），并已同步 ${CHANGELOG_NAME}。`);
}

if (process.env.GZSPAY_SKIP_CHANGELOG_CHECK) {
  console.warn("\u26a0 已通过 GZSPAY_SKIP_CHANGELOG_CHECK 跳过更新日志校验。");
  process.exit(0);
}

const groups = checkStructure();
if (process.argv.includes("--staged")) checkStaged(groups);
