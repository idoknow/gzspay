/** 极简 PDF 生成器：把一张 JPEG 图片铺到单页 PDF 上（零依赖，适合「导出统计图」这类图像报告）。 */

export interface PdfImageOptions {
  /** 页面宽高（pt，默认 A4 纵向） */
  pageWidth?: number;
  pageHeight?: number;
  /** 页边距（pt） */
  margin?: number;
  /** 文档标题（写入 Info） */
  title?: string;
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

/** 字符串按 Latin-1 写字节（PDF 结构部分只用 ASCII） */
function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/** PDF 文本串转义 + 非 ASCII 丢弃（Info 标题只保留 ASCII，避免编码问题） */
function pdfText(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (char) => `\\${char}`);
}

/** 生成单页图片 PDF */
export function buildImagePdf(
  jpeg: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  options: PdfImageOptions = {},
): Uint8Array {
  const pageWidth = options.pageWidth ?? A4_WIDTH;
  const pageHeight = options.pageHeight ?? A4_HEIGHT;
  const margin = options.margin ?? 24;

  // 等比缩放居中
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const scale = Math.min(maxWidth / Math.max(1, imageWidth), maxHeight / Math.max(1, imageHeight));
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const drawX = (pageWidth - drawWidth) / 2;
  const drawY = (pageHeight - drawHeight) / 2;

  const chunks: Uint8Array[] = [];
  let offset = 0;

  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const write = (text: string): void => push(latin1(text));

  const offsets: number[] = [];
  const startObject = (): void => {
    offsets.push(offset);
  };

  write("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");

  // 1: Catalog
  startObject();
  write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // 2: Pages
  startObject();
  write("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  // 3: Page（资源引用图片对象 5）
  startObject();
  write(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 4 0 R >>\nendobj\n`,
  );

  // 4: 内容流：把图片铺到页面中间
  const content =
    `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/Im0 Do\nQ\n`;
  startObject();
  write(`4 0 obj\n<< /Length ${latin1(content).length} >>\nstream\n${content}endstream\nendobj\n`);

  // 5: 图片对象（DCTDecode 即 JPEG）
  startObject();
  write(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${Math.round(imageWidth)} /Height ${Math.round(imageHeight)} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  write("\nendstream\nendobj\n");

  // Info（可选标题）
  const title = options.title ? pdfText(options.title) : "";
  if (title) {
    startObject();
    write(`6 0 obj\n<< /Title (${title}) /Producer (gzspay) >>\nendobj\n`);
  }

  // 交叉引用表
  const objectCount = offsets.length + 1;
  const xrefOffset = offset;
  write(`xref\n0 ${objectCount}\n`);
  write("0000000000 65535 f \n");
  for (const entry of offsets) {
    write(`${entry.toString().padStart(10, "0")} 00000 n \n`);
  }
  write(
    `trailer\n<< /Size ${objectCount} /Root 1 0 R${title ? " /Info 6 0 R" : ""} >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}
