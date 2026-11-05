/**
 * 公告：发布、修改（修改后重新推送 = 清空已读记录）、读取与已读标记。
 *
 * 约定：
 * - 公告正文使用 Markdown 源文本，主站详情页负责渲染；
 * - 发布日期 `published_at` 默认等于创建时间，可由管理员修改；
 * - 用户是否已读记录在 `announcement_reads`，修改公告会清空记录，从而让所有人重新看到未读红点。
 */

import { db, nowIso, queryAll, queryOne } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { newId } from "../lib/crypto.js";
import { errors } from "../lib/errors.js";
import { sendMailInBackground, templates } from "../lib/mail.js";
import type { AnnouncementLevel, AnnouncementRow } from "../lib/types.js";

/** 公告邮件最多发多少人：一次发布超过这个数量只通知前 N 位（避免刷爆发件通道） */
const MAX_ANNOUNCEMENT_MAILS = 500;

export const ANNOUNCEMENT_LEVELS: AnnouncementLevel[] = ["info", "important", "warning"];

export function isAnnouncementLevel(value: string): value is AnnouncementLevel {
  return (ANNOUNCEMENT_LEVELS as string[]).includes(value);
}

/* ------------------------------------------------------------ 通用映射 */

/** 发布时间的兜底顺序：published_at → starts_at（历史数据）→ created_at */
export function publishedAtOf(row: AnnouncementRow): string {
  return row.published_at ?? row.starts_at ?? row.created_at;
}

function normalizeIso(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw errors.validation("发布日期格式不正确");
  return new Date(timestamp).toISOString();
}

function totalUserCount(): number {
  return queryOne<{ total: number }>("SELECT COUNT(*) AS total FROM users")?.total ?? 0;
}

function readCountMap(): Map<string, number> {
  const rows = queryAll<{ announcement_id: string; count: number }>(
    "SELECT announcement_id, COUNT(*) AS count FROM announcement_reads GROUP BY announcement_id",
  );
  return new Map(rows.map((row) => [row.announcement_id, row.count]));
}

/* ------------------------------------------------------------ 管理后台 */

export interface AdminAnnouncementDto {
  id: string;
  title: string;
  content: string;
  level: AnnouncementLevel;
  pinned: boolean;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  readCount: number;
  totalUsers: number;
  /** 内容是否被修改过（updated_at 晚于 created_at） */
  edited: boolean;
}

function toAdminDto(
  row: AnnouncementRow,
  readCount: number,
  totalUsers: number,
): AdminAnnouncementDto {
  const publishedAt = publishedAtOf(row);
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    level: row.level,
    pinned: row.pinned === 1,
    publishedAt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readCount,
    totalUsers,
    edited: row.updated_at !== row.created_at,
  };
}

export function adminAnnouncements(): { items: AdminAnnouncementDto[] } {
  const rows = queryAll<AnnouncementRow>(
    "SELECT * FROM announcements ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC",
  );
  const reads = readCountMap();
  const totalUsers = totalUserCount();
  return {
    items: rows.map((row) => toAdminDto(row, reads.get(row.id) ?? 0, totalUsers)),
  };
}

export interface AnnouncementInput {
  title: string;
  content: string;
  level: AnnouncementLevel;
  pinned: boolean;
  publishedAt: string | null;
}

/** 公告发布后给开启了「平台公告」邮件通知的用户发提醒（后台发送，不影响公告创建） */
function mailAnnouncement(title: string, content: string): void {
  const recipients = queryAll<{ email: string }>(
    // 没有设置记录的用户按默认开启处理（LEFT JOIN + COALESCE）
    `SELECT u.email AS email
       FROM users u
       LEFT JOIN notification_settings n ON n.user_id = u.id
      WHERE COALESCE(n.announcement, 1) = 1 AND u.email IS NOT NULL AND u.email != ''
      ORDER BY u.created_at ASC
      LIMIT ?`,
    MAX_ANNOUNCEMENT_MAILS,
  );
  for (const recipient of recipients) {
    sendMailInBackground(templates.announcement({ to: recipient.email, title, body: content }));
  }
}

