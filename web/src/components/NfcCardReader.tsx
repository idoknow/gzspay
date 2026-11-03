/** 安卓手机 NFC 读卡：读取卡片 NDEF 文本（卡片名称即校园卡卡号）。 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn, isCardNo, normalizeCardNo } from "../lib/format";

interface NdefRecordLike {
  recordType: string;
  encoding?: string;
  data?: DataView;
}

interface NdefReadingEventLike {
  message: { records: NdefRecordLike[] };
  serialNumber?: string;
}

interface NdefReaderLike {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((event: NdefReadingEventLike) => void) | null;
  onreadingerror: ((event: unknown) => void) | null;
}

type NdefReaderCtor = new () => NdefReaderLike;

function ndefReaderCtor(): NdefReaderCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as Window & { NDEFReader?: NdefReaderCtor }).NDEFReader;
  return typeof ctor === "function" ? ctor : null;
}

/** 当前设备/浏览器是否支持 Web NFC（安卓 Chrome 等） */
export function isNfcSupported(): boolean {
  return ndefReaderCtor() !== null;
}

function decodeRecord(record: NdefRecordLike): string | null {
  if (record.recordType === "empty" || !record.data) return null;
  try {
    return new TextDecoder(record.encoding ?? "utf-8").decode(record.data).trim();
  } catch {
    return null;
  }
}

function pickCardNo(records: NdefRecordLike[]): string | null {
  for (const record of records) {
    const text = decodeRecord(record);
    if (!text) continue;
    const normalized = normalizeCardNo(text);
    if (isCardNo(normalized)) return normalized;
  }
  return null;
}

export interface NfcCardReaderProps {
  /** 读到卡号（已转大写，8 位数字或字母） */
  onRead: (cardNo: string) => void;
  disabled?: boolean;
  className?: string;
  /** 深色背景（全屏扫码取景）下的样式 */
  tone?: "default" | "dark";
}

export function NfcCardReader({
  onRead,
  disabled = false,
  className,
  tone = "default",
}: NfcCardReaderProps): ReactNode {
  const supported = isNfcSupported();
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setScanning(false);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    const ctor = ndefReaderCtor();
    if (!ctor) {
      setNotice("当前浏览器不支持 NFC 读卡，请改用摄像头扫码或手动输入");
      return;
    }
    setNotice(null);
    setScanning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reader = new ctor();
      reader.onreading = (event) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        const cardNo = pickCardNo(event.message.records);
        if (!cardNo) {
          setNotice("读到的卡片内容不是 8 位卡号，请确认这张卡已写入卡号");
          return;
        }
        if (typeof navigator.vibrate === "function") navigator.vibrate(50);
        stop();
        onRead(cardNo);
      };
      reader.onreadingerror = () => {
        if (mountedRef.current) setNotice("读取失败，请把卡片贴近手机背面的 NFC 区域再试");
      };
      await reader.scan({ signal: controller.signal });
      if (mountedRef.current && !controller.signal.aborted) setScanning(true);
    } catch {
      if (!mountedRef.current) return;
      setScanning(false);
      abortRef.current = null;
      setNotice("无法启动 NFC：请用安卓 Chrome 打开本页，并在系统设置里开启 NFC");
    }
  }, [onRead, stop]);

  // 只支持 Web NFC 的浏览器（安卓 Chrome）才显示入口，其他设备不占位
  if (!supported) return null;

  const dark = tone === "dark";
  const buttonClass = cn(
    dark
      ? "flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 py-3 text-xs text-white backdrop-blur active:bg-white/20 disabled:opacity-60"
      : "btn btn-outline btn-block gap-2",
  );

  return (
    <div className={className}>
      {scanning ? (
        <button type="button" className={buttonClass} onClick={stop}>
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden="true" />
          正在读取 NFC…（点此停止）
        </button>
      ) : (
        <button
          type="button"
          className={buttonClass}
          disabled={disabled}
          onClick={() => void start()}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="3" width="16" height="18" rx="3" stroke="currentColor" strokeWidth="1.7" />
            <path d="M9 8.5c1.6 1.4 1.6 5.6 0 7M12 6.5c3 2.6 3 8.4 0 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          NFC 读卡
        </button>
      )}
      {scanning ? (
        <p
          className={
            dark
              ? "mt-1.5 text-center text-[11px] leading-relaxed text-white/60"
              : "mt-1.5 text-center text-[11px] leading-relaxed text-muted"
          }
        >
          把校园卡贴到手机背面的 NFC 区域，读取卡片名称作为卡号
        </p>
      ) : null}
      {notice ? (
        <p
          className={
            dark
              ? "mt-1.5 text-center text-[11px] leading-relaxed text-[#ffd666]"
              : "mt-1.5 text-center text-[11px] leading-relaxed text-danger"
          }
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}
