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
import { errors } from "./errors.js";

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

function parseMoneyCents(raw: string): number | null {
  const cleaned = raw.replace(/[¥￥,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
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

function parseAlipayBill(buffer: Buffer): ParsedBill {
  const text = decodeText(buffer);
  const lines = text
    .split(/\r?\n/)
    .map((line) => splitCsvLine(line))
    .filter((cells) => cells.some((cell) => cell !== ""));
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
  }
  return withPeriod("alipay", rows);
}

// ---------------------------------------------------------------------------
// 微信 XLSX
// ---------------------------------------------------------------------------

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
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length) break;
    if (buffer.readUInt32LE(offset) !== 0x0201_4b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    try {
      if (method === 0) files.set(name, Buffer.from(raw));
      else if (method === 8) files.set(name, inflateRawSync(raw));
    } catch {
      // 单个文件解压失败不影响其它文件
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml: string): string[] {
  const items: string[] = [];
  for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const inner = match[1] ?? "";
    const texts = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) =>
      decodeXml(item[1] ?? ""),
    );
    items.push(texts.join(""));
  }
  return items;
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function parseSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    const rowBody = rowMatch[1] ?? "";
    for (const cellMatch of rowBody.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const index = ref ? columnIndex(ref) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value = "";
      if (type === "s") {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        value = shared[Number(raw)] ?? "";
      } else if (type === "inlineStr") {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((item) => decodeXml(item[1] ?? ""))
          .join("");
      } else {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      }
      cells[index] = value;
    }
    rows.push(cells);
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
