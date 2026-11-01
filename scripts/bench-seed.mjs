/**
 * 压测数据准备：把当前数据库复制一份到 server/data/bench.sqlite，
 * 并为指定学号的用户写入一个 7 天有效的测试会话，输出 { dbPath, cookie }。
 *
 * 用法：
 *   node scripts/bench-seed.mjs > .bench-meta.json
 *   BENCH_STUDENT_NO=26910513 BENCH_DB_PATH=server/data/bench.sqlite node scripts/bench-seed.mjs
 *
 * 注意：
 *   - 需要先把 server 端 .env 配好（SESSION_SECRET 必填）。
 *   - 复制使用的是 SQLite 的 VACUUM INTO，源库有写入时也能拿到一致快照。
 *   - 输出的库只用于压测，不要指向生产库。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const envPath = existsSync(path.join(root, ".env")) ? path.join(root, ".env") : path.join(root, "server", ".env");
const env = new Map();
for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env.set(match[1], match[2]);
}

const secret = env.get("SESSION_SECRET");
if (!secret) throw new Error("SESSION_SECRET 未配置（server/.env）");

const studentNo = process.env.BENCH_STUDENT_NO ?? "26910513";
const dbRel = process.env.BENCH_SOURCE_DB ?? env.get("DATABASE_PATH") ?? "data/gzspay.sqlite";
const sourcePath = path.isAbsolute(dbRel) ? dbRel : path.resolve(root, "server", dbRel);
const benchPath = process.env.BENCH_DB_PATH
  ? path.resolve(root, process.env.BENCH_DB_PATH)
  : path.resolve(root, "server", "data", "bench.sqlite");

if (sourcePath === benchPath) throw new Error("源库与压测库不能是同一个文件");

const source = new DatabaseSync(sourcePath, { readOnly: true });
source.exec(`VACUUM INTO '${benchPath.replaceAll("'", "''")}'`);
source.close();

const bench = new DatabaseSync(benchPath);
const user = bench.prepare("SELECT id FROM users WHERE student_no = ?").get(studentNo);
if (!user) throw new Error(`找不到学号为 ${studentNo} 的用户，请先换成库中已有账号（BENCH_STUDENT_NO）`);

const token = process.env.BENCH_TOKEN ?? "bench-session-token-1234567890";
const sessionId = createHash("sha256").update(`${token}.${secret}`).digest("hex");
const now = new Date();
bench
  .prepare(
    `INSERT OR REPLACE INTO sessions (id, user_id, kind, ip, user_agent, created_at, expires_at, last_seen_at)
     VALUES (?, ?, 'user', '127.0.0.1', 'bench', ?, ?, ?)`,
  )
  .run(
    sessionId,
    user.id,
    now.toISOString(),
    new Date(now.getTime() + 7 * 86400_000).toISOString(),
    now.toISOString(),
  );
bench.close();

console.log(JSON.stringify({ dbPath: benchPath, cookie: `gzs_session=${token}` }));
