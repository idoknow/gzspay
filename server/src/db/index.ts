import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { config } from "../config.js";

export type DbRow = Record<string, unknown>;

function resolveSchemaPath(): string {
  // 开发态：src/db/schema.sql；构建后：dist/db/schema.sql（由构建脚本复制）
  const candidates = [
    path.join(import.meta.dirname, "schema.sql"),
    path.join(import.meta.dirname, "..", "..", "src", "db", "schema.sql"),
  ];
  for (const file of candidates) {
    try {
      readFileSync(file);
      return file;
    } catch {
      // 继续尝试下一个路径
    }
  }
  throw new Error("找不到数据库结构文件 schema.sql");
}

function openDatabase(): DatabaseSync {
  const dbPath = config.isTest ? config.testDatabasePath : config.databasePath;
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA foreign_keys = ON;");
  // 高并发读写的几个关键 pragma：WAL 让读不阻塞写，NORMAL 省掉每次 fsync，
  // busy_timeout 避免瞬时写冲突直接报 SQLITE_BUSY。
  if (dbPath !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec("PRAGMA wal_autocheckpoint = 1000;");
    database.exec("PRAGMA mmap_size = 268435456;");
  }
  database.exec("PRAGMA synchronous = NORMAL;");
  database.exec("PRAGMA temp_store = MEMORY;");
  database.exec("PRAGMA cache_size = -16000;");
  return database;
}

export const db: DatabaseSync = openDatabase();

/** 应用数据库结构（幂等） */
export function migrate(): void {
  const schema = readFileSync(resolveSchemaPath(), "utf-8");
  db.exec(schema);
  applyLegacyMigrations();
  ensureBillTradeUniqueness();
  const version = 4;
  const exists = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(version);
  if (!exists) {
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
      version,
      new Date().toISOString(),
    );
  }
}

/**
 * 账单流水唯一索引：老库里可能已经有重复的（商家 + 渠道 + 交易单号）流水，
 * 直接建唯一索引会让旧库启动失败，所以先去重（保留最早一条）再建索引。
 */
function ensureBillTradeUniqueness(): void {
  try {
    db.exec(`
      DELETE FROM bill_transactions
      WHERE trade_no != ''
        AND rowid NOT IN (
          SELECT MIN(rowid) FROM bill_transactions
          WHERE trade_no != ''
          GROUP BY merchant_id, provider, trade_no
        );
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_transactions_trade
        ON bill_transactions(merchant_id, provider, trade_no)
        WHERE trade_no != '';
    `);
  } catch (error) {
    // 索引只用于防重放，建不成也不能挡住启动
    console.warn("[gzspay] 账单流水唯一索引创建失败：", error instanceof Error ? error.message : error);
  }
}

