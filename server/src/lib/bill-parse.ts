/**
 * 商家收款账单解析。
 *
 * 支持两种导出文件：
 * - 支付宝「记账本」导出的 CSV（GBK 编码，前几行是说明文字，表头含「记录时间」「收支类型」）；
 * - 微信支付「账单流水」导出的 XLSX（第 1 张表，表头含「交易时间」「收/支」「金额(元)」）。
 *
 * 不引入第三方解析库：CSV 自己按引号切分，XLSX 用 node:zlib 解 zip 后读 sharedStrings + sheet1。
 */

import { inflateRawSync } from "node:zlib";
import { AppError, errors } from "./errors.js";

export type BillProvider = "alipay" | "wechat";

export interface ParsedBillRow {
  /** 交易单号（账单里有就存，没有留空） */
  tradeNo: string | null;
  /** 金额（分） */
  amountCents: number;
  /** 账单里的备注 / 商品说明，用于和订单备注匹配 */
  payerNote: string;
  /** 交易对方（微信「交易对方」、支付宝「账户」） */
  counterparty: string | null;
  /** 收款时间（ISO，按服务器本地时区解释账单里的时间） */
  paidAt: string;
}

export interface ParsedBill {
  provider: BillProvider;
  periodStart: string | null;
  periodEnd: string | null;
  rows: ParsedBillRow[];
}

const NOTE_LIMIT = 200;

/** 按文件名 / 文件头判断是哪种账单 */
export function detectBillProvider(filename: string, buffer: Buffer): BillProvider {
  const lower = filename.toLowerCase();
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (lower.endsWith(".xlsx") || isZip) return "wechat";
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return "alipay";
  throw errors.validation("请上传 .csv（支付宝账单）或 .xlsx（微信账单）文件");
}

/** 解析账单文件；格式不识别时抛 400 */
export function parseBillFile(filename: string, buffer: Buffer): ParsedBill {
  const provider = detectBillProvider(filename, buffer);
  return provider === "wechat" ? parseWechatBill(buffer) : parseAlipayBill(buffer);
}

function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    // 支付宝账单是 GBK 编码
  }
  try {
    return new TextDecoder("gbk").decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function trimNote(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_LIMIT);
}

/** 单笔金额上限（1 万元），避免超长数字串解析出 Infinity 之类的脏数据 */
const MAX_BILL_AMOUNT_CENTS = 1_000_000;

function parseMoneyCents(raw: string): number | null {
  const cleaned = raw.replace(/[¥￥,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_BILL_AMOUNT_CENTS) return null;
  return cents;
}

/** 账单时间统一按东八区（微信/支付宝导出的都是 UTC+08:00）解释成 ISO */
function isoFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): string {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second)).toISOString();
}

/** 账单时间形如「2026-08-26 17:20:43」 */
function parseLocalDateTime(raw: string): string | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return isoFromParts(
    Number(y),
    Number(mo),
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? "0"),
  );
}

/** 微信账单有时把时间存成 Excel 日期序列号（如 46311.88190972222） */
function parseWechatTime(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const parsed = parseLocalDateTime(text);
  if (parsed) return parsed;
  const serial = Number(text);
  if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) return null;
  const wall = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
  return isoFromParts(
    wall.getUTCFullYear(),
    wall.getUTCMonth() + 1,
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
  );
}

// ---------------------------------------------------------------------------
// 支付宝 CSV
// ---------------------------------------------------------------------------

