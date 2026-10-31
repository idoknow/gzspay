/** 扫码内容解析：区分校园卡静态码与动态码。 */

/** 校园卡二维码固定前缀（见 docs/api.md：gzspay:card:<卡号>） */
export const CARD_PREFIX = "gzspay:card:";
/** 动态码二维码前缀（约定：gzspay:dynamic:<token>） */
export const DYNAMIC_PREFIX = "gzspay:dynamic:";

export type QrKind = "card" | "dynamic" | "unknown";

export interface ParsedQr {
  kind: QrKind;
  /** card=卡号内容；dynamic=token；unknown=原始文本 */
  value: string;
  raw: string;
}

function clean(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/\u200b/g, "");
}

/** 解析扫码结果 */
export function parseQrContent(raw: string): ParsedQr {
  const text = clean(raw);
  if (!text) return { kind: "unknown", value: "", raw };

  if (text.toLowerCase().startsWith(CARD_PREFIX)) {
    return { kind: "card", value: text.slice(CARD_PREFIX.length), raw };
  }
  if (text.toLowerCase().startsWith(DYNAMIC_PREFIX)) {
    return { kind: "dynamic", value: text.slice(DYNAMIC_PREFIX.length), raw };
  }

  // 兼容后端直接使用完整 URL 承载二维码内容的情况
  try {
    const url = new URL(text, window.location.origin);
    const card = url.searchParams.get("card");
    if (card) return { kind: "card", value: card, raw };
    const token = url.searchParams.get("token") ?? url.searchParams.get("code");
    if (token) return { kind: "dynamic", value: token, raw };
    const matchCard = /gzspay:card:([^/?#&]+)/i.exec(text);
    if (matchCard?.[1]) return { kind: "card", value: matchCard[1], raw };
    const matchDynamic = /gzspay:dynamic:([^/?#&]+)/i.exec(text);
    if (matchDynamic?.[1]) return { kind: "dynamic", value: matchDynamic[1], raw };
  } catch {
    // 非 URL，继续按其它规则判断
  }

  return { kind: "unknown", value: text, raw };
}

/** 提取校园卡内容（兼容扫码得到卡号或完整前缀两种形式） */
export function extractCardContent(raw: string): string | null {
  const parsed = parseQrContent(raw);
  if (parsed.kind === "card" && parsed.value) return parsed.value;
  if (parsed.kind === "unknown" && /^[A-Za-z0-9-]{4,64}$/.test(parsed.value)) return parsed.value;
  return null;
}

/** 提取动态码 token（扫码得到 token 或完整前缀都能识别） */
export function extractDynamicToken(raw: string): string | null {
  const parsed = parseQrContent(raw);
  if (parsed.kind === "dynamic" && parsed.value) return parsed.value;
  if (parsed.kind === "unknown" && /^[A-Za-z0-9_-]{6,128}$/.test(parsed.value)) return parsed.value;
  return null;
}

/** 生成动态码二维码内容 */
export function buildDynamicContent(token: string): string {
  return `${DYNAMIC_PREFIX}${token}`;
}
