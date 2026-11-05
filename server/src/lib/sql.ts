/**
 * SQL LIKE 模糊查询的转义工具。
 *
 * 搜索关键词来自用户输入，直接拼进 `%${keyword}%` 时，`%` 会变成通配符、
 * `_` 会变成单字符通配符：输入 `%` 能匹配所有行（放大扫描量），输入
 * `a_b` 能匹配 `axb`。统一用 `ESCAPE '\'` + 本函数转义，让关键词按字面匹配。
 */
export function likePattern(keyword: string): string {
  const escaped = keyword.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

/** 搭配 `likePattern` 使用：`WHERE name LIKE ? ESCAPE '\'` */
export const LIKE_ESCAPE = "ESCAPE '\\'";
