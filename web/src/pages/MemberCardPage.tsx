/**
 * 身份卡：把「我的」页顶部那张卡做成一张可以 3D 拖动的实体卡。
 *
 * 卡面只放自己的信息（姓名、学号、校园卡号、头像），没有任何操作功能；
 * 左右拖动时卡片绕 Y 轴转动，拖动距离越大转动越慢（tanh 阻尼），松手回弹。
 */

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Avatar } from "../components/Avatar";
import { LogoMark } from "../components/Logo";
import { PageHeader } from "../components/PageHeader";
import { useAuth } from "../lib/session";

/** 最大转动角度（度）：左右 ±22°、上下 ±10° */
const MAX_ROTATE_Y = 22;
const MAX_ROTATE_X = 10;
/** 阻尼：数值越大，拖同样距离转得越少（手感更"重"） */
const DRAG_DAMPING_Y = 150;
const DRAG_DAMPING_X = 220;

function formatCardNo(value: string | null): string {
  const digits = (value ?? "").replace(/\s+/g, "");
  if (!digits) return "未绑定";
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

/** 芯片：金色圆角块 + 触点纹路 */
function ChipIcon(): ReactNode {
  return (
    <span className="relative block h-6 w-8 overflow-hidden rounded-[5px] bg-[linear-gradient(135deg,#f6e2a8,#c9a24a_55%,#e8cf90)] ring-1 ring-black/20">
      <span className="absolute inset-x-1 top-[7px] h-px bg-black/25" />
      <span className="absolute inset-x-1 top-[13px] h-px bg-black/25" />
      <span className="absolute inset-y-1 left-1/2 w-px bg-black/20" />
    </span>
  );
}

/** 非接触支付标记 */
function ContactlessIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.4 8.6a5.6 5.6 0 0 1 0 6.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10.6 6.2a9.4 9.4 0 0 1 0 11.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13.8 4a13.2 13.2 0 0 1 0 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function MemberCardPage(): ReactNode {
  const { me } = useAuth();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const reduced = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = query.matches;
  }, []);

  /** 把角度写到卡片上，同时让高光跟着倾斜方向走 */
  const paint = useCallback((rotateX: number, rotateY: number) => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transform = `rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;
    card.style.setProperty("--sheen-x", `${(50 - rotateY * 1.9).toFixed(1)}%`);
    card.style.setProperty("--sheen-y", `${(50 + rotateX * 2.4).toFixed(1)}%`);
  }, []);

  /** tanh 阻尼：拖动距离越大，角度增加得越慢，所以有"越推越沉"的手感 */
  const anglesOf = (dx: number, dy: number): { rotateX: number; rotateY: number } => ({
    rotateX: -MAX_ROTATE_X * Math.tanh(dy / DRAG_DAMPING_X),
    rotateY: MAX_ROTATE_Y * Math.tanh(dx / DRAG_DAMPING_Y),
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging.current = true;
    origin.current = { x: event.clientX, y: event.clientY };
    const card = cardRef.current;
    if (card) {
      card.style.transition = "none";
      card.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    const { rotateX, rotateY } = anglesOf(event.clientX - origin.current.x, event.clientY - origin.current.y);
    paint(rotateX, rotateY);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    const card = cardRef.current;
    if (!card) return;
    if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
    card.style.transition = reduced.current ? "none" : "transform 620ms cubic-bezier(0.22, 1.2, 0.36, 1)";
    paint(0, 0);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const { rotateX, rotateY } = anglesOf(event.key === "ArrowLeft" ? -70 : 70, 0);
    const card = cardRef.current;
    if (card) card.style.transition = reduced.current ? "none" : "transform 320ms ease-out";
    paint(rotateX, rotateY);
    window.setTimeout(() => {
      if (card) card.style.transition = reduced.current ? "none" : "transform 620ms cubic-bezier(0.22, 1.2, 0.36, 1)";
      paint(0, 0);
    }, 320);
  };

  const name = me?.displayName ?? "同学";

  return (
    <div className="bg-app min-h-[100dvh]">
      <PageHeader title="我的卡片" back />

      <main className="page page-with-nav space-y-4 pt-5 watch:space-y-3">
        <div className="mx-auto w-full max-w-[400px]" style={{ perspective: "1200px" }}>
          <div
            ref={cardRef}
            role="group"
            aria-label="我的身份卡，可用左右方向键倾斜"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={onKeyDown}
            className="relative aspect-[1.6/1] w-full cursor-grab touch-pan-y select-none overflow-hidden rounded-[22px] outline-none transition-[box-shadow] duration-300 focus-visible:ring-2 focus-visible:ring-brand/60 active:cursor-grabbing"
            style={{
              transformStyle: "preserve-3d",
              background: "linear-gradient(135deg, #141a26 0%, #1d2536 46%, #0e131c 100%)",
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.14) inset, 0 -40px 60px -40px rgba(255,255,255,0.1) inset, 0 30px 60px -30px rgba(8,12,20,0.75), 0 8px 18px -12px rgba(8,12,20,0.6)",
            }}
          >
            {/* 品牌色光晕 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full opacity-70 blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(30,107,255,0.55), transparent 70%)" }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 -left-12 h-52 w-52 rounded-full opacity-60 blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(255,196,84,0.42), transparent 70%)" }}
            />
            {/* 跟随拖动的高光 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-60 transition-opacity duration-500"
              style={{
                background:
                  "radial-gradient(60% 60% at var(--sheen-x, 50%) var(--sheen-y, 50%), rgba(255,255,255,0.26), transparent 68%)",
              }}
            />
            {/* 斜向全息条 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-[0.16]"
              style={{
                background:
                  "linear-gradient(112deg, transparent 32%, rgba(140,190,255,0.55) 44%, rgba(255,225,170,0.5) 52%, rgba(160,255,214,0.35) 58%, transparent 70%)",
              }}
            />

            <div className="relative flex h-full flex-col justify-between p-5 watch:p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <LogoMark size={26} />
                  <div className="leading-none">
                    <p className="text-[13px] font-semibold tracking-[0.12em] text-white/92">gzspay</p>
                    <p className="mt-1 text-[9.5px] tracking-[0.22em] text-white/45">CAMPUS CARD</p>
                  </div>
                </div>
                <span className="text-white/55">
                  <ContactlessIcon />
                </span>
              </div>

              <div className="flex items-center gap-3">
                <ChipIcon />
                <div className="min-w-0">
                  <p className="text-[9.5px] tracking-[0.18em] text-white/40">学号</p>
                  <p className="mt-0.5 truncate font-mono text-[15px] tracking-[0.14em] text-white/92 watch:text-[14px]">
                    {me?.studentNo || "未填写"}
                  </p>
                </div>
              </div>

              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9.5px] tracking-[0.18em] text-white/40">持卡人</p>
                  <p className="mt-0.5 truncate text-[17px] leading-tight font-semibold text-white watch:text-[16px]">
                    {name}
                  </p>
                  <p className="mt-2 text-[9.5px] tracking-[0.18em] text-white/40">校园卡号</p>
                  <p className="mt-0.5 truncate font-mono text-[12.5px] tracking-[0.16em] text-white/80">
                    {formatCardNo(me?.cardNo ?? null)}
                  </p>
                </div>
                <Avatar
                  name={name}
                  avatarUrl={me?.avatarUrl ?? null}
                  size={46}
                  className="shrink-0 ring-1 ring-white/25"
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
