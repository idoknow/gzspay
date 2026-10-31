/** 二维码：生成（qrcode 包）与识别（BarcodeDetector 优先，jsQR 回退）。 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { errorMessage } from "./http";

export interface QrRenderOptions {
  /** 输出图片边长（像素） */
  size?: number;
  /** 白边宽度（模块数） */
  margin?: number;
  dark?: string;
  light?: string;
}

/** 把文本渲染成二维码 dataURL（默认深蓝前景 + 白底，保证可扫） */
export async function createQrDataUrl(text: string, options: QrRenderOptions = {}): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: options.margin ?? 1,
    width: options.size ?? 480,
    color: {
      dark: options.dark ?? "#131a2a",
      light: options.light ?? "#ffffff",
    },
  });
}

/** 渲染二维码并返回 dataURL（组件内使用） */
export function useQrDataUrl(
  text: string | null,
  size = 480,
): { dataUrl: string | null; error: string | null } {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!text) {
      setDataUrl(null);
      setError(null);
      return;
    }
    setError(null);
    createQrDataUrl(text, { size })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setDataUrl(null);
          setError(errorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [text, size]);

  return { dataUrl, error };
}

/* ------------------------------------------------------------------ */
/* 原生条码识别（BarcodeDetector）                                     */
/* ------------------------------------------------------------------ */

interface BarcodeDetectorResult {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<BarcodeDetectorResult[]>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const candidate = (globalThis as Record<string, unknown>).BarcodeDetector;
  return typeof candidate === "function" ? (candidate as BarcodeDetectorCtor) : null;
}

/** 当前浏览器是否原生支持条码识别（Chrome/Android 等） */
export function hasNativeBarcodeDetector(): boolean {
  return getBarcodeDetectorCtor() !== null;
}

/** 缩放到最大边长，减少解码耗时 */
function createSampleCanvas(
  width: number,
  height: number,
  maxSize: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  if (width <= 0 || height <= 0) return null;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  return { canvas, ctx, width: targetWidth, height: targetHeight };
}

async function detectWithNative(canvas: HTMLCanvasElement): Promise<string | null> {
  const Detector = getBarcodeDetectorCtor();
  if (!Detector) return null;
  try {
    const detector = new Detector({ formats: ["qr_code"] });
    const results = await detector.detect(canvas);
    for (const result of results) {
      const value = typeof result.rawValue === "string" ? result.rawValue.trim() : "";
      if (value) return value;
    }
  } catch {
    // 原生识别失败时回退 jsQR
  }
  return null;
}

function detectWithJsQr(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): string | null {
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const result = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
    const value = result?.data?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

/** 从 canvas 内容识别二维码（原生优先，jsQR 兜底） */
export async function detectQrFromCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Promise<string | null> {
  const native = await detectWithNative(canvas);
  if (native) return native;
  return detectWithJsQr(ctx, canvas.width, canvas.height);
}

/** 从 <video> 当前帧识别二维码 */
export async function detectQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
  const sample = createSampleCanvas(video.videoWidth, video.videoHeight, 800);
  if (!sample) return null;
  sample.ctx.drawImage(video, 0, 0, sample.width, sample.height);
  return detectQrFromCanvas(sample.canvas, sample.ctx);
}

/** 加载图片文件为 HTMLImageElement（用于识别静态图片里的二维码） */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片无法读取，请换一张试试"));
    };
    image.src = url;
  });
}

/** 识别图片文件里的二维码（相册兜底） */
export async function decodeQrFromImageFile(file: File): Promise<string | null> {
  const image = await loadImageFromFile(file);
  const sample = createSampleCanvas(image.naturalWidth, image.naturalHeight, 1200);
  if (!sample) return null;
  sample.ctx.drawImage(image, 0, 0, sample.width, sample.height);
  return detectQrFromCanvas(sample.canvas, sample.ctx);
}

/* ------------------------------------------------------------------ */
/* 摄像头                                                             */
/* ------------------------------------------------------------------ */

export interface CameraSession {
  stream: MediaStream;
  stop: () => void;
}

/** 打开后置摄像头；失败时由调用方用 cameraErrorMessage 提示 */
export async function startCamera(video: HTMLVideoElement, facingMode: "environment" | "user" = "environment"): Promise<CameraSession> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前浏览器不支持调用摄像头");
  }
  if (!window.isSecureContext) {
    throw new Error("需要 HTTPS 或 localhost 才能打开摄像头");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await video.play().catch(() => undefined);
  return {
    stream,
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}

/** 把摄像头错误翻译成用户能看懂的中文提示 */
export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    const ua = navigator.userAgent.toLowerCase();
    const inApp = /micromessenger|qq\/|wechat|alipayclient|baiduboxapp|weibo/.test(ua);
    return inApp
      ? "当前浏览器禁止了相机权限，请点击右上角「在浏览器中打开」改用系统浏览器"
      : "相机权限被拒绝，请在系统设置中允许本站使用相机，或改用相册上传";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "没有找到可用的摄像头，请改用相册上传";
  if (name === "NotReadableError" || name === "TrackStartError") return "摄像头被其他应用占用，请关闭后重试";
  if (name === "SecurityError") return "当前环境不允许使用摄像头，请改用系统浏览器打开";
  if (error instanceof Error && error.message) return error.message;
  return "无法打开摄像头，请改用相册上传";
}
