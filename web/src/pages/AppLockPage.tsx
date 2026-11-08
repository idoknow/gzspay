/**
 * 应用锁设置（仅客户端）：界面在网页里，密码只通过桥接交给原生加盐保存。
 * 原生仍保留解锁界面（LockActivity），这里只负责开启 / 更换 / 关闭。
 */
import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { PageHeader } from "../components/PageHeader";
import { Toggle } from "../components/Toggle";
import { useToast } from "../components/Toast";
import { clientBridge, type LockStatus } from "../lib/client";

type LockKind = "pin4" | "pin6" | "pattern";
type LockType = LockStatus["type"];

const TYPE_LABEL: Record<LockType, string> = {
  none: "未开启",
  pin4: "四位数密码",
  pin6: "六位数密码",
  pattern: "手势密码",
};

function readStatus(bridge: NonNullable<ReturnType<typeof clientBridge>>): LockStatus | null {
  try {
    const raw = bridge.lockStatus?.();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LockStatus>;
    const type = parsed.type;
    if (type !== "none" && type !== "pin4" && type !== "pin6" && type !== "pattern") return null;
    return {
      type,
      biometricEnabled: parsed.biometricEnabled === true,
      biometricAvailable: parsed.biometricAvailable === true,
    };
  } catch {
    return null;
  }
}

