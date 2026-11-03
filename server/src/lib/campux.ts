import { createHash, randomBytes } from "node:crypto";
import { config, isCampuxConfigured } from "../config.js";
import { execute, isoAfter, nowIso, queryOne } from "../db/index.js";
import { sha256 } from "./crypto.js";
import { errors } from "./errors.js";
import { writeLoginLog, writeSystemError } from "./audit.js";

export interface CampuxProfile {
  sub: string;
  qq: string | null;
  username: string | null;
  tenantId: string | null;
  tenantName: string | null;
}

interface OAuthStateRow {
  state: string;
  code_verifier: string;
  redirect_to: string | null;
  purpose: string;
  created_at: string;
  expires_at: string;
}

/**
 * 授权用途：
 * - user：登录 / 注册
 * - password_verify：已登录用户重新授权一次，用来证明「本人操作」（如修改支付密码）
 */
export type AuthorizationPurpose = "user" | "password_verify";

const AUTHORIZATION_PURPOSES: AuthorizationPurpose[] = ["user", "password_verify"];

function authorizeEndpoint(): string {
  return `${config.campux.baseUrl}/oauth/authorize`;
}

/**
 * 服务端直连校园墙时用的地址：默认与 CAMPUX_BASE_URL 相同，
 * 配置了 CAMPUX_INTERNAL_BASE_URL（内网/集群内地址）时优先用它。
 * 浏览器跳转的授权地址仍走 baseUrl，保证用户能打开。
 */
function serverBaseUrl(): string {
  return config.campux.internalBaseUrl || config.campux.baseUrl;
}

function tokenEndpoint(): string {
  return `${serverBaseUrl()}/oauth/token`;
}

function userinfoEndpoint(): string {
  return `${serverBaseUrl()}/oauth/userinfo`;
}

function revokeEndpoint(): string {
  return `${serverBaseUrl()}/oauth/revoke`;
}

export function oauthRedirectUri(): string {
  return config.campux.redirectUri;
}

/**
 * 生成 state + PKCE（S256），写入 oauth_states，10 分钟过期。
 * purpose 决定回调如何处理：登录（user）还是身份验证（password_verify）。
 */
export function createAuthorizationRequest(
  redirectTo: string | null,
  purpose: AuthorizationPurpose = "user",
): string {
  if (!isCampuxConfigured()) {
    throw errors.validation("系统尚未配置校园墙登录，请联系管理员在管理后台完成初始化");
  }
  const state = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  execute(
    `INSERT INTO oauth_states (state, code_verifier, redirect_to, purpose, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    state,
    codeVerifier,
    sanitizeRedirect(redirectTo),
    purpose,
    nowIso(),
    isoAfter(600),
  );

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.campux.clientId,
    redirect_uri: oauthRedirectUri(),
    scope: config.campux.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${authorizeEndpoint()}?${params.toString()}`;
}

/** 只允许站内相对路径，避免开放重定向 */
export function sanitizeRedirect(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (trimmed.length > 500) return null;
  return trimmed;
}

interface StateConsumption {
  codeVerifier: string;
  redirectTo: string | null;
  purpose: AuthorizationPurpose;
}

/** 校验并消费 state（一次性） */
export function consumeState(state: string | undefined): StateConsumption {
  if (!state) throw errors.validation("授权请求缺少 state，请重新登录");
  const row = queryOne<OAuthStateRow>("SELECT * FROM oauth_states WHERE state = ?", state);
  execute("DELETE FROM oauth_states WHERE state = ?", state);
  if (!row) throw errors.validation("授权状态无效或已使用，请重新登录");
  if (row.expires_at <= nowIso()) {
    throw errors.validation("授权请求已过期，请重新登录");
  }
  const purpose = AUTHORIZATION_PURPOSES.includes(row.purpose as AuthorizationPurpose)
    ? (row.purpose as AuthorizationPurpose)
    : null;
  if (!purpose) throw errors.validation("授权请求无效，请重新发起");
  return { codeVerifier: row.code_verifier, redirectTo: row.redirect_to, purpose };
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
}

async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: oauthRedirectUri(),
    client_id: config.campux.clientId,
    client_secret: config.campux.clientSecret,
    code_verifier: codeVerifier,
  };
  let response: Response;
  try {
    response = await postForm(tokenEndpoint(), form);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeSystemError({ scope: "campux", message: `校园墙 token 请求失败：${reason}` });
    throw errors.validation("无法连接校园墙授权服务，请稍后再试");
  }
  if (!response.ok) {
    const text = await safeText(response);
    writeSystemError({
      scope: "campux",
      message: `校园墙 token 交换失败（HTTP ${response.status}）：${text.slice(0, 300)}`,
    });
    throw errors.validation(`校园墙授权失败（${response.status}），请重新登录`);
  }
  return (await response.json()) as TokenResponse;
}

