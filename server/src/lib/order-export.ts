/**
 * 订单导出：CSV / JSON / XLSX（内置极简 ZIP + OOXML，无第三方依赖）。
 *
 * PDF 不在这里生成：中文字体无法内嵌，改为前端打印视图（浏览器「另存为 PDF」）。
 */

import { CHANNEL_LABELS, type OrderRow, type OrderStatus } from "./types.js";

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "待付款",
  paid: "已支付待确认",
  completed: "已完成",
  cancelled: "已取消",
};

export type ExportFormat = "csv" | "json" | "xlsx";

export interface ExportColumn {
  key: string;
  title: string;
  width: number;
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "orderNo", title: "订单号", width: 22 },
  { key: "title", title: "内容", width: 26 },
  { key: "amount", title: "金额（元）", width: 12 },
  { key: "status", title: "状态", width: 12 },
  { key: "channel", title: "支付方式", width: 12 },
  { key: "merchant", title: "商家", width: 18 },
  { key: "payer", title: "付款人", width: 18 },
  { key: "createdAt", title: "创建时间", width: 20 },
  { key: "paidAt", title: "支付时间", width: 20 },
  { key: "completedAt", title: "完成时间", width: 20 },
  { key: "cancelReason", title: "取消原因", width: 26 },
  { key: "note", title: "备注", width: 26 },
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 按调用方浏览器的时区偏移（分钟，`Date#getTimezoneOffset()`）格式化时间 */
function formatTime(iso: string | null, tzOffsetMinutes: number): string {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const shifted = new Date(time - tzOffsetMinutes * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(
    shifted.getUTCHours(),
  )}:${pad(shifted.getUTCMinutes())}`;
}

/** 把订单行转成可直接序列化的导出记录（金额同时提供元与分） */
export function orderExportRecord(row: OrderRow, tzOffsetMinutes: number): Record<string, string | number> {
  return {
    orderNo: row.order_no,
    title: row.title,
    amount: (row.amount_cents / 100).toFixed(2),
    amountCents: row.amount_cents,
    status: STATUS_LABELS[row.status] ?? row.status,
    channel: row.pay_channel ? (CHANNEL_LABELS[row.pay_channel] ?? row.pay_channel) : "",
    merchant: row.merchant_name_snapshot,
    payer: row.payer_name_snapshot,
    createdAt: formatTime(row.created_at, tzOffsetMinutes),
    paidAt: formatTime(row.paid_at, tzOffsetMinutes),
    completedAt: formatTime(row.completed_at, tzOffsetMinutes),
    cancelReason: row.cancel_reason ?? "",
    note: row.actual_note ?? row.reserved_note ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** 防止 Excel 把内容当公式执行（CSV 注入） */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildOrdersCsv(rows: OrderRow[], tzOffsetMinutes: number): Buffer {
  const header = EXPORT_COLUMNS.map((column) => csvCell(column.title)).join(",");
  const lines = rows.map((row) => {
    const record = orderExportRecord(row, tzOffsetMinutes);
    return EXPORT_COLUMNS.map((column) =>
      csvCell(column.key === "note" ? record.note : record[column.key]),
    ).join(",");
  });
  // 带 BOM 让 Excel 正确识别 UTF-8 中文
  return Buffer.from(`\uFEFF${[header, ...lines].join("\r\n")}\r\n`, "utf8");
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

export function buildOrdersJson(rows: OrderRow[], tzOffsetMinutes: number): Buffer {
  const payload = {
    exportedAt: new Date().toISOString(),
    count: rows.length,
    orders: rows.map((row) => orderExportRecord(row, tzOffsetMinutes)),
  };
  return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/* ------------------------------------------------------------------ */
/* XLSX（最小 OOXML + store 模式 ZIP）                                  */
/* ------------------------------------------------------------------ */

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 不允许的控制字符
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function buildSheetXml(rows: OrderRow[], tzOffsetMinutes: number): string {
  const headerCells = EXPORT_COLUMNS.map(
    (column, index) =>
      `<c r="${columnName(index)}1" t="inlineStr" s="1"><is><t>${escapeXml(column.title)}</t></is></c>`,
  ).join("");
  const body = rows
    .map((row, rowIndex) => {
      const record = orderExportRecord(row, tzOffsetMinutes);
      const cells = EXPORT_COLUMNS.map((column, index) => {
        const ref = `${columnName(index)}${rowIndex + 2}`;
        const value = column.key === "note" ? record.note : record[column.key];
        return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 2}">${cells}</row>`;
    })
    .join("");
  const cols = EXPORT_COLUMNS.map(
    (column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData><row r="1">${headerCells}</row>${body}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="账单" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

/** CRC32（ZIP 校验用） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** 生成不压缩（store）的 ZIP：xlsx 只需这些文件，Excel/WPS 均可打开 */
function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    localParts.push(local, entry.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);

    offset += local.length + size;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, end]);
}

export function buildOrdersXlsx(rows: OrderRow[], tzOffsetMinutes: number): Buffer {
  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(WORKBOOK, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(WORKBOOK_RELS, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(STYLES, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(buildSheetXml(rows, tzOffsetMinutes), "utf8") },
  ]);
}

export function buildOrdersExport(
  format: ExportFormat,
  rows: OrderRow[],
  tzOffsetMinutes: number,
): { data: Buffer; contentType: string; extension: string } {
  if (format === "json") {
    return {
      data: buildOrdersJson(rows, tzOffsetMinutes),
      contentType: "application/json; charset=utf-8",
      extension: "json",
    };
  }
  if (format === "xlsx") {
    return {
      data: buildOrdersXlsx(rows, tzOffsetMinutes),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
    };
  }
  return { data: buildOrdersCsv(rows, tzOffsetMinutes), contentType: "text/csv; charset=utf-8", extension: "csv" };
}
