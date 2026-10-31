import { createHash, randomBytes } from "node:crypto";
import { config, isCampuxConfigured } from "../config.js";
import { execute, isoAfter, nowIso, queryOne } from "../db/index.js";
import { newId, sha256 } from "./crypto.js";
import { errors } from "./errors.js";
import { writeLoginLog, writeSystemError } from "./audit.js";

export interface CampuxProfile {
  sub: string;
  qq: string | null;
  username: string | null;
  tenantId: string | null;
  tenantName: string | null;
}

type OAuthKind = "user" | "admin";

interface OAuthStateRow {
  state: string;
  code_verifier: string;
  redirect_to: string | null;
  purpose: string;
  created_at: string;
  expires_at: string;
}

function authorizeEndpoint(): string {
  return `${config.campux.baseUrl}/oauth/authorize`;
}

function tokenEndpoint(): string {
  return `${config.campux.baseUrl}/oauth/token`;
}

function userinfoEndpoint(): string {
  return `${config.campux.baseUrl}/oauth/userinfo`;
}

function revokeEndpoint(): string {
  return `${config.campux.baseUrl}/oauth/revoke`;
}

export function oauthRedirectUri(kind: OAuthKind): string {
  return kind === "user" ? config.campux.redirectUri : config.campux.adminRedirectUri;
}

/** 生成 state + PKCE（S256），写入 oauth_states，10 分钟过期 */
export function createAuthorizationRequest(
  kind: OAuthKind,
  redirectTo: string | null,
): string {
  if (!isCampuxConfigured()) {
    throw errors.validation(
      "尚未配置校园墙 OAuth（CAMPUX_CLIENT_ID / CAMPUX_CLIENT_SECRET），请联系管理员",
    );
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
    kind,
    nowIso(),
    isoAfter(600),
  );

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.campux.clientId,
    redirect_uri: oauthRedirectUri(kind),
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
}

/** 校验并消费 state（一次性） */
export function consumeState(state: string | undefined, kind: OAuthKind): StateConsumption {
  if (!state) throw errors.validation("授权请求缺少 state，请重新登录");
  const row = queryOne<OAuthStateRow>(
    "SELECT * FROM oauth_states WHERE state = ? AND purpose = ?",
    state,
    kind,
  );
  execute("DELETE FROM oauth_states WHERE state = ?", state);
  if (!row) throw errors.validation("授权状态无效或已使用，请重新登录");
  if (row.expires_at <= nowIso()) {
    throw errors.validation("授权请求已过期，请重新登录");
  }
  return { codeVerifier: row.code_verifier, redirectTo: row.redirect_to };
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

async function exchangeCode(
  kind: OAuthKind,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: oauthRedirectUri(kind),
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

/** 完整回调流程：校验 state → 换 token → userinfo → revoke → 返回用户画像 */
export async function completeAuthorization(
  kind: OAuthKind,
  code: string | undefined,
  state: string | undefined,
): Promise<{ profile: CampuxProfile; redirectTo: string | null }> {
  const consumed = consumeState(state, kind);
  if (!code) throw errors.validation("授权回调缺少授权码，请重新登录");
  if (!isCampuxConfigured()) {
    throw errors.validation("校园墙 OAuth 未配置，无法完成登录");
  }

  const tokens = await exchangeCode(kind, code, consumed.codeVerifier);
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
    // 核对是否为桂中校园墙
    if (config.campux.tenantId && tenantId !== config.campux.tenantId) {
      writeLoginLog({
        userId: null,
        method: "campux",
        success: false,
        reason: "tenant_mismatch",
      });
      throw errors.forbidden("请使用桂中校园墙账号登录");
    }
    writeLoginLog({ userId: null, method: `campux_${kind}`, success: true });
    return {
      profile: {
        sub,
        qq: asString(info.name),
        username: asString(info.username),
        tenantId,
        tenantName,
      },
      redirectTo: consumed.redirectTo,
    };
  } finally {
    // 登录完成后立即作废校园墙令牌，gzspay 不保存
    revokeCampuxToken(accessToken);
    const refreshToken = tokens.refresh_token;
    if (refreshToken) revokeCampuxToken(refreshToken);
  }
}

/** 开发态模拟登录资料（仅非生产环境可用） */
export function devProfile(seed: number): CampuxProfile {
  const suffixes = ["1", "2", "3", "4", "5"];
  const suffix = suffixes[seed % suffixes.length] ?? "1";
  return {
    sub: config.dev.authEnabled ? `dev-user-${suffix}` : `dev-user-${newId()}`,
    qq: null,
    username: config.dev.username,
    tenantId: config.campux.tenantId,
    tenantName: "桂中校园墙",
  };
}

/** 访问令牌在库中不保存，这里仅为兼容调用方 */
export const CAMPUX_TOKEN_STORAGE_DISABLED = true;

export function stateFingerprint(state: string): string {
  return sha256(state).slice(0, 12);
}
