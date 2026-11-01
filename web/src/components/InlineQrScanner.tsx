/** 页面内嵌扫码取景：摄像头实时画面 + 中央取景框，识别成功即回传原始内容。 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useWatchLayout } from "../lib/hooks";
import { cameraErrorMessage, detectQrFromVideo, startCamera, type CameraSession } from "../lib/qr";

export interface InlineQrScannerProps {
  /** 是否正在取景（由页面控制，关闭时自动释放摄像头） */
  active: boolean;
  /** 取景框下方的提示文案 */
  hint?: string;
  /** 识别成功（原始字符串，由调用方解析校园卡/动态码） */
  onResult: (raw: string) => void;
  className?: string;
}

export function InlineQrScanner({
  active,
  hint = "将二维码放入框内，自动识别",
  onResult,
  className,
}: InlineQrScannerProps): ReactNode {
  const watch = useWatchLayout();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<CameraSession | null>(null);
  const handledRef = useRef(false);
  const detectingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const stopCamera = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setReady(false);
  }, []);

  const openCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setStarting(true);
    try {
      sessionRef.current = await startCamera(video);
      setReady(true);
    } catch (reason: unknown) {
      setError(cameraErrorMessage(reason));
    } finally {
      setStarting(false);
    }
  }, []);

  // 取景开关：打开时启动摄像头，关闭或卸载时释放
  useEffect(() => {
    if (!active) {
      stopCamera();
      handledRef.current = false;
      setError(null);
      return;
    }
    handledRef.current = false;
    void openCamera();
    return () => stopCamera();
  }, [active, retryKey, openCamera, stopCamera]);

  // 逐帧识别
  useEffect(() => {
    if (!active || error !== null) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || detectingRef.current || handledRef.current) return;
      detectingRef.current = true;
      void detectQrFromVideo(video)
        .then((raw) => {
          if (raw && !handledRef.current) {
            handledRef.current = true;
            if (typeof navigator.vibrate === "function") navigator.vibrate(50);
            onResult(raw);
          }
        })
        .catch(() => {
          /* 单帧识别失败不打断取景 */
        })
        .finally(() => {
          detectingRef.current = false;
        });
    }, 350);
    return () => window.clearInterval(timer);
  }, [active, error, onResult]);

  if (!active) return null;

  return (
    <div className={`relative overflow-hidden bg-black ${className ?? ""}`}>
      <video
        ref={videoRef}
        className={`w-full object-cover ${watch ? "h-[200px]" : "h-[320px]"}`}
        playsInline
        muted
        aria-label="摄像头取景"
      />

      {error === null ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="relative h-[180px] w-[180px] rounded-2xl watch:h-[120px] watch:w-[120px]"
            style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.42)" }}
          >
            <span className="absolute -left-px -top-px h-7 w-7 rounded-tl-2xl border-l-4 border-t-4 border-white watch:h-5 watch:w-5" />
            <span className="absolute -right-px -top-px h-7 w-7 rounded-tr-2xl border-r-4 border-t-4 border-white watch:h-5 watch:w-5" />
            <span className="absolute -bottom-px -left-px h-7 w-7 rounded-bl-2xl border-b-4 border-l-4 border-white watch:h-5 watch:w-5" />
            <span className="absolute -bottom-px -right-px h-7 w-7 rounded-br-2xl border-b-4 border-r-4 border-white watch:h-5 watch:w-5" />
            {ready ? (
              <span className="animate-scan absolute inset-x-3 top-2 h-0.5 rounded-full bg-[#57d9ff] shadow-[0_0_10px_2px_rgba(87,217,255,0.8)]" />
            ) : null}
          </div>
        </div>
      ) : null}

      {error === null ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-8 text-center">
          <p className="text-xs leading-relaxed text-white/90 watch:text-[10.5px]">{hint}</p>
          {starting ? <p className="mt-1 text-[11px] text-white/60 watch:text-[10px]">正在打开摄像头…</p> : null}
        </div>
      ) : null}

      {error !== null ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-5 text-center">
          <p className="text-xs leading-relaxed text-white/90">{error}</p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setRetryKey((value) => value + 1)}
          >
            重试相机
          </button>
        </div>
      ) : null}
    </div>
  );
}