/** 为已存在的旧库补齐新增列（CREATE TABLE IF NOT EXISTS 不会改结构） */
function applyLegacyMigrations(): void {
  const columns = db
    .prepare("PRAGMA table_info(login_logs)")
    .all() as { name: string }[];
  if (!columns.some((column) => column.name === "method")) {
    db.exec("ALTER TABLE login_logs ADD COLUMN method TEXT;");
  }
  const userColumns = db
    .prepare("PRAGMA table_info(users)")
    .all() as { name: string }[];
  if (!userColumns.some((column) => column.name === "nfc_token")) {
    db.exec("ALTER TABLE users ADD COLUMN nfc_token TEXT;");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nfc_token ON users(nfc_token);");
  const orderColumns = db
    .prepare("PRAGMA table_info(orders)")
    .all() as { name: string }[];
  if (!orderColumns.some((column) => column.name === "flag_reason")) {
    db.exec("ALTER TABLE orders ADD COLUMN flag_reason TEXT;");
  }
  if (!orderColumns.some((column) => column.name === "payment_proof")) {
    db.exec("ALTER TABLE orders ADD COLUMN payment_proof TEXT;");
  }
  const announcementColumns = db
    .prepare("PRAGMA table_info(announcements)")
    .all() as { name: string }[];
  if (!announcementColumns.some((column) => column.name === "level")) {
    db.exec("ALTER TABLE announcements ADD COLUMN level TEXT NOT NULL DEFAULT 'info';");
  }
  if (!announcementColumns.some((column) => column.name === "published_at")) {
    db.exec("ALTER TABLE announcements ADD COLUMN published_at TEXT;");
    db.exec("UPDATE announcements SET published_at = created_at WHERE published_at IS NULL;");
  }
  // 索引依赖 published_at 列，必须在补齐列之后再建（旧库直接执行 schema 会报 no such column）
  db.exec("CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(published_at);");

  const ticketMessageColumns = db
    .prepare("PRAGMA table_info(ticket_messages)")
    .all() as { name: string }[];
  if (!ticketMessageColumns.some((column) => column.name === "sender_kind")) {
    db.exec("ALTER TABLE ticket_messages ADD COLUMN sender_kind TEXT NOT NULL DEFAULT 'user';");
    // 历史消息没有来源标记：发送者不是订单双方的，就是平台客服在后台发的
    db.exec(
      `UPDATE ticket_messages SET sender_kind = 'admin'
        WHERE NOT EXISTS (
          SELECT 1 FROM tickets t JOIN orders o ON o.id = t.order_id
          WHERE t.id = ticket_messages.ticket_id
            AND ticket_messages.sender_id IN (o.payer_id, o.merchant_id)
        );`,
    );
  }

  const notificationColumns = db
    .prepare("PRAGMA table_info(notification_settings)")
    .all() as { name: string }[];
  if (!notificationColumns.some((column) => column.name === "ticket")) {
    db.exec("ALTER TABLE notification_settings ADD COLUMN ticket INTEGER NOT NULL DEFAULT 1;");
  }
  if (!notificationColumns.some((column) => column.name === "announcement")) {
    db.exec("ALTER TABLE notification_settings ADD COLUMN announcement INTEGER NOT NULL DEFAULT 1;");
  }
  // 账号安全类通知（个人信息修改 / 密码修改 / 登录提醒）默认开启，旧库补齐列后保持开启
  if (!notificationColumns.some((column) => column.name === "profile")) {
    db.exec("ALTER TABLE notification_settings ADD COLUMN profile INTEGER NOT NULL DEFAULT 1;");
  }
  if (!notificationColumns.some((column) => column.name === "password")) {
    db.exec("ALTER TABLE notification_settings ADD COLUMN password INTEGER NOT NULL DEFAULT 1;");
  }
  if (!notificationColumns.some((column) => column.name === "login")) {
    db.exec("ALTER TABLE notification_settings ADD COLUMN login INTEGER NOT NULL DEFAULT 1;");
  }

  const ticketColumns = db
    .prepare("PRAGMA table_info(tickets)")
    .all() as { name: string }[];
  if (!ticketColumns.some((column) => column.name === "parties_reveal_status")) {
    // 旧工单没有披露流程：默认按「已批准」处理，保持既有工单里已展示的资料不突然消失
    db.exec(
      "ALTER TABLE tickets ADD COLUMN parties_reveal_status TEXT NOT NULL DEFAULT 'approved';",
    );
  }
  if (!ticketColumns.some((column) => column.name === "parties_reveal_requested_by")) {
    db.exec("ALTER TABLE tickets ADD COLUMN parties_reveal_requested_by TEXT REFERENCES users(id);");
  }
  if (!ticketColumns.some((column) => column.name === "parties_reveal_requested_at")) {
    db.exec("ALTER TABLE tickets ADD COLUMN parties_reveal_requested_at TEXT;");
  }
  if (!ticketColumns.some((column) => column.name === "parties_reveal_note")) {
    db.exec("ALTER TABLE tickets ADD COLUMN parties_reveal_note TEXT;");
  }
  if (!ticketColumns.some((column) => column.name === "parties_revealed_at")) {
    db.exec("ALTER TABLE tickets ADD COLUMN parties_revealed_at TEXT;");
  }
  if (!ticketColumns.some((column) => column.name === "parties_revealed_by")) {
    db.exec("ALTER TABLE tickets ADD COLUMN parties_revealed_by TEXT REFERENCES users(id);");
  }

  const channelColumns = db
    .prepare("PRAGMA table_info(merchant_channels)")
    .all() as { name: string }[];
  if (!channelColumns.some((column) => column.name === "pay_uid")) {
    db.exec("ALTER TABLE merchant_channels ADD COLUMN pay_uid TEXT NOT NULL DEFAULT '';");
  }
}

function normalizeParams(params: unknown[]): SQLInputValue[] {
  return params.map((param) => {
    if (param === undefined) return null;
    if (param === null) return null;
    if (typeof param === "boolean") return param ? 1 : 0;
    if (typeof param === "number") return param;
    if (typeof param === "bigint") return param;
    if (typeof param === "string") return param;
    if (param instanceof Uint8Array) return param;
    return JSON.stringify(param);
  });
}

/**
 * 预编译语句缓存：SQLite 每次 prepare 都要解析 SQL 并生成执行计划，
 * 高并发下这是很可观的开销。这里按 SQL 文本缓存 StatementSync，
 * 缓存上限内不会无限增长（超出时整体清空，简单且不会泄漏）。
 */
const STATEMENT_CACHE_LIMIT = 300;
const statementCache = new Map<string, ReturnType<DatabaseSync["prepare"]>>();

function cachedStatement(sql: string): ReturnType<DatabaseSync["prepare"]> {
  const hit = statementCache.get(sql);
  if (hit) return hit;
  const statement = db.prepare(sql);
  if (statementCache.size >= STATEMENT_CACHE_LIMIT) statementCache.clear();
  statementCache.set(sql, statement);
  return statement;
}

export function queryOne<T = DbRow>(sql: string, ...params: unknown[]): T | undefined {
  const stmt = cachedStatement(sql);
  const row = stmt.get(...normalizeParams(params));
  return row as T | undefined;
}

export function queryAll<T = DbRow>(sql: string, ...params: unknown[]): T[] {
  const stmt = cachedStatement(sql);
  return stmt.all(...normalizeParams(params)) as T[];
}

export function execute(
  sql: string,
  ...params: unknown[]
): { changes: number; lastInsertRowid: number | bigint } {
  const stmt = cachedStatement(sql);
  const result = stmt.run(...normalizeParams(params));
  return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
}

/** 批量写入：一个事务里跑多条语句，比逐条提交快一个数量级 */
export function runBatch(statements: { sql: string; params: unknown[] }[]): void {
  if (statements.length === 0) return;
  transaction(() => {
    for (const item of statements) {
      cachedStatement(item.sql).run(...normalizeParams(item.params));
    }
  });
}

let transactionDepth = 0;

/**
 * 在一个事务中执行；异常自动回滚。
 * 嵌套调用用 SAVEPOINT 实现（外层已经 BEGIN 时不会重复 BEGIN）。
 */
export function transaction<T>(fn: () => T): T {
  if (transactionDepth > 0) {
    const name = `sp_${transactionDepth}`;
    transactionDepth += 1;
    db.exec(`SAVEPOINT ${name};`);
    try {
      const result = fn();
      db.exec(`RELEASE ${name};`);
      return result;
    } catch (error) {
      try {
        db.exec(`ROLLBACK TO ${name};`);
        db.exec(`RELEASE ${name};`);
      } catch {
        // 忽略回滚失败
      }
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  }
  db.exec("BEGIN IMMEDIATE;");
  transactionDepth = 1;
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // 忽略回滚失败
    }
    throw error;
  } finally {
    transactionDepth = 0;
  }
}

