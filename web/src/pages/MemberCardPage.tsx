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
import { useCopy, useContextMenus, type ContextMenuItem } from "../components/ContextMenu";
import { CopyIcon } from "../components/ContextMenuIcons";
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
    <span className="relative block h-[28px] w-[38px] shrink-0 overflow-hidden rounded-[6px] bg-[linear-gradient(135deg,#f7e6b4,#cfa64f_52%,#edd79b)] ring-1 ring-black/25 shadow-[0_1px_1px_rgba(255,255,255,0.35)_inset]">
      <span className="absolute inset-x-1.5 top-[9px] h-px bg-black/25" />
      <span className="absolute inset-x-1.5 top-[15px] h-px bg-black/25" />
      <span className="absolute inset-y-1.5 left-1/2 w-px bg-black/20" />
    </span>
  );
}

/** 非接触支付标记 */
function ContactlessIcon(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.6 8.8a5.4 5.4 0 0 1 0 6.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10.9 6.5a9.2 9.2 0 0 1 0 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14.2 4.4a12.8 12.8 0 0 1 0 15.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

  const copy = useCopy();

  // 右键 / 长按菜单：卡面信息
  useContextMenus({
    "me.card": () => {
      if (!me) return null;
      const menuItems: ContextMenuItem[] = [
        {
          label: "复制校园卡号",
          icon: <CopyIcon />,
          onSelect: () => void copy((me.cardNo ?? "").replace(/\s+/g, ""), "校园卡号"),
        },
        { label: "复制学号", icon: <CopyIcon />, onSelect: () => void copy(me.studentNo ?? "", "学号") },
        { label: "复制姓名", icon: <CopyIcon />, onSelect: () => void copy(me.displayName, "姓名") },
      ];
      return menuItems;
    },
  });

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
            data-menu="me.card"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={onKeyDown}
            className="relative aspect-[1.586/1] w-full cursor-grab touch-pan-y select-none overflow-hidden rounded-[24px] outline-none transition-[box-shadow] duration-300 focus-visible:ring-2 focus-visible:ring-brand/60 active:cursor-grabbing"
            style={{
              transformStyle: "preserve-3d",
              background:
                "linear-gradient(148deg, #1b2537 0%, #141c2b 42%, #0c111a 100%)",
              boxShadow:
                "0 1px 0 rgba(255,255,255,0.16) inset, 0 -60px 70px -60px rgba(120,170,255,0.22) inset, 0 26px 48px -28px rgba(8,12,20,0.72), 0 6px 14px -10px rgba(8,12,20,0.55)",
            }}
          >
            {/* 细边框 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-[24px] ring-1 ring-inset ring-white/10"
            />
            {/* 品牌色光晕 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full opacity-70 blur-[64px]"
              style={{ background: "radial-gradient(circle, rgba(30,107,255,0.55), transparent 72%)" }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 -left-16 h-52 w-52 rounded-full opacity-55 blur-[64px]"
              style={{ background: "radial-gradient(circle, rgba(255,196,84,0.4), transparent 72%)" }}
            />
            {/* 跟随拖动的高光 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-55"
              style={{
                background:
                  "radial-gradient(46% 46% at var(--sheen-x, 50%) var(--sheen-y, 50%), rgba(255,255,255,0.24), transparent 70%)",
              }}
            />
            {/* 斜向全息条 */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-[0.14]"
              style={{
                background:
                  "linear-gradient(112deg, transparent 34%, rgba(140,190,255,0.55) 45%, rgba(255,225,170,0.5) 52%, rgba(160,255,214,0.32) 58%, transparent 70%)",
              }}
            />

            <div className="relative flex h-full flex-col justify-between gap-2 p-5 watch:p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <LogoMark size={24} />
                  <div className="leading-none">
                    <p className="text-[12.5px] font-semibold tracking-[0.16em] text-white/90">GZSPAY</p>
                    <p className="mt-1.5 text-[8.5px] tracking-[0.26em] text-white/40">CAMPUS CARD</p>
                  </div>
                </div>
                <span className="rounded-full border border-white/12 bg-white/[0.06] px-2 py-[3px] text-[8.5px] tracking-[0.18em] text-white/55">
                  校园身份卡
                </span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ChipIcon />
                  <span className="text-white/45">
                    <ContactlessIcon />
                  </span>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-[8.5px] tracking-[0.24em] text-white/40">学号</p>
                  <p className="mt-1 truncate font-mono text-[15px] leading-none tracking-[0.14em] text-white/90 watch:text-[14px]">
                    {me?.studentNo || "未填写"}
                  </p>
                </div>
              </div>

              <div className="flex items-end justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    name={name}
                    avatarUrl={me?.avatarUrl ?? null}
                    size={40}
                    className="shrink-0 ring-1 ring-white/20"
                  />
                  <div className="min-w-0">
                    <p className="text-[8.5px] tracking-[0.24em] text-white/40">持卡人</p>
                    <p className="mt-1 truncate text-[18px] leading-tight font-semibold tracking-[0.01em] text-white watch:text-[17px]">
                      {name}
                    </p>
                  </div>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-[8.5px] tracking-[0.24em] text-white/40">校园卡号</p>
                  <p className="mt-1 truncate font-mono text-[13px] leading-tight tracking-[0.14em] text-white/88">
                    {formatCardNo(me?.cardNo ?? null)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 卡下的柔和投影 */}
          <div
            aria-hidden="true"
            className="mx-auto mt-4 h-7 w-[74%] rounded-[50%] bg-black/20 blur-2xl"
          />
        </div>
      </main>
    </div>
  );
}
