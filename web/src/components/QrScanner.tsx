/** 二维码扫描遮罩：摄像头实时取景 + 相册图片识别兜底 + 手动输入兜底。 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/hooks";
import { cn } from "../lib/format";
import {
  cameraErrorMessage,
  decodeQrFromImageFile,
  detectQrFromVideo,
  startCamera,
  type CameraSession,
} from "../lib/qr";

export interface QrScannerProps {
  open: boolean;
  title?: string;
  hint?: string;
  /** 扫描成功（原始字符串，由调用方解析校园卡/动态码） */
  onResult: (raw: string) => void;
  onClose: () => void;
}

export function QrScanner({
  open,
  title = "扫描二维码",
  hint = "将二维码放入取景框内，即可自动识别",
  onResult,
  onClose,
}: QrScannerProps): ReactNode {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const handledRef = useRef(false);
  const detectingRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");

  useBodyScrollLock(open);

  const stopCamera = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  const openCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setCameraError(null);
    setStarting(true);
    try {
      sessionRef.current = await startCamera(video);
    } catch (reason: unknown) {
      setCameraError(cameraErrorMessage(reason));
    } finally {
      setStarting(false);
    }
  }, []);

  // 打开时启动摄像头，关闭时释放
  useEffect(() => {
    if (!open) {
      stopCamera();
      handledRef.current = false;
      setManualOpen(false);
      setManualValue("");
      setNotice(null);
      setCameraError(null);
      return;
    }
    handledRef.current = false;
    setNotice(null);
    void openCamera();
    return () => stopCamera();
  }, [open, openCamera, stopCamera]);

  // 逐帧识别
  useEffect(() => {
    if (!open || cameraError !== null) return;
    const detect = async (): Promise<void> => {
      const video = videoRef.current;
      if (!video || detectingRef.current || handledRef.current) return;
      detectingRef.current = true;
      try {
        const raw = await detectQrFromVideo(video);
        if (raw && !handledRef.current) {
          handledRef.current = true;
          if (typeof navigator.vibrate === "function") navigator.vibrate(50);
          onResult(raw);
        }
      } finally {
        detectingRef.current = false;
      }
    };
    const timer = window.setInterval(() => {
      void detect();
    }, 350);
    return () => window.clearInterval(timer);
  }, [open, cameraError, onResult]);

  const handleFile = async (file: File | null): Promise<void> => {
    if (!file) return;
    setNotice("正在识别图片…");
    try {
      const raw = await decodeQrFromImageFile(file);
      if (!raw) {
        setNotice("没有识别到二维码，请换一张更清晰的照片，或尝试手动输入");
        return;
      }
      handledRef.current = true;
      onResult(raw);
    } catch (reason: unknown) {
      setNotice(reason instanceof Error ? reason.message : "图片识别失败，请重试");
    }
  };

  const submitManual = (): void => {
    const value = manualValue.trim();
    if (!value) {
      setNotice("请输入二维码内容");
      return;
    }
    handledRef.current = true;
    onResult(value);
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[105] flex flex-col bg-black text-white">
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          aria-label="摄像头取景"
        />

        {/* 取景框 + 遮罩 */}
        {cameraError === null ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="relative h-[240px] w-[240px] rounded-3xl"
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)" }}
            >
              <span className="absolute -left-px -top-px h-8 w-8 rounded-tl-2xl border-l-4 border-t-4 border-white" />
              <span className="absolute -right-px -top-px h-8 w-8 rounded-tr-2xl border-r-4 border-t-4 border-white" />
              <span className="absolute -bottom-px -left-px h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-white" />
              <span className="absolute -bottom-px -right-px h-8 w-8 rounded-br-2xl border-b-4 border-r-4 border-white" />
              <span className="animate-scan absolute inset-x-3 top-2 h-0.5 rounded-full bg-[#57d9ff] shadow-[0_0_10px_2px_rgba(87,217,255,0.8)]" />
            </div>
          </div>
        ) : null}

        {/* 顶部栏 */}
        <div className="safe-top absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3">
          <button
            type="button"
            aria-label="关闭扫描"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 backdrop-blur"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
          <p className="text-[15px] font-semibold">{title}</p>
          <span className="h-10 w-10" aria-hidden="true" />
        </div>

        {/* 摄像头错误提示 */}
        {cameraError !== null ? (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-black/70 p-5 backdrop-blur">
            <p className="text-sm leading-relaxed text-white/90">{cameraError}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void openCamera()}>
                重试相机
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => fileRef.current?.click()}
              >
                从相册识别
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-white"
                onClick={() => setManualOpen(true)}
              >
                手动输入
              </button>
            </div>
          </div>
        ) : null}

        {/* 底部操作区 */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-16">
          <p className="text-center text-sm text-white/85">{hint}</p>
          {notice ? <p className="mt-2 text-center text-xs text-[#ffd666]">{notice}</p> : null}
          {starting ? <p className="mt-2 text-center text-xs text-white/60">正在打开摄像头…</p> : null}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <button
              type="button"
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/10 py-3 text-xs backdrop-blur active:bg-white/20"
              onClick={() => fileRef.current?.click()}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
                <path d="M4 17l5-5 4 4 3-3 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              从相册识别
            </button>
            <button
              type="button"
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/10 py-3 text-xs backdrop-blur active:bg-white/20"
              onClick={() => setManualOpen((current) => !current)}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
                <path d="M8 9h8M8 12.5h8M8 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              手动输入
            </button>
            <button
              type="button"
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/10 py-3 text-xs backdrop-blur active:bg-white/20"
              onClick={onClose}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              取消
            </button>
          </div>

          {manualOpen ? (
            <div className="mt-4 rounded-2xl bg-white/10 p-3 backdrop-blur">
              <label className="mb-2 block text-xs text-white/70" htmlFor="qr-manual-input">
                粘贴二维码内容（校园卡或动态码）
              </label>
              <textarea
                id="qr-manual-input"
                className="h-16 w-full resize-none rounded-xl bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
                placeholder="例如 gzspay:card:2023123456"
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-white"
                  onClick={() => setManualOpen(false)}
                >
                  收起
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={submitManual}>
                  确定
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            event.target.value = "";
            void handleFile(file);
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
