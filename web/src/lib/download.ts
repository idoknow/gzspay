/** 文件下载工具：Blob / dataURL 触发浏览器下载。 */

/** 触发浏览器下载（移动端会进“下载”或直接打开） */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 给浏览器留出触发下载的时间再回收
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** dataURL（如二维码图片）转 Blob 后下载 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const [meta, content] = dataUrl.split(",");
  if (!content) return;
  const isBase64 = (meta ?? "").includes("base64");
  const mime = /data:([^;]+)/.exec(meta ?? "")?.[1] ?? "application/octet-stream";
  let bytes: Uint8Array;
  if (isBase64) {
    const binary = atob(content);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(content));
  }
  // 复制到独立的 ArrayBuffer，避免 Uint8Array<ArrayBufferLike> 无法作为 BlobPart（TS5.9 泛型收窄）
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(new Blob([buffer], { type: mime }), filename);
}

/** 生成安全的文件名片段 */
export function safeFilename(input: string, fallback = "gzspay"): string {
  const cleaned = input.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}
