import { createRequire } from "node:module";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { sniffImageKind } from "./image.js";
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

interface RawImage {
  data: Uint8Array;
  width: number;
  height: number;
}

// jsqr 与 jpeg-js 是 UMD/CJS 包，用 createRequire 加载避免 ESM 默认导入的类型差异
const nodeRequire = createRequire(import.meta.url);
const jsQR = nodeRequire("jsqr") as JsQrFn;
const jpeg = nodeRequire("jpeg-js") as {
  decode(
    data: Buffer,
    options: {
      useTArray: true;
      formatAsRGBA: true;
      maxResolutionInMP: number;
      maxMemoryUsageInMB: number;
    },
  ): RawImage;
};

/** 解码上限：上传本身限 2MB，这里再兜底避免超大尺寸图片占满内存（解码后 RGBA 约为像素数 × 4 字节） */
const MAX_IMAGE_PIXELS = 8_000_000;
const MAX_IMAGE_SIDE = 4096;
const MAX_IMAGE_MP = MAX_IMAGE_PIXELS / 1_000_000;

/** 从 PNG 文件头（IHDR）读尺寸，解码前就能拒绝超大的图片 */
function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** 尺寸是否在允许范围内（总量 + 单边） */
function sizeAllowed(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) return false;
  return width * height <= MAX_IMAGE_PIXELS;
}

/** 把 PNG / JPEG 解码成 RGBA 像素；其它格式返回 null */
function decodeToRgba(buffer: Buffer): RawImage | null {
  const kind = sniffImageKind(buffer);
  if (kind === "png") {
    const size = pngSize(buffer);
    if (!size || !sizeAllowed(size.width, size.height)) return null;
    const png = PNG.sync.read(buffer);
    return { data: png.data, width: png.width, height: png.height };
  }
  if (kind === "jpeg") {
    const image = jpeg.decode(buffer, {
      useTArray: true,
      formatAsRGBA: true,
      maxResolutionInMP: MAX_IMAGE_MP,
      maxMemoryUsageInMB: 128,
    });
    if (!sizeAllowed(image.width, image.height)) return null;
    return { data: image.data, width: image.width, height: image.height };
  }
  return null;
}

/** 从上传图片中解码二维码；失败返回 null */
export async function decodeQrImage(buffer: Buffer): Promise<string | null> {
  try {
    const image = decodeToRgba(buffer);
    if (!image || image.width * image.height > MAX_IMAGE_PIXELS) return null;
    const pixels = new Uint8ClampedArray(
      image.data.buffer,
      image.data.byteOffset,
      image.data.byteLength,
    );
    const result = jsQR(pixels, image.width, image.height, { inversionAttempts: "attemptBoth" });
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