interface AlipayColumn {
  time: number;
  direction: number;
  amount: number;
  note: number;
  account: number;
  tradeNo: number;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function findAlipayHeader(lines: string[][]): { index: number; columns: AlipayColumn } | null {
  for (let i = 0; i < lines.length; i += 1) {
    const cells = lines[i];
    if (!cells) continue;
    const time = cells.indexOf("记录时间");
    const direction = cells.indexOf("收支类型");
    if (time < 0 || direction < 0) continue;
    return {
      index: i,
      columns: {
        time,
        direction,
        amount: cells.indexOf("金额"),
        note: cells.indexOf("备注"),
        account: cells.indexOf("账户"),
        tradeNo: Math.max(cells.indexOf("交易单号"), cells.indexOf("来源单号")),
      },
    };
  }
  return null;
}

/** CSV 解析上限：账单文件 ≤5MB，这里再兜底避免超长行/超多行拖慢解析 */
const MAX_CSV_LINES = 20_000;
const MAX_CSV_LINE_CHARS = 4_000;
const MAX_BILL_ROWS = 5_000;

function parseAlipayBill(buffer: Buffer): ParsedBill {
  const text = decodeText(buffer);
  const rawLines = text.split(/\r?\n/);
  if (rawLines.length > MAX_CSV_LINES) {
    throw errors.validation(`账单行数太多（超过 ${MAX_CSV_LINES} 行），请分批上传`);
  }
  const lines: string[][] = [];
  for (const line of rawLines) {
    if (line.length > MAX_CSV_LINE_CHARS) continue;
    const cells = splitCsvLine(line);
    if (cells.some((cell) => cell !== "")) lines.push(cells);
  }
  const header = findAlipayHeader(lines);
  if (!header) throw errors.validation("没有识别到支付宝账单表头，请上传支付宝记账本导出的 CSV");

  const rows: ParsedBillRow[] = [];
  for (const cells of lines.slice(header.index + 1)) {
    const direction = cells[header.columns.direction] ?? "";
    if (!direction.includes("收入")) continue;
    if (direction.includes("支出") || direction.includes("不计收支")) continue;
    const amountCents = parseMoneyCents(cells[header.columns.amount] ?? "");
    if (amountCents === null || amountCents <= 0) continue;
    const paidAt = parseLocalDateTime(cells[header.columns.time] ?? "");
    if (!paidAt) continue;
    const note = trimNote(
      cells[header.columns.note] ??
        (header.columns.account >= 0 ? cells[header.columns.account] : ""),
    );
    const tradeNo =
      header.columns.tradeNo >= 0 ? trimNote(cells[header.columns.tradeNo]).slice(0, 64) : "";
    rows.push({
      tradeNo: tradeNo && tradeNo !== "/" ? tradeNo : null,
      amountCents,
      payerNote: note,
      counterparty:
        header.columns.account >= 0 ? trimNote(cells[header.columns.account]) || null : null,
      paidAt,
    });
    if (rows.length > MAX_BILL_ROWS) {
      throw errors.validation(`账单里收款记录太多（超过 ${MAX_BILL_ROWS} 笔），请分批上传`);
    }
  }
  return withPeriod("alipay", rows);
}

// ---------------------------------------------------------------------------
// 微信 XLSX
// ---------------------------------------------------------------------------

/** xlsx 解压上限：防止 zip bomb 把进程内存打爆（账单文件本身 ≤5MB） */
const MAX_ZIP_ENTRIES = 128;
const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 32 * 1024 * 1024;
/** 压缩比上限：正常 xlsx 的 XML 压缩比远低于这个值 */
const MAX_ZIP_RATIO = 200;
/** 只解压解析需要的条目，其它（图片、样式、批注等）一律跳过 */
const ZIP_ENTRY_PATTERN = /^xl\/(?:sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml)$/;

function unzip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = -1;
  const minOffset = Math.max(0, buffer.length - 65_558);
  for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x0605_4b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw errors.validation("账单文件不是有效的 xlsx，请重新导出后再上传");
  const count = buffer.readUInt16LE(eocd + 10);
  if (count > MAX_ZIP_ENTRIES) {
    throw errors.validation("账单文件内容异常（压缩包条目过多），请重新导出后再上传");
  }
  let offset = buffer.readUInt32LE(eocd + 16);
  let totalBytes = 0;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== 0x0201_4b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength > buffer.length) break;
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (method !== 0 && method !== 8) continue;
    if (!ZIP_ENTRY_PATTERN.test(name)) continue;
    // 本地文件头必须完整且签名正确，避免把任意字节段当作压缩流
    if (localOffset + 30 > buffer.length) break;
    if (buffer.readUInt32LE(localOffset) !== 0x0403_4b50) break;
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) break;
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw errors.validation("账单文件内容异常（单个文件解压后过大），请重新导出后再上传");
    }
    if (compressedSize > 0 && uncompressedSize > compressedSize * MAX_ZIP_RATIO + 1_048_576) {
      throw errors.validation("账单文件内容异常（解压比例过高），请重新导出后再上传");
    }
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    try {
      let content: Buffer | null = null;
      if (method === 0) content = Buffer.from(raw);
      // maxOutputLength 兜底：即使中央目录谎报大小也不会解压出超过上限的数据
      else content = inflateRawSync(raw, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
      if (!content) continue;
      totalBytes += content.length;
      if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
        throw errors.validation("账单文件内容异常（解压后总大小超限），请重新导出后再上传");
      }
      files.set(name, content);
    } catch (error) {
      if (error instanceof AppError) throw error;
      // 单个文件解压失败不影响其它文件
    }
  }
  return files;
}