async function fetchUserinfo(accessToken: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(userinfoEndpoint(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    writeSystemError({ scope: "campux", message: `校园墙 userinfo 请求失败：${reason}` });
    throw errors.validation("无法读取校园墙账号信息，请稍后再试");
  }
  if (!response.ok) {
    throw errors.validation("校园墙账号信息读取失败，请重新登录");
  }
  return (await response.json()) as Record<string, unknown>;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** 作废校园墙令牌：gzspay 不保存令牌 */
export function revokeCampuxToken(accessToken: string): void {
  if (!isCampuxConfigured()) return;
  void postForm(revokeEndpoint(), {
    token: accessToken,
    token_type_hint: "access_token",
    client_id: config.campux.clientId,
    client_secret: config.campux.clientSecret,
  }).catch(() => undefined);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** 完整回调流程：校验 state → 换 token → userinfo → revoke → 返回用户画像与授权用途 */
export async function completeAuthorization(
  code: string | undefined,
  state: string | undefined,
): Promise<{ profile: CampuxProfile; redirectTo: string | null; purpose: AuthorizationPurpose }> {
  const consumed = consumeState(state);
  if (!code) throw errors.validation("授权回调缺少授权码，请重新登录");
  if (!isCampuxConfigured()) {
    throw errors.validation("校园墙 OAuth 未配置，无法完成登录");
  }

  const tokens = await exchangeCode(code, consumed.codeVerifier);
  const accessToken = tokens.access_token;
  if (!accessToken) {
    throw errors.validation("校园墙未返回访问令牌，请重新登录");
  }

  try {
    const info = await fetchUserinfo(accessToken);
    const sub = asString(info.sub);
    if (!sub) {
      throw errors.validation("校园墙未返回用户标识，请确认授权范围包含 profile");
    }
    const tenantId = asString(info.tenant_id);
    const tenantName = asString(info.tenant_name);
    // 核对是否为校园墙
    if (config.campux.tenantId && tenantId !== config.campux.tenantId) {
      writeLoginLog({
        userId: null,
        method: "campux",
        success: false,
        reason: "tenant_mismatch",
      });
      throw errors.forbidden("请使用校园墙账号登录");
    }
    writeLoginLog({ userId: null, method: "campux", success: true });
    return {
      profile: {
        sub,
        qq: asString(info.name),
        username: asString(info.username),
        tenantId,
        tenantName,
      },
      redirectTo: consumed.redirectTo,
      purpose: consumed.purpose,
    };
  } finally {
    // 登录完成后立即作废校园墙令牌，gzspay 不保存
    revokeCampuxToken(accessToken);
    const refreshToken = tokens.refresh_token;
    if (refreshToken) revokeCampuxToken(refreshToken);
  }
}

/** 访问令牌在库中不保存，这里仅为兼容调用方 */
export const CAMPUX_TOKEN_STORAGE_DISABLED = true;

export function stateFingerprint(state: string): string {
  return sha256(state).slice(0, 12);
}
