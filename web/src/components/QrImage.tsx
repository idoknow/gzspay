/** 二维码展示：dataURL 图片 + 二进制 Blob 加载 hook。 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/format";
import { useWatchLayout } from "../lib/hooks";
import { errorMessage } from "../lib/http";

export interface QrImageProps {
  dataUrl: string | null;
  size?: number;
  alt?: string;
  className?: string;
}

/** 白色底 + 圆角的二维码图片（手表小屏自动缩小，保证不横向溢出） */
export function QrImage({ dataUrl, size = 240, alt = "二维码", className }: QrImageProps): ReactNode {
  const watch = useWatchLayout();
  const side = watch ? Math.min(size, 168) : size;
  if (!dataUrl) {
    return (
      <div
        className={cn("skeleton rounded-2xl", className)}
        style={{ width: side, height: side }}
        aria-label="二维码生成中"
      />
    );
  }
  return (
    <img
      src={dataUrl}
      alt={alt}
      width={side}
      height={side}
      className={cn("rounded-2xl bg-white", className)}
      style={{ width: side, height: side }}
    />
  );
}

export interface BlobUrlState {
  url: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** 加载二进制图片（收款码等）并转成可展示的 objectURL */
export function useBlobUrl(factory: (() => Promise<Blob>) | null, deps: readonly unknown[] = []): BlobUrlState {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (!factory) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const currentFactory = factory;
    currentFactory()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setUrl(null);
        setError(errorMessage(reason));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  return { url, loading, error, reload };
}