/** 工作表 XML / 行数 / 列数上限：防止手写解析被超大或畸形 XML 拖死 */
const MAX_SHEET_XML_CHARS = 16 * 1024 * 1024;
const MAX_SHEET_ROWS = 20_000;
const MAX_SHEET_COLUMNS = 64;
const MAX_ROW_BODY_CHARS = 200_000;
const MAX_SHARED_STRINGS = 100_000;
const MAX_SHARED_STRING_CHARS = 4_096;

function codePointOf(raw: string, radix: number): string {
  const code = Number.parseInt(raw, radix);
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codePointOf(hex, 16))
    .replace(/&#(\d+);/g, (_, dec: string) => codePointOf(dec, 10))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml: string): string[] {
  const items: string[] = [];
  let cursor = 0;
  while (items.length < MAX_SHARED_STRINGS) {
    const start = xml.indexOf("<si", cursor);
    if (start < 0) break;
    const gt = xml.indexOf(">", start);
    if (gt < 0) break;
    if (xml.startsWith("/>", gt + 1)) {
      items.push("");
      cursor = gt + 3;
      continue;
    }
    const close = xml.indexOf("</si>", gt);
    if (close < 0) break;
    const inner = xml.slice(gt + 1, Math.min(close, gt + 1 + MAX_SHARED_STRING_CHARS));
    let text = "";
    let innerCursor = 0;
    while (text.length < MAX_SHARED_STRING_CHARS) {
      const tStart = inner.indexOf("<t", innerCursor);
      if (tStart < 0) break;
      const tGt = inner.indexOf(">", tStart);
      if (tGt < 0) break;
      const tClose = inner.indexOf("</t>", tGt);
      if (tClose < 0) break;
      text += decodeXml(inner.slice(tGt + 1, tClose));
      innerCursor = tClose + 4;
    }
    items.push(text.slice(0, MAX_SHARED_STRING_CHARS));
    cursor = close + 5;
  }
  return items;
}

function columnIndex(letters: string): number {
  if (letters.length === 0 || letters.length > 3) return -1;
  let index = 0;
  for (const char of letters) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) return -1;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/** 单行解析：只用 indexOf 切分，避免惰性正则在大段畸形 XML 上回溯成平方级 */
function parseRowCells(body: string, shared: string[]): string[] {
  const cells: string[] = [];
  if (body.length > MAX_ROW_BODY_CHARS) {
    throw errors.validation("账单文件内容异常（工作表行过长），请重新导出后再上传");
  }
  let cursor = 0;
  while (true) {
    const start = body.indexOf("<c", cursor);
    if (start < 0) break;
    const nextChar = body.charAt(start + 2);
    if (nextChar !== " " && nextChar !== ">" && nextChar !== "/") {
      cursor = start + 2;
      continue;
    }
    const gt = body.indexOf(">", start);
    if (gt < 0) break;
    const attrs = body.slice(start + 2, gt);
    if (body.startsWith("/>", gt + 1)) {
      cursor = gt + 3;
      continue;
    }
    const close = body.indexOf("</c>", gt);
    if (close < 0) break;
    const inner = body.slice(gt + 1, close);
    cursor = close + 4;
    const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
    const index = ref ? columnIndex(ref) : cells.length;
    if (index < 0 || index >= MAX_SHEET_COLUMNS) continue;
    const type = /t="([^"]+)"/.exec(attrs)?.[1];
    let value = "";
    if (type === "s") {
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
      value = shared[Number(raw)] ?? "";
    } else if (type === "inlineStr") {
      const tStart = inner.indexOf("<t");
      if (tStart >= 0) {
        const tGt = inner.indexOf(">", tStart);
        const tClose = tGt >= 0 ? inner.indexOf("</t>", tGt) : -1;
        if (tGt >= 0 && tClose >= 0) value = decodeXml(inner.slice(tGt + 1, tClose));
      }
    } else {
      value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
    }
    cells[index] = value;
  }
  return cells;
}

