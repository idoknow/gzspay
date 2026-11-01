#!/usr/bin/env node
/**
 * 授予 / 撤销管理后台权限。
 *
 * 用法：
 *   node scripts/grant-admin.mjs --list                       # 列出当前管理员与候选账号
 *   node scripts/grant-admin.mjs --sub <校园墙 sub>           # 授予超级管理员
 *   node scripts/grant-admin.mjs --email <邮箱> --role ops   # 按邮箱授予运营
 *   node scripts/grant-admin.mjs --qq <QQ号> --role auditor  # 按 QQ 号授予只读审计
 *   node scripts/grant-admin.mjs --sub <sub> --revoke        # 撤销管理员
 *
 * 说明：管理后台只认「校园墙 sub 在 admins 表中」的账号，角色为 super / ops / auditor。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ROOT = path.join(REPO_ROOT, "server");
const ROLES = new Set(["super", "ops", "auditor"]);

/** 依次读仓库根与 server/ 下的 .env，取第一个非空的 DATABASE_PATH */
function readDatabasePath() {
  for (const file of [path.join(REPO_ROOT, ".env"), path.join(SERVER_ROOT, ".env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
      const match = /^\s*DATABASE_PATH\s*=\s*(.+?)\s*$/.exec(line);
      if (!match) continue;
      const raw = (match[1] ?? "").replace(/^["']|["']$/g, "");
      if (!raw) continue;
      return path.isAbsolute(raw) ? raw : path.resolve(SERVER_ROOT, raw);
    }
  }
  return path.join(SERVER_ROOT, "data", "gzspay.sqlite");
}

function parseArgs(argv) {
  const args = { role: "super", revoke: false, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--list") args.list = true;
    else if (token === "--revoke") args.revoke = true;
    else if (token === "--role") args.role = argv[++i];
    else if (token === "--sub") args.sub = argv[++i];
    else if (token === "--email") args.email = argv[++i];
    else if (token === "--qq") args.qq = argv[++i];
    else if (token === "--user-id") args.userId = argv[++i];
    else if (token === "--db") args.db = argv[++i];
    else if (token === "--help" || token === "-h") args.help = true;
    else {
      console.error(`未知参数：${token}（用 --help 查看用法）`);
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log(`授予 / 撤销管理后台权限

  node scripts/grant-admin.mjs --list                       列出管理员与候选账号
  node scripts/grant-admin.mjs --sub <校园墙 sub>           授予超级管理员
  node scripts/grant-admin.mjs --email <邮箱> --role ops    按邮箱授予运营
  node scripts/grant-admin.mjs --qq <QQ号>                  按 QQ 号授权
  node scripts/grant-admin.mjs --user-id <用户 id> --role auditor
  node scripts/grant-admin.mjs --sub <sub> --revoke         撤销管理员

可选：--db <数据库路径>（默认读 .env 的 DATABASE_PATH）
角色：super（全部）, ops（运营，不能改系统配置）, auditor（只读审计）`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const dbPath = args.db ? path.resolve(args.db) : readDatabasePath();
if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}\n先启动一次服务让它建库，或用 --db 指定路径。`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

function displayName(row) {
  const name = [row.surname, row.given_name].filter(Boolean).join("");
  return name || row.campux_username || row.qq || row.campux_sub || row.id;
}

function list() {
  const admins = db
    .prepare(
      `SELECT a.role, a.created_at, u.id, u.campux_sub, u.qq, u.email, u.surname, u.given_name, u.campux_username
       FROM admins a JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at`,
    )
    .all();
  console.log(`数据库：${dbPath}`);
  console.log(`\n管理员（${admins.length}）：`);
  for (const row of admins) {
    console.log(`  ${row.role.padEnd(8)} ${displayName(row)}  邮箱=${row.email || "-"}  sub=${row.campux_sub}`);
  }
  const candidates = db
    .prepare(
      `SELECT id, campux_sub, qq, email, surname, given_name, campux_username, onboarded
       FROM users ORDER BY created_at DESC LIMIT 15`,
    )
    .all();
  console.log(`\n最近的账号（可作为候选）：`);
  for (const row of candidates) {
    const sub = `--sub ${row.campux_sub}`;
    console.log(`  ${displayName(row)}  邮箱=${row.email || "-"}  引导=${row.onboarded ? "完成" : "未完成"}  ${sub}`);
  }
}

function findUser() {
  const conditions = [];
  const params = [];
  if (args.userId) {
    conditions.push("id = ?");
    params.push(args.userId);
  }
  if (args.sub) {
    conditions.push("campux_sub = ?");
    params.push(args.sub);
  }
  if (args.email) {
    conditions.push("email = ?");
    params.push(args.email);
  }
  if (args.qq) {
    conditions.push("qq = ?");
    params.push(args.qq);
  }
  if (conditions.length === 0) {
    console.error("请用 --sub / --email / --qq / --user-id 指定账号（或 --list 先看看有谁）。");
    process.exit(1);
  }
  const rows = db.prepare(`SELECT * FROM users WHERE ${conditions.join(" AND ")}`).all(...params);
  if (rows.length === 0) {
    console.error(`没有匹配的账号（${conditions.join(" 且 ")}）。先用校园墙登录一次，让账号建好，再执行本命令。`);
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(`匹配到 ${rows.length} 个账号，请改用 --sub 或 --user-id 精确定位：`);
    for (const row of rows) console.error(`  ${displayName(row)}  id=${row.id}  sub=${row.campux_sub}`);
    process.exit(1);
  }
  return rows[0];
}

if (args.list) {
  list();
  process.exit(0);
}

const role = String(args.role || "super").toLowerCase();
if (!ROLES.has(role)) {
  console.error(`角色只能是 super / ops / auditor，收到：${args.role}`);
  process.exit(1);
}

const user = findUser();

if (args.revoke) {
  const result = db.prepare("DELETE FROM admins WHERE user_id = ?").run(user.id);
  db.close();
  if (result.changes === 0) {
    console.log(`${displayName(user)} 本来就不是管理员。`);
  } else {
    console.log(`已撤销 ${displayName(user)} 的管理员权限。`);
  }
  process.exit(0);
}

db.prepare(
  "INSERT OR REPLACE INTO admins (user_id, role, created_by, created_at) VALUES (?, ?, NULL, ?)",
).run(user.id, role, new Date().toISOString());
db.close();

console.log(`已授予 ${displayName(user)} 管理员权限（角色 ${role}）。`);
console.log(`登录地址：${(process.env.PUBLIC_BASE_URL || "http://localhost:5173").replace(/\/+$/, "")}/admin`);
console.log("如果该账号已验证邮箱，登录后还需要输入邮箱验证码（未配置 SMTP 时验证码在 mail_outbox 表）。");