/** 让 SQLite 重新统计索引使用情况并优化查询计划，适合在清理任务后偶尔调用 */
export function optimizeDatabase(): void {
  try {
    db.exec("PRAGMA optimize;");
  } catch {
    // 优化失败不影响业务
  }
}

/** 读取整数配置项（如金额上限），数据库配置优先于环境变量 */
export function getConfigValue(key: string): string | null {
  const row = queryOne<{ value: string }>("SELECT value FROM app_config WHERE key = ?", key);
  return row?.value ?? null;
}

export function getConfigInt(key: string, fallback: number): number {
  const raw = getConfigValue(key);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function setConfigValue(key: string, value: string): void {
  execute(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    nowIso(),
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoAfter(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/** 清理过期数据，定时调用 */
export function cleanupExpired(): void {
  const now = nowIso();
  execute("DELETE FROM sessions WHERE expires_at < ?", now);
  execute("DELETE FROM oauth_states WHERE expires_at < ?", now);
  execute("DELETE FROM email_codes WHERE expires_at < ?", now);
  execute("DELETE FROM password_reset_tokens WHERE expires_at < ?", now);
  execute("DELETE FROM dynamic_codes WHERE expires_at < ?", now);
  execute("DELETE FROM payment_requests WHERE expires_at < ? AND status = 'pending'", now);
  execute(
    "UPDATE payment_collections SET status = 'expired', decided_at = ? WHERE status = 'pending' AND expires_at < ?",
    now,
    now,
  );
  execute("DELETE FROM idempotency_keys WHERE created_at < ?", isoAfter(-86400));
  execute(
    `UPDATE tickets SET status = 'closed', closed_at = ?, closed_reason = 'timeout', updated_at = ?
      WHERE status = 'open' AND last_message_at < ?`,
    now,
    now,
    isoAfter(-7 * 86400),
  );
  execute("DELETE FROM request_metrics WHERE created_at < ?", isoAfter(-7 * 86400));
}

/** 测试用：重置整个数据库 */
export function resetDatabaseForTests(): void {
  const tables = queryAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  db.exec("PRAGMA foreign_keys = OFF;");
  for (const table of tables) {
    db.exec(`DELETE FROM "${table.name}";`);
  }
  db.exec("PRAGMA foreign_keys = ON;");
}

export function closeDatabase(): void {
  try {
    db.close();
  } catch {
    // 已关闭
  }
}