function parseSheetRows(xml: string, shared: string[]): string[][] {
  if (xml.length > MAX_SHEET_XML_CHARS) {
    throw errors.validation("账单文件内容异常（工作表过大），请重新导出后再上传");
  }
  const rows: string[][] = [];
  let cursor = 0;
  while (rows.length < MAX_SHEET_ROWS) {
    const start = xml.indexOf("<row", cursor);
    if (start < 0) break;
    const nextChar = xml.charAt(start + 4);
    if (nextChar !== " " && nextChar !== ">" && nextChar !== "/") {
      cursor = start + 4;
      continue;
    }
    const gt = xml.indexOf(">", start);
    if (gt < 0) break;
    if (xml.startsWith("/>", gt + 1)) {
      rows.push([]);
      cursor = gt + 3;
      continue;
    }
    const close = xml.indexOf("</row>", gt);
    if (close < 0) break;
    rows.push(parseRowCells(xml.slice(gt + 1, close), shared));
    cursor = close + 6;
  }
  return rows;
}

interface WechatColumn {
  time: number;
  direction: number;
  amount: number;
  counterparty: number;
  product: number;
  status: number;
  tradeNo: number;
  note: number;
}

function findWechatHeader(rows: string[][]): { index: number; columns: WechatColumn } | null {
  for (let i = 0; i < rows.length; i += 1) {
    const cells = rows[i];
    if (!cells) continue;
    const time = cells.indexOf("交易时间");
    const direction = cells.indexOf("收/支");
    const amount = cells.findIndex((cell) => /金额/.test(cell));
    if (time < 0 || direction < 0 || amount < 0) continue;
    return {
      index: i,
      columns: {
        time,
        direction,
        amount,
        counterparty: cells.indexOf("交易对方"),
        product: cells.indexOf("商品"),
        status: cells.indexOf("当前状态"),
        tradeNo: cells.indexOf("交易单号"),
        note: cells.indexOf("备注"),
      },
    };
  }
  return null;
}

function pickText(cells: string[], index: number): string {
  if (index < 0) return "";
  return (cells[index] ?? "").trim();
}

function parseWechatBill(buffer: Buffer): ParsedBill {
  const files = unzip(buffer);
  const sheetName = [...files.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0];
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const sheetXml = sheetName ? (files.get(sheetName)?.toString("utf8") ?? "") : "";
  if (!sheetXml) throw errors.validation("账单文件里没有找到工作表，请重新导出后再上传");

  const shared = parseSharedStrings(sharedXml);
  const rows = parseSheetRows(sheetXml, shared);
  const header = findWechatHeader(rows);
  if (!header) throw errors.validation("没有识别到微信账单表头，请上传微信支付导出的账单流水");

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  for (const row of rows.slice(0, header.index)) {
    for (const cell of row) {
      const match = /起始时间：\[([^\]]+)\][\s\S]*?终止时间：\[([^\]]+)\]/.exec(cell ?? "");
      if (match) {
        periodStart = parseLocalDateTime(match[1] ?? "");
        periodEnd = parseLocalDateTime(match[2] ?? "");
      }
    }
  }

  const parsed: ParsedBillRow[] = [];
  for (const cells of rows.slice(header.index + 1)) {
    const direction = pickText(cells, header.columns.direction);
    if (!direction.includes("收入")) continue;
    if (direction.includes("支出")) continue;
    const amountCents = parseMoneyCents(pickText(cells, header.columns.amount));
    if (amountCents === null || amountCents <= 0) continue;
    const paidAt = parseWechatTime(pickText(cells, header.columns.time));
    if (!paidAt) continue;
    const status = pickText(cells, header.columns.status);
    if (status && /退款|已全额退款/.test(status)) continue;
    const noteParts = [pickText(cells, header.columns.product), pickText(cells, header.columns.note)]
      .map((part) => part.replace(/^(收款方备注|付款方备注)[:：]/, ""))
      .filter((part) => part && part !== "/");
    const tradeNo = pickText(cells, header.columns.tradeNo);
    parsed.push({
      tradeNo: tradeNo && tradeNo !== "/" ? tradeNo.slice(0, 64) : null,
      amountCents,
      payerNote: trimNote(noteParts.join(" | ")),
      counterparty: pickText(cells, header.columns.counterparty) || null,
      paidAt,
    });
  }

  const bill = withPeriod("wechat", parsed);
  return {
    ...bill,
    periodStart: periodStart ?? bill.periodStart,
    periodEnd: periodEnd ?? bill.periodEnd,
  };
}

function withPeriod(provider: BillProvider, rows: ParsedBillRow[]): ParsedBill {
  const times = rows.map((row) => row.paidAt).sort();
  return {
    provider,
    periodStart: times[0] ?? null,
    periodEnd: times[times.length - 1] ?? null,
    rows,
  };
}