/** 九宫格手势输入，签名格式与原生 PatternView 一致：0-1-2-5 */
function PatternLock({ onComplete }: { onComplete: (signature: string) => void }): ReactNode {
  const [selected, setSelected] = useState<number[]>([]);
  const dragging = useRef(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<number[]>([]);

  const cellAt = (event: ReactPointerEvent<HTMLDivElement>): number | null => {
    const box = boxRef.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    const col = Math.min(2, Math.max(0, Math.floor(x * 3)));
    const row = Math.min(2, Math.max(0, Math.floor(y * 3)));
    const centerX = (col + 0.5) / 3;
    const centerY = (row + 0.5) / 3;
    if (Math.hypot(x - centerX, y - centerY) > 0.13) return null;
    return row * 3 + col;
  };

  const add = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const index = cellAt(event);
    if (index === null) return;
    setSelected((previous) => {
      if (previous.includes(index)) return previous;
      const next = [...previous, index];
      selectedRef.current = next;
      return next;
    });
  };

  const finish = (): void => {
    dragging.current = false;
    const signature = selectedRef.current.join("-");
    if (selectedRef.current.length >= 4) onComplete(signature);
    selectedRef.current = [];
    setSelected([]);
  };

  const points = selected.map((index) => ({
    x: 50 + (index % 3) * 100,
    y: 50 + Math.floor(index / 3) * 100,
  }));

  return (
    <div
      ref={boxRef}
      className="relative mx-auto aspect-square w-full max-w-[260px] touch-none select-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
        selectedRef.current = [];
        setSelected([]);
        add(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) add(event);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <svg viewBox="0 0 300 300" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {points.length > 1 ? (
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke="#2563eb"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {Array.from({ length: 9 }, (_, index) => {
          const active = selected.includes(index);
          return (
            <circle
              key={index}
              cx={50 + (index % 3) * 100}
              cy={50 + Math.floor(index / 3) * 100}
              r={active ? 16 : 11}
              fill={active ? "#2563eb" : "#cbd5e1"}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function AppLockPage(): ReactNode {
  const bridge = clientBridge();
  const toast = useToast();
  const [status, setStatus] = useState<LockStatus | null>(() =>
    bridge ? readStatus(bridge) : null,
  );
  const [kind, setKind] = useState<LockKind | null>(null);
  const [firstPin, setFirstPin] = useState("");
  const [pin, setPin] = useState("");
  const [patternFirst, setPatternFirst] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    if (bridge) setStatus(readStatus(bridge));
  }, [bridge]);

  const resetForm = (): void => {
    setKind(null);
    setFirstPin("");
    setPin("");
    setPatternFirst(null);
  };

  if (!bridge || !bridge.lockStatus || !bridge.saveLock) {
    return (
      <div className="bg-app min-h-[100dvh]">
        <PageHeader title="应用锁" back />
        <main className="page page-with-nav pt-5">
          <section className="card mx-auto max-w-[400px] p-4">
            <p className="text-sm font-medium text-text">此功能仅在安卓客户端内可用</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              请更新到最新版客户端后再设置应用锁。
            </p>
          </section>
        </main>
      </div>
    );
  }

  const savePin = (): void => {
    if (!kind || kind === "pattern") return;
    const length = kind === "pin4" ? 4 : 6;
    if (firstPin === "") {
      if (!new RegExp(`^\\d{${length}}$`).test(pin)) {
        toast.error(`请输入 ${length} 位数字`);
        return;
      }
      setFirstPin(pin);
      setPin("");
      return;
    }
    if (pin !== firstPin) {
      toast.error("两次输入不一致，请重新设置");
      setFirstPin("");
      setPin("");
      return;
    }
    if (bridge.saveLock?.(kind, pin)) {
      toast.success("应用锁已开启");
      resetForm();
      refresh();
    } else {
      toast.error("保存失败，请重试");
    }
  };

  const savePattern = (signature: string): void => {
    if (patternFirst === null) {
      setPatternFirst(signature);
      return;
    }
    if (signature !== patternFirst) {
      toast.error("两次手势不一致，请重新设置");
      setPatternFirst(null);
      return;
    }
    if (bridge.saveLock?.("pattern", signature)) {
      toast.success("应用锁已开启");
      resetForm();
      refresh();
    } else {
      toast.error("保存失败，请重试");
    }
  };

  const disableLock = (): void => {
    if (!window.confirm("关闭后打开 gzspay 不再需要验证。")) return;
    bridge.clearLock?.();
    toast.success("应用锁已关闭");
    resetForm();
    refresh();
  };

  const enableBiometric = (next: boolean): void => {
    bridge.setBiometric?.(next);
    refresh();
  };

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="应用锁" back />
      <main className="page page-with-nav space-y-4 pt-5">
        <section className="card mx-auto w-full max-w-[400px] p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">当前状态</h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
              {status ? TYPE_LABEL[status.type] : "读取失败"}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            应用锁只在本机生效，密码只保存加盐哈希；冷启动或离开超过 30 秒后需要验证。
          </p>

          {status && status.type !== "none" ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text">指纹 / 人脸解锁</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {status.biometricAvailable ? "用系统生物识别代替输入密码" : "这台设备没有可用的指纹或人脸"}
                </p>
              </div>
              <Toggle
                checked={status.biometricEnabled}
                disabled={!status.biometricAvailable}
                label="指纹 / 人脸解锁"
                onChange={enableBiometric}
              />
            </div>
          ) : null}
        </section>

        <section className="card mx-auto w-full max-w-[400px] p-4">
          <h2 className="text-sm font-semibold text-text">设置解锁方式</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["pin4", "pin6", "pattern"] as LockKind[]).map((item) => (
              <button
                key={item}
                type="button"
                className={kind === item ? "btn btn-secondary btn-sm" : "btn btn-outline btn-sm"}
                onClick={() => {
                  resetForm();
                  setKind(item);
                }}
              >
                {item === "pin4" ? "四位数字" : item === "pin6" ? "六位数字" : "手势"}
              </button>
            ))}
          </div>

          {kind ? (
            <div className="mt-4 rounded-xl border border-line/70 p-3">
              {kind === "pattern" ? (
                <>
                  <p className="mb-2 text-center text-[12px] text-muted">
                    {patternFirst === null ? "画一个手势密码（至少连接 4 个点）" : "再画一次确认"}
                  </p>
                  <PatternLock key={patternFirst === null ? "first" : "second"} onComplete={savePattern} />
                </>
              ) : (
                <>
                  <p className="mb-2 text-center text-[12px] text-muted">
                    {firstPin === "" ? `设置 ${kind === "pin4" ? 4 : 6} 位数字密码` : "再输入一次确认"}
                  </p>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={kind === "pin4" ? 4 : 6}
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                    className="input text-center text-lg tracking-[0.4em]"
                    placeholder="••••"
                    aria-label="应用锁密码"
                  />
                </>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn btn-outline btn-sm flex-1" onClick={resetForm}>
                  取消
                </button>
                {kind !== "pattern" ? (
                  <button type="button" className="btn btn-primary btn-sm flex-1" onClick={savePin}>
                    确定
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {status && status.type !== "none" ? (
            <button type="button" className="btn btn-outline btn-sm mt-4 w-full" onClick={disableLock}>
              关闭应用锁
            </button>
          ) : null}
        </section>
      </main>
    </div>
  );
}
