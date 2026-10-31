import { createRequire } from "node:module";
import { Jimp } from "jimp";
import QRCode from "qrcode";
import type { Channel } from "./types.js";

/** 生成二维码 PNG Buffer（服务端统一重新生成，避免直接存用户上传的图片） */
export async function generateQrPngBuffer(content: string): Promise<Buffer> {
  return QRCode.toBuffer(content, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    color: { dark: "#0B2A6BFF", light: "#FFFFFFFF" },
  });
}

/** 生成二维码 Data URL，供前端 <img> 直接显示 */
export async function generateQrDataUrl(content: string): Promise<string> {
  return QRCode.toDataURL(content, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    color: { dark: "#0B2A6BFF", light: "#FFFFFFFF" },
  });
}

type JsQrResult = { data: string } | null;
type JsQrFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: "attemptBoth" | "dontInvert" | "onlyInvert" | "invertFirst" },
) => JsQrResult;

// jsqr 是 UMD/CJS 包，用 createRequire 加载避免 ESM 默认导入的类型差异
const nodeRequire = createRequire(import.meta.url);
const jsQR = nodeRequire("jsqr") as JsQrFn;

/** 从上传图片中解码二维码；失败返回 null */
export async function decodeQrImage(buffer: Buffer): Promise<string | null> {
  try {
    const image = await Jimp.read(buffer);
    const { data, width, height } = image.bitmap;
    const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    const result = jsQR(pixels, width, height, { inversionAttempts: "attemptBoth" });
    const content = result?.data?.trim();
    return content && content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

const CHANNEL_PATTERNS: Record<Channel, RegExp[]> = {
  alipay: [/^alipays?:\/\//i, /alipay\.com/i, /^https?:\/\/(?:qr|render)\.alipay\.com\//i],
  wechat: [/^wxp:\/\//i, /^weixin:\/\//i, /weixin\.qq\.com/i, /^https?:\/\/wxp\.qq\.com\//i],
  qq: [
    /^mqqapi:\/\//i,
    /^qqwallet:\/\//i,
    /(?:^|\.)qpay\.qq\.com\//i,
    /(?:^|\.)qianbao\.qq\.com\//i,
    /^https?:\/\/.*qq\.com\/.*(?:qr|pay|wallet)/i,
  ],
};

/** 判断收款码内容属于哪个支付渠道 */
export function detectChannel(content: string): Channel | null {
  const text = content.trim();
  if (!text) return null;
  for (const channel of ["alipay", "wechat", "qq"] as const) {
    if (CHANNEL_PATTERNS[channel].some((pattern) => pattern.test(text))) {
      return channel;
    }
  }
  return null;
}

/** 校验收款码是否属于指定渠道 */
export function isValidChannelQr(content: string, expected: Channel): boolean {
  const detected = detectChannel(content);
  if (detected !== expected) return false;
  // 收款码内容必须是可识别的链接或 scheme，长度合理
  return textLooksLikePaymentContent(content);
}

function textLooksLikePaymentContent(content: string): boolean {
  const text = content.trim();
  if (text.length < 8 || text.length > 2048) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^https?:\/\//i.test(text)) return true;
  // 部分渠道码为无 scheme 的短串，兜底允许纯域名形式
  return /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(text);
}
