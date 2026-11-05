/**
 * 公共设备隐私模式。
 *
 * 在教室 / 机房 / 图书馆这类公共电脑上登录后，可以隐藏「我的」个人信息、通知设置、
 * 商家设置与登录设备等页面；收付款、订单、工单等交易功能保持可用。
 * 退出隐私模式需要输入支付密码。状态只存在本机 localStorage，退出登录时清除，
 * 这样下一位使用同一台电脑的人会被重新询问。
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "gzspay.privacy-mode";
const CHANGE_EVENT = "gzspay:privacy-mode";

export type PrivacyChoice = "private" | "public";

interface PrivacyState {
  enabled: boolean;
  choice: PrivacyChoice | null;
}

const EMPTY_STATE: PrivacyState = { enabled: false, choice: null };

function parseState(raw: string | null): PrivacyState {
  if (!raw) return EMPTY_STATE;
  try {
    const value = JSON.parse(raw) as Partial<PrivacyState> | null;
    if (!value) return EMPTY_STATE;
    const choice = value.choice === "private" || value.choice === "public" ? value.choice : null;
    return { enabled: value.enabled === true && choice === "private", choice };
  } catch {
    return EMPTY_STATE;
  }
}

export function readPrivacyState(): PrivacyState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    return parseState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY_STATE;
  }
}

function writeState(state: PrivacyState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 不可用时退化成「本页有效」，不影响使用
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** 开启隐私模式（公共设备） */
export function enablePrivacyMode(): void {
  writeState({ enabled: true, choice: "private" });
}

/** 关闭隐私模式（用户确认这是自己的设备） */
export function disablePrivacyMode(): void {
  writeState({ enabled: false, choice: "public" });
}

/** 退出登录时清除，下一位使用者会重新被询问 */
export function clearPrivacyState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * 是否电脑端：有精确指针（鼠标 / 触摸板）或宽屏。
 * 手机、平板（只有粗指针）不提示隐私模式。
 */
export function isDesktopDevice(): boolean {
  if (typeof window === "undefined") return false;
  const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (coarse && !fine) return false;
  return fine || window.innerWidth >= 1024;
}

/** 订阅隐私模式状态（同一页面内多处使用会同步更新） */
export function usePrivacyMode(): { enabled: boolean; asked: boolean } {
  const [state, setState] = useState<PrivacyState>(readPrivacyState);

  useEffect(() => {
    const onChange = (): void => setState(readPrivacyState());
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    onChange();
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return { enabled: state.enabled, asked: state.choice !== null };
}
