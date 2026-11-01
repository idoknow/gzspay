import type { Request } from "express";
import { config } from "../config.js";
import { queryOne } from "../db/index.js";

export type Channel = "alipay" | "wechat" | "qq";
export const CHANNELS: readonly Channel[] = ["alipay", "wechat", "qq"];
export const CHANNEL_LABELS: Record<Channel, string> = {
  alipay: "支付宝",
  wechat: "微信支付",
  qq: "QQ 钱包",
};

export type OrderStatus = "pending_payment" | "paid" | "completed" | "cancelled";
export type OnboardStep = "name" | "studentNo" | "email" | "card" | "password" | "done";
export type AdminRole = "super" | "ops" | "auditor";

export interface UserRow {
  id: string;
  campux_sub: string;
  qq: string | null;
  campux_username: string | null;
  surname: string | null;
  given_name: string | null;
  student_no: string | null;
  email: string | null;
  email_verified: number;
  card_no: string | null;
  avatar_url: string | null;
  payment_pwd_hash: string | null;
  payment_fail_count: number;
  payment_fail_window_start: string | null;
  payment_locked_until: string | null;
  onboard_step: OnboardStep;
  onboarded: number;
  status: "active" | "frozen";
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  kind: "user";
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export interface PaymentRequestRow {
  id: string;
  merchant_id: string;
  customer_id: string;
  amount_cents: number;
  reserved_note: string | null;
  items_json: string | null;
  title: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  order_id: string | null;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
}

export interface AppealRow {
  id: string;
  order_id: string;
  user_id: string;
  reason: string;
  status: "open" | "closed" | "flagged";
  handled_by: string | null;
  handled_at: string | null;
  handling_note: string | null;
  created_at: string;
}

export interface MerchantRow {
  user_id: string;
  name: string;
  note_requirement: string;
  created_at: string;
  updated_at: string;
}

export interface MerchantChannelRow {
  merchant_id: string;
  channel: Channel;
  qr_content: string;
  enabled: number;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  merchant_id: string;
  name: string;
  price_cents: number;
  description: string;
  image_url: string | null;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface OrderRow {
  id: string;
  order_no: string;
  merchant_id: string;
  payer_id: string;
  amount_cents: number;
  title: string;
  items_json: string | null;
  reserved_note: string | null;
  actual_note: string | null;
  pay_channel: Channel | null;
  status: OrderStatus;
  cancel_reason: string | null;
  created_by: "payer" | "merchant";
  merchant_name_snapshot: string;
  payer_name_snapshot: string;
  note_requirement_snapshot: string;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  flagged: number;
  flag_reason: string | null;
  closed_by_admin_id: string | null;
}

export interface OrderEventRow {
  id: string;
  order_id: string;
  type: string;
  actor_id: string | null;
  actor_role: "payer" | "merchant" | "admin" | "system";
  detail: string | null;
  created_at: string;
}

export interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  starts_at: string;
  ends_at: string;
  pinned: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminRow {
  user_id: string;
  role: AdminRole;
  created_by: string | null;
  created_at: string;
}

export interface NotificationSettingsRow {
  user_id: string;
  new_order: number;
  paid: number;
  settled: number;
}

export interface PublicUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  studentNoMasked: string;
  isMerchant: boolean;
}

export interface Me {
  id: string;
  displayName: string;
  surname: string | null;
  givenName: string | null;
  fullName: string | null;
  studentNo: string | null;
  email: string | null;
  emailMasked: string | null;
  /** 本人可见的完整卡号（仅 /api/me 类接口返回；对外展示用 cardNoMasked） */
  cardNo: string | null;
  cardNoMasked: string | null;
  avatarUrl: string | null;
  onboarded: boolean;
  onboardStep: OnboardStep;
  isMerchant: boolean;
  isAdmin: boolean;
  paymentPasswordSet: boolean;
  frozen: boolean;
  notificationSettings: { newOrder: boolean; paid: boolean; settled: boolean };
  createdAt: string;
}

/** 当前登录用户上下文 */
export interface AuthContext {
  user: UserRow;
  session: SessionRow;
  ip: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      admin?: { user: UserRow; admin: AdminRow; session: SessionRow };
    }
  }
}

export function requestIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function isCampuxConfigured(): boolean {
  return Boolean(config.campux.clientId && config.campux.clientSecret);
}

export function findUserById(id: string): UserRow | undefined {
  return queryOne<UserRow>("SELECT * FROM users WHERE id = ?", id);
}
