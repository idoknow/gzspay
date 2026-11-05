/**
 * CSV 单元格转义。
 *
 * 除了引号/逗号/换行，还要防止 Excel / WPS 把用户内容当公式执行（CSV 注入）：
 * 以 `= + - @` 或制表符/回车开头的单元格前置一个单引号，强制当文本。
 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const trimmedStart = text.replace(/^[\s\u3000]+/, "");
  const risky = /^[=+\-@\t\r]/.test(text) || /^[=+\-@\t\r]/.test(trimmedStart);
  const safe = risky ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
