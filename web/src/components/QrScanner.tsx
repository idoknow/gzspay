/** 二维码扫描遮罩：摄像头实时取景 + 相册图片识别兜底 + 手动输入兜底。 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock, useWatchLayout } from "../lib/hooks";
import { errorText } from "../lib/http";
import { NfcCardReader } from "./NfcCardReader";
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
  /** 只允许摄像头扫码：隐藏相册识别与手动输入入口（绑定校园卡等场景） */
  scanOnly?: boolean;
  /** 手动输入区标题（手表上默认展示） */
  manualLabel?: string;
  /** 手动输入框占位文案 */
  manualPlaceholder?: string;
  /** 是否显示「NFC 读卡」入口（安卓 Chrome 支持 Web NFC 时出现） */
  nfc?: boolean;
  /** 扫描成功（原始字符串，由调用方解析校园卡/动态码） */
  onResult: (raw: string) => void;
  onClose: () => void;
}

export function QrScanner({
  open,
  title = "扫描二维码",
  hint = "将二维码放入框内",
  scanOnly = false,
  manualLabel = "手动输入",
  manualPlaceholder = "输入卡号或二维码内容",
  nfc = false,
  onResult,
  onClose,
}: QrScannerProps): ReactNode {
  const watch = useWatchLayout();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const handledRef = useRef(false);
  const detectingRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
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

  // 打开时决定初始形态：小屏 / 手表默认手动输入，不主动占用摄像头
  useEffect(() => {
    if (!open) {
      stopCamera();
      handledRef.current = false;
      setManualOpen(false);
      setManualValue("");
      setNotice(null);
      setCameraError(null);
      setCameraOn(false);
      return;
    }
    handledRef.current = false;
    setNotice(null);
    setCameraError(null);
    // 只允许扫码时强制打开摄像头；否则小屏 / 手表默认手动输入
    const preferManual = watch && !scanOnly;
    setManualOpen(preferManual);
    setCameraOn(!preferManual);
    setStarting(false);
    return () => stopCamera();
  }, [open, watch, scanOnly, stopCamera]);

  // 需要相机时启动（手表上点「打开摄像头」后也会走到这里）
  useEffect(() => {
    if (!open || !cameraOn) return;
    void openCamera();
  }, [open, cameraOn, openCamera]);

  // 逐帧识别
  useEffect(() => {
    if (!open || !cameraOn || cameraError !== null) return;
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
  }, [open, cameraOn, cameraError, onResult]);

  const handleFile = async (file: File | null): Promise<void> => {
    if (!file) return;
    setNotice("正在识别…");
    try {
      const raw = await decodeQrFromImageFile(file);
      if (!raw) {
        setNotice("未识别到二维码，换张照片重试");
        return;
      }
      handledRef.current = true;
      onResult(raw);
    } catch (reason: unknown) {
      setNotice(errorText(reason, "识别失败，换张照片重试"));
    }
  };

  const submitManual = (): void => {
    const value = manualValue.trim();
    if (!value) {
      setNotice("请输入卡号或二维码内容");
      return;
    }
    handledRef.current = true;
    onResult(value);
  };

  const openCameraFromManual = (): void => {
    setNotice(null);
    setManualOpen(false);
    setCameraOn(true);
  };

  if (!open) return null;

  const fileInput = (
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
  );

  // 手表 / 小屏：手动输入优先，摄像头作为可选项（只允许扫码时不走这个形态）
  if (watch && !cameraOn && !scanOnly) {
    return createPortal(
      <div className="fixed inset-0 z-[105] flex flex-col bg-black text-white">
        <div className="safe-top flex items-center justify-between px-2.5 py-1.5">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 active:bg-white/20"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
          <p className="text-[13px] font-semibold">{title}</p>
          <span className="h-8 w-8" aria-hidden="true" />
        </div>

        <div className="flex flex-1 flex-col justify-center gap-2 px-2.5 pb-[max(env(safe-area-inset-bottom),10px)]">
          <label className="text-[11px] text-white/75" htmlFor="qr-manual-input">
            {manualLabel}
          </label>
          <textarea
            id="qr-manual-input"
            className="h-12 w-full resize-none rounded-xl bg-white/10 px-2.5 py-1.5 text-[13px] leading-snug text-white outline-none placeholder:text-white/35"
            placeholder={manualPlaceholder}
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
          />
          {notice ? <p className="text-center text-[10px] leading-snug text-[#ffd666]">{notice}</p> : null}
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" className="btn btn-primary btn-sm" onClick={submitManual}>
              确定
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={openCameraFromManual}>
              打开摄像头
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>
              相册识别
            </button>
            <button type="button" className="btn btn-ghost btn-sm text-white" onClick={onClose}>
              取消
            </button>
          </div>
        </div>
        {fileInput}
      </div>,
      document.body,
    );
  }

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
              className="relative h-[240px] w-[240px] rounded-3xl watch:h-[170px] watch:w-[170px] watch:rounded-2xl"
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)" }}
            >
              <span className="absolute -left-px -top-px h-8 w-8 rounded-tl-2xl border-l-4 border-t-4 border-white watch:h-6 watch:w-6" />
              <span className="absolute -right-px -top-px h-8 w-8 rounded-tr-2xl border-r-4 border-t-4 border-white watch:h-6 watch:w-6" />
              <span className="absolute -bottom-px -left-px h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-white watch:h-6 watch:w-6" />
              <span className="absolute -bottom-px -right-px h-8 w-8 rounded-br-2xl border-b-4 border-r-4 border-white watch:h-6 watch:w-6" />
              <span className="animate-scan absolute inset-x-3 top-2 h-0.5 rounded-full bg-[#57d9ff] shadow-[0_0_10px_2px_rgba(87,217,255,0.8)]" />
            </div>
          </div>
        ) : null}

        {/* 顶部栏 */}
        <div className="safe-top absolute inset-x-0 top-0 flex items-center justify-between px-4 py-3 watch:px-2.5 watch:py-2">
          <button
            type="button"
            aria-label="关闭扫描"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 backdrop-blur watch:h-8 watch:w-8"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="watch:h-4 watch:w-4">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
          <p className="text-[15px] font-semibold watch:text-[12.5px]">{title}</p>
          <span className="h-10 w-10 watch:h-8 watch:w-8" aria-hidden="true" />
        </div>

        {/* 摄像头错误提示 */}
        {cameraError !== null ? (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-2xl bg-black/70 p-5 backdrop-blur watch:inset-x-2.5 watch:p-3">
            <p className="text-sm leading-relaxed text-white/90 watch:text-xs">{cameraError}</p>
            <div className="mt-4 flex flex-wrap gap-2 watch:mt-2 watch:gap-1.5">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void openCamera()}>
                重试相机
              </button>
              {scanOnly ? (
                <button type="button" className="btn btn-ghost btn-sm text-white" onClick={onClose}>
                  取消
                </button>
              ) : (
                <>
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
                    onClick={() => {
                      setManualOpen(true);
                      if (watch) setCameraOn(false);
                    }}
                  >
                    手动输入
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {/* 底部操作区 */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-16 watch:px-3 watch:pb-[calc(12px+env(safe-area-inset-bottom))] watch:pt-10">
          <p className="text-center text-sm text-white/85 watch:text-xs">{hint}</p>
          {notice ? <p className="mt-2 text-center text-xs text-[#ffd666] watch:text-[10px]">{notice}</p> : null}
          {starting ? <p className="mt-2 text-center text-xs text-white/60 watch:text-[10px]">正在打开摄像头…</p> : null}
          {nfc ? (
            <NfcCardReader
              tone="dark"
              className="mt-3"
              onRead={(cardNo) => {
                handledRef.current = true;
                onResult(cardNo);
              }}
            />
          ) : null}
          <div
            className={`mt-4 grid gap-3 watch:mt-2.5 watch:gap-1.5 ${scanOnly ? "grid-cols-1" : "grid-cols-3"}`}
          >
            {scanOnly ? null : (
              <>
                <button
                  type="button"
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/10 py-3 text-xs backdrop-blur active:bg-white/20 watch:gap-0.5 watch:rounded-xl watch:py-1.5 watch:text-[10px]"
                  onClick={() => fileRef.current?.click()}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="watch:h-4 watch:w-4">
                    <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
                    <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
                    <path d="M4 17l5-5 4 4 3-3 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  从相册识别
                </button>
                <button
                  type="button"
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/10 py-3 text-xs backdrop-blur active:bg-white/20 watch:gap-0.5 watch:rounded-xl watch:py-1.5 watch:text-[10px]"
                  onClick={() => setManualOpen((current) => !current)}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="watch:h-4 watch:w-4">
                    <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M8 9h8M8 12.5h8M8 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  手动输入
                </button>
              </>
            )}
            <button
              type="button"
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-white/10 py-3 text-xs backdrop-blur active:bg-white/20 watch:gap-0.5 watch:rounded-xl watch:py-1.5 watch:text-[10px]"
              onClick={onClose}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="watch:h-4 watch:w-4">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              取消
            </button>
          </div>

          {!scanOnly && manualOpen ? (
            <div className="mt-4 rounded-2xl bg-white/10 p-3 backdrop-blur watch:mt-2 watch:p-2">
              <label className="mb-2 block text-xs text-white/70 watch:mb-1 watch:text-[10px]" htmlFor="qr-manual-input">
                {manualLabel}
              </label>
              <textarea
                id="qr-manual-input"
                className="h-16 w-full resize-none rounded-xl bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 watch:h-10 watch:px-2 watch:py-1 watch:text-xs"
                placeholder={manualPlaceholder}
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
              />
              <div className="mt-2 flex justify-end gap-2 watch:mt-1">
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

        {fileInput}
      </div>
    </div>,
    document.body,
  );
}
