import { timingSafeEqual } from "node:crypto";
import { getConfigValue, setConfigValue } from "../db/index.js";
import { randomToken } from "./crypto.js";

/**
 * 一次性初始化令牌。
 *
 * 背景：`POST /api/setup/config` 在系统未初始化时无需登录即可调用，
 * 攻击者可以抢先写入自己的 `campux.baseUrl`（伪造 IdP），再借「第一个登录的
 * 账号自动成为超级管理员」拿到管理员权限。因此首次初始化必须持有服务端在
 * 启动时生成并打印到日志里的一次性令牌。
 *
 * 令牌只存在库里（`system.setupToken`），验证通过后在 `system.setupTokenVerified`
 * 记一个标记：只有验证过令牌的实例才允许把第一个登录账号提升为超级管理员。
 */
const TOKEN_KEY = "system.setupToken";
const VERIFIED_KEY = "system.setupTokenVerified";

/** 读取令牌；没有就生成一个并打印到日志（只在未初始化阶段生成） */
export function ensureSetupToken(): string {
  const existing = getConfigValue(TOKEN_KEY);
  if (existing) return existing;
  const token = randomToken(12).replace(/[^A-Za-z0-9]/g, "").slice(0, 16).toUpperCase();
  setConfigValue(TOKEN_KEY, token);
  console.warn(
    `[gzspay] 初始化令牌：${token} —— 首次初始化时需要在「初始化」页面填写（服务端日志里可见，初始化完成后失效）`,
  );
  return token;
}

/** 是否已经校验过初始化令牌（决定是否允许首个账号自动成为超级管理员） */
export function setupTokenVerified(): boolean {
  return getConfigValue(VERIFIED_KEY) === "1";
}

/** 校验令牌；通过后写入标记，返回 true */
export function verifySetupToken(input: unknown): boolean {
  const expected = getConfigValue(TOKEN_KEY);
  if (!expected) return false;
  if (typeof input !== "string") return false;
  const candidate = input.trim().toUpperCase();
  if (candidate.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))) return false;
  setConfigValue(VERIFIED_KEY, "1");
  return true;
}

/** 初始化完成后作废令牌 */
export function clearSetupToken(): void {
  if (getConfigValue(TOKEN_KEY)) setConfigValue(TOKEN_KEY, "");
  if (getConfigValue(VERIFIED_KEY)) setConfigValue(VERIFIED_KEY, "");
}

/** 初始化页面用：是否需要填写令牌（未校验过、且系统还没就绪时为 true） */
export function setupTokenRequired(): boolean {
  return Boolean(getConfigValue(TOKEN_KEY)) && !setupTokenVerified();
}
