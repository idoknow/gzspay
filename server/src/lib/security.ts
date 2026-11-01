import { config } from "../config.js";

/**
 * 生产环境安全配置自检。
 *
 * 目标：不要把「示例密钥」「http 地址」这类配置带上线。
 * 校验失败时服务直接启动失败，并在日志里列出每一项问题（配置属于敏感信息，不回显具体值）。
 */

/** 代码里的示例密钥，生产环境不允许继续使用 */
export const DEV_SESSION_SECRET = "dev-only-session-secret-change-me";
/** 会话密钥最小长度 */
export const MIN_SESSION_SECRET_LENGTH = 32;

export interface SecurityConfigInput {
  isProduction: boolean;
  sessionSecret: string;
  appBaseUrl: string;
  publicBaseUrl: string;
  /** 内网部署（没有 https 证书）时显式放行 */
  allowInsecureBaseUrl: boolean;
}

/** 返回配置问题列表，空数组表示通过 */
export function securityConfigProblems(input: SecurityConfigInput): string[] {
  if (!input.isProduction) return [];
  const problems: string[] = [];

  if (!input.sessionSecret || input.sessionSecret === DEV_SESSION_SECRET) {
    problems.push("SESSION_SECRET 仍是示例值，请换成随机字符串（可用 openssl rand -hex 32 生成）");
  } else if (input.sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(`SESSION_SECRET 至少需要 ${MIN_SESSION_SECRET_LENGTH} 个字符`);
  }

  const urls: Array<[string, string]> = [
    ["APP_BASE_URL", input.appBaseUrl],
    ["PUBLIC_BASE_URL", input.publicBaseUrl],
  ];
  for (const [name, value] of urls) {
    if (!value.startsWith("https://") && !input.allowInsecureBaseUrl) {
      problems.push(`${name} 必须是 https:// 地址；内网无证书部署可设置 ALLOW_INSECURE_BASE_URL=1 放行`);
    }
  }
  return problems;
}

/** 启动时执行：生产环境配置不合格直接抛错，由 index.ts 打印并退出 */
export function assertSecureConfig(): void {
  const problems = securityConfigProblems({
    isProduction: config.isProduction,
    sessionSecret: config.sessionSecret,
    appBaseUrl: config.appBaseUrl,
    publicBaseUrl: config.publicBaseUrl,
    allowInsecureBaseUrl: config.allowInsecureBaseUrl,
  });
  if (problems.length > 0) {
    throw new Error(`安全配置未通过校验：\n- ${problems.join("\n- ")}`);
  }
}
