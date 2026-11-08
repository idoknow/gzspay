/**
 * FCM HTTP v1 推送。
 *
 * 没有配置服务账号时整个模块静默跳过：本地开发和没有 Firebase 的部署不应该因为
 * 推送未配置而报错。令牌失效（UNREGISTERED / INVALID_ARGUMENT）时顺手清掉。
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { config, resolvePathFromRepo } from "../config.js";
import { execute, nowIso, queryAll } from "../db/index.js";
import { errors } from "../lib/errors.js";

interface ServiceAccount {
  project_id?: string;
  client_email: string;
  private_key: string;
}

/** 单账号最多保留的设备数，避免旧设备令牌无限堆积 */
const MAX_TOKENS_PER_USER = 10;
const TOKEN_PATTERN = /^[A-Za-z0-9_:-]{20,4096}$/;

let accountCache: { at: number; account: ServiceAccount | null } | null = null;
let tokenCache: { token: string; expiresAt: number } | null = null;
let loggedMissing = false;

function loadServiceAccount(): ServiceAccount | null {
  if (accountCache && Date.now() - accountCache.at < 60_000) return accountCache.account;
  let raw = config.push.serviceAccountJson.trim();
  if (!raw && config.push.serviceAccountFile) {
    try {
      raw = readFileSync(resolvePathFromRepo(config.push.serviceAccountFile), "utf8");
    } catch {
      raw = "";
    }
  }
  let account: ServiceAccount | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
      if (parsed.client_email && parsed.private_key) {
        account = {
          client_email: parsed.client_email,
          private_key: parsed.private_key,
          project_id: parsed.project_id,
        };
      }
    } catch {
      account = null;
    }
  }
  accountCache = { at: Date.now(), account };
  return account;
}

export function isPushConfigured(): boolean {
  return loadServiceAccount() !== null;
}

export interface PushMessage {
  title: string;
  body: string;
  /** 点开通知后要打开的站内路径，例如 /orders/<id> */
  url?: string;
  /** 额外的字符串字段（值必须是字符串） */
  data?: Record<string, string>;
}

/** 注册（或把某台设备转到当前账号）：同一 token 只保留一行 */
export function registerPushToken(userId: string, token: string, platform = "android"): void {
  if (!TOKEN_PATTERN.test(token)) throw errors.validation("推送令牌格式不正确");
  const now = nowIso();
  execute(
    `INSERT INTO push_tokens (token, user_id, platform, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at`,
    token,
    userId,
    platform,
    now,
    now,
  );
  const rows = queryAll<{ token: string }>(
    "SELECT token FROM push_tokens WHERE user_id = ? ORDER BY updated_at DESC",
    userId,
  );
  for (const row of rows.slice(MAX_TOKENS_PER_USER)) {
    execute("DELETE FROM push_tokens WHERE token = ?", row.token);
  }
}

export function removePushToken(userId: string, token: string): void {
  execute("DELETE FROM push_tokens WHERE token = ? AND user_id = ?", token, userId);
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** 用服务账号私钥换 OAuth2 access token，缓存到过期前 1 分钟 */
async function accessToken(account: ServiceAccount): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  let assertion: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    assertion = `${header}.${claims}.${base64url(signer.sign(account.private_key))}`;
  } catch {
    return null;
  }
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
    };
    return tokenCache.token;
  } catch {
    return null;
  }
}

/** 向一个用户的全部设备推送；任何失败都不影响业务请求 */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<void> {
  const account = loadServiceAccount();
  if (!account) {
    if (!loggedMissing) {
      loggedMissing = true;
      console.info("[gzspay] 未配置 FCM 服务账号，推送已跳过");
    }
    return;
  }
  const tokens = queryAll<{ token: string }>(
    "SELECT token FROM push_tokens WHERE user_id = ?",
    userId,
  );
  if (tokens.length === 0) return;
  const authToken = await accessToken(account);
  if (!authToken) return;
  const projectId = config.push.projectId.trim() || account.project_id;
  if (!projectId) return;

  await Promise.all(
    tokens.map(async (row) => {
      try {
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${authToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token: row.token,
                notification: { title: message.title, body: message.body },
                data: { ...(message.data ?? {}), ...(message.url ? { url: message.url } : {}) },
                android: { priority: "high", notification: { channel_id: "gzspay_default" } },
              },
            }),
          },
        );
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          if (
            response.status === 404 ||
            /UNREGISTERED|INVALID_ARGUMENT|registration-token-not-registered/i.test(text)
          ) {
            execute("DELETE FROM push_tokens WHERE token = ?", row.token);
          }
        }
      } catch {
        // 网络失败不影响业务
      }
    }),
  );
}

/** 业务事件里调用：不等待、不抛出 */
export function pushNotification(userId: string, message: PushMessage): void {
  void sendPushToUser(userId, message).catch(() => {
    // 推送永远是可选的旁路
  });
}