/** 公告正文里的 Markdown 链接不允许危险协议（前端也会再做一次白名单） */
const UNSAFE_LINK_PATTERN = /\]\(\s*(?:javascript|data|vbscript|file)\s*:/i;

function assertSafeAnnouncementContent(content: string): void {
  if (UNSAFE_LINK_PATTERN.test(content)) {
    throw errors.validation("公告里的链接只支持 http(s)、mailto 或站内地址");
  }
}

export function createAnnouncement(
  actorId: string,
  input: AnnouncementInput,
  ip: string,
): { ok: true; id: string } {
  assertSafeAnnouncementContent(input.content);
  const id = newId();
  const timestamp = nowIso();
  const publishedAt = normalizeIso(input.publishedAt) ?? timestamp;
  db.prepare(
    `INSERT INTO announcements
       (id, title, content, level, starts_at, ends_at, published_at, pinned, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.content,
    input.level,
    publishedAt,
    publishedAt,
    publishedAt,
    input.pinned ? 1 : 0,
    actorId,
    timestamp,
    timestamp,
  );
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.announcement.created",
    targetType: "announcement",
    targetId: id,
    detail: input.title,
    ip,
  });
  mailAnnouncement(input.title, input.content);
  return { ok: true, id };
}

export interface AnnouncementUpdateResult {
  ok: true;
  /** 是否因为内容变化而重新推送（已读记录被清空） */
  republished: boolean;
}

export function updateAnnouncement(
  actorId: string,
  id: string,
  input: AnnouncementInput,
  ip: string,
): AnnouncementUpdateResult {
  const row = queryOne<AnnouncementRow>("SELECT * FROM announcements WHERE id = ?", id);
  if (!row) throw errors.notFound("公告不存在");
  assertSafeAnnouncementContent(input.content);

  const publishedAt = normalizeIso(input.publishedAt) ?? publishedAtOf(row);
  const contentChanged =
    row.title !== input.title ||
    row.content !== input.content ||
    row.level !== input.level ||
    publishedAtOf(row) !== publishedAt;

  const timestamp = nowIso();
  db.prepare(
    `UPDATE announcements
        SET title = ?, content = ?, level = ?, starts_at = ?, ends_at = ?, published_at = ?, pinned = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    input.title,
    input.content,
    input.level,
    row.starts_at,
    row.ends_at,
    publishedAt,
    input.pinned ? 1 : 0,
    timestamp,
    id,
  );

  if (contentChanged) {
    // 重新推送：清空已读记录，所有用户都会重新看到未读红点
    db.prepare("DELETE FROM announcement_reads WHERE announcement_id = ?").run(id);
  }

  writeAudit({
    actorId,
    actorRole: "admin",
    action: contentChanged ? "admin.announcement.republished" : "admin.announcement.updated",
    targetType: "announcement",
    targetId: id,
    detail: input.title,
    ip,
  });
  return { ok: true, republished: contentChanged };
}

export function deleteAnnouncement(
  actorId: string,
  id: string,
  ip: string,
): { ok: true } {
  const row = queryOne<AnnouncementRow>("SELECT * FROM announcements WHERE id = ?", id);
  if (!row) throw errors.notFound("公告不存在");
  db.prepare("DELETE FROM announcement_reads WHERE announcement_id = ?").run(id);
  db.prepare("DELETE FROM announcements WHERE id = ?").run(id);
  writeAudit({
    actorId,
    actorRole: "admin",
    action: "admin.announcement.deleted",
    targetType: "announcement",
    targetId: id,
    detail: row.title,
    ip,
  });
  return { ok: true };
}

/* ------------------------------------------------------------ 主站用户 */

export interface UserAnnouncementDto {
  id: string;
  title: string;
  content: string;
  level: AnnouncementLevel;
  pinned: boolean;
  publishedAt: string;
  updatedAt: string;
  createdAt: string;
  read: boolean;
}

function orderedAnnouncementRows(): AnnouncementRow[] {
  return queryAll<AnnouncementRow>(
    "SELECT * FROM announcements ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC",
  );
}

function readIdsOf(userId: string): Set<string> {
  const rows = queryAll<{ announcement_id: string }>(
    "SELECT announcement_id FROM announcement_reads WHERE user_id = ?",
    userId,
  );
  return new Set(rows.map((row) => row.announcement_id));
}

function countUnreadOf(userId: string): number {
  const row = queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM announcements a
      WHERE NOT EXISTS (
        SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = ?
      )`,
    userId,
  );
  return row?.total ?? 0;
}

export function userAnnouncements(userId: string): {
  items: UserAnnouncementDto[];
  unreadCount: number;
} {
  const readIds = readIdsOf(userId);
  const items = orderedAnnouncementRows().map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    level: row.level,
    pinned: row.pinned === 1,
    publishedAt: publishedAtOf(row),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    read: readIds.has(row.id),
  }));
  return { items, unreadCount: items.filter((item) => !item.read).length };
}

export function markAnnouncementRead(
  userId: string,
  id: string,
): { ok: true; unreadCount: number } {
  const row = queryOne<AnnouncementRow>("SELECT * FROM announcements WHERE id = ?", id);
  if (!row) throw errors.notFound("公告不存在");
  db.prepare(
    "INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at) VALUES (?, ?, ?)",
  ).run(id, userId, nowIso());
  return { ok: true, unreadCount: countUnreadOf(userId) };
}

export function unreadAnnouncementCount(userId: string): number {
  return countUnreadOf(userId);
}
