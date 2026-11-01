/**
 * 图片类型嗅探（只认文件头，不信任 Content-Type / 扩展名）。
 *
 * 用于两处外部来源的图片：
 * - 头像：从 QQ 头像服务拉取后落盘，必须是 PNG / JPEG；
 * - 商家收款码：用户上传后交给 jsQR 解码，先确认是图片，避免把任意二进制喂给解码器。
 *
 * 明确不接受 SVG（可内联脚本）与 GIF/WebP（本项目用不到）。
 */

export type ImageKind = "png" | "jpeg";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

/** 返回图片实际类型，无法识别返回 null */
export function sniffImageKind(buffer: Buffer | Uint8Array): ImageKind | null {
  const bytes = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
  return null;
}

/** 文件扩展名（用于落盘目录命名） */
export function imageExtension(kind: ImageKind): "png" | "jpg" {
  return kind === "png" ? "png" : "jpg";
}
