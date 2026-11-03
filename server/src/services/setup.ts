import { execute, nowIso, queryOne } from "../db/index.js";
import { writeAudit } from "../lib/audit.js";
import { AppError, errors } from "../lib/errors.js";
import {
  countAdmins,
  isCampuxReady,
  isMailReady,
  isSystemReady,
  markInitialized,
  readAdminConfig,
  readCampuxConfig,
  readMailConfig,
  readSystemConfig,
  writeRuntimeConfig,
  type MailConfigView,
} from "../lib/runtime-config.js";
import type { AdminRow, UserRow } from "../lib/types.js";

/** 初始化状态（管理后台向导与主站拦截页共用） */
export interface SetupStatus {
  initialized: boolean;
  campuxConfigured: boolean;
  mailConfigured: boolean;
  adminCount: number;
  system: { siteName: string; schoolName: string; publicBaseUrl: string; icp: string };
  campux: { baseUrl: string; clientId: string; clientSecretConfigured: boolean; scope: string };
  mail: MailConfigView;
}

export function setupStatus(): SetupStatus {
  const view = readAdminConfig();
  return {
    initialized: isSystemReady(),
    campuxConfigured: isCampuxReady(),
    mailConfigured: isMailReady(),
    adminCount: countAdmins(),
    system: readSystemConfig(),
    campux: readCampuxConfig(),
    mail: view.mail,
  };
}

export function findAdminRow(userId: string): AdminRow | undefined {
  return queryOne<AdminRow>("SELECT * FROM admins WHERE user_id = ?", userId);
}

export interface SetupCampuxInput {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

export interface SetupMailInput {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  fromName: string;
  fromAddress: string;
}

export interface SetupSystemInput {
  siteName: string;
  /** 校名（学校简称），可留空；留空时界面只显示「校园服务」 */
  schoolName?: string;
  publicBaseUrl?: string;
  /** ICP 备案号，留空表示暂不填写 */
  icp?: string;
}

export interface SetupConfigInput {
  campux?: SetupCampuxInput;
  mail?: SetupMailInput;
  system?: SetupSystemInput;
}

/** 保存初始化配置：允许分步提交，未提交的字段沿用已保存值 */
export function saveSetupConfig(input: SetupConfigInput, ip: string): SetupStatus {
  if (isSystemReady()) {
    throw new AppError(409, "ALREADY_INITIALIZED", "系统已完成初始化，请到后台「系统配置」修改");
  }
  const campux = readCampuxConfig();
  const mail = readMailConfig();
  const system = readSystemConfig();
  writeRuntimeConfig({
    campux: {
      baseUrl: input.campux?.baseUrl ?? campux.baseUrl,
      clientId: input.campux?.clientId ?? campux.clientId,
      scope: input.campux?.scope ?? campux.scope,
      ...(input.campux?.clientSecret ? { clientSecret: input.campux.clientSecret } : {}),
    },
    mail: {
      host: input.mail?.host ?? mail.host,
      port: input.mail?.port ?? mail.port,
      secure: input.mail?.secure ?? mail.secure,
      username: input.mail?.username ?? mail.username,
      fromName: input.mail?.fromName ?? mail.fromName,
      fromAddress: input.mail?.fromAddress ?? mail.fromAddress,
      ...(input.mail?.password ? { password: input.mail.password } : {}),
    },
    system: {
      siteName: input.system?.siteName ?? system.siteName,
      ...(input.system?.schoolName !== undefined ? { schoolName: input.system.schoolName } : {}),
      publicBaseUrl: input.system?.publicBaseUrl ?? system.publicBaseUrl,
      ...(input.system?.icp !== undefined ? { icp: input.system.icp } : {}),
    },
  });
  writeAudit({
    actorId: null,
    actorRole: "system",
    action: "setup.config.saved",
    targetType: "app_config",
    targetId: null,
    detail: "保存初始化配置（校园墙登录 / 发件配置 / 站点信息）",
    ip,
  });
  return setupStatus();
}

/** 完成初始化：把当前登录用户设为超级管理员并标记系统已就绪 */
export function finishSetup(user: UserRow, ip: string): AdminRow {
  if (isSystemReady()) {
    throw new AppError(409, "ALREADY_INITIALIZED", "系统已完成初始化");
  }
  if (!isCampuxReady()) {
    throw errors.validation("请先配置校园墙登录，否则无法验证身份");
  }
  let admin = findAdminRow(user.id);
  if (!admin) {
    execute(
      "INSERT INTO admins (user_id, role, created_by, created_at) VALUES (?, 'super', NULL, ?)",
      user.id,
      nowIso(),
    );
    admin = findAdminRow(user.id);
    writeAudit({
      actorId: user.id,
      actorRole: "admin",
      action: "admin.member.added",
      targetType: "user",
      targetId: user.id,
      detail: "初始化时第一个登录的账号自动成为超级管理员",
      ip,
    });
  }
  markInitialized();
  writeAudit({
    actorId: user.id,
    actorRole: "system",
    action: "setup.completed",
    detail: "系统初始化完成",
    ip,
  });
  if (!admin) throw errors.conflict("管理员写入失败，请重试");
  return admin;
}

/**
 * 首个登录的用户自动成为超级管理员（系统里还没有任何管理员时）。
 * 返回新建的管理员记录，已有管理员时返回 null。
 */
export function ensureFirstAdmin(user: UserRow, ip: string): AdminRow | null {
  const existing = findAdminRow(user.id);
  if (existing) return null;
  if (countAdmins() > 0) return null;
  execute(
    "INSERT INTO admins (user_id, role, created_by, created_at) VALUES (?, 'super', NULL, ?)",
    user.id,
    nowIso(),
  );
  markInitialized();
  writeAudit({
    actorId: user.id,
    actorRole: "admin",
    action: "setup.first_admin",
    targetType: "user",
    targetId: user.id,
    detail: "系统初始化：第一个登录的账号自动成为超级管理员",
    ip,
  });
  return findAdminRow(user.id) ?? null;
}
