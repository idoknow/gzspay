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
  nfc_token: string | null;
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

/** 商家自建收款单：生成二维码，付款人扫码按固定金额付款（一次性） */
export interface PaymentCollectionRow {
  id: string;
  token_hash: string;
  merchant_id: string;
  amount_cents: number;
  title: string;
  items_json: string | null;
  reserved_note: string | null;
  status: "pending" | "used" | "cancelled" | "expired";
  order_id: string | null;
  payer_id: string | null;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
}

/** 账单对账：商家上传的账单文件（微信 xlsx / 支付宝 csv） */
export interface BillImportRow {
  id: string;
  merchant_id: string;
  provider: "alipay" | "wechat";
  filename: string;
  stored_name: string | null;
  size_bytes: number;
  period_start: string | null;
  period_end: string | null;
  transaction_count: number;
  matched_count: number;
  created_at: string;
}

/** 账单里解析出来的一笔收款流水 */
export interface BillTransactionRow {
  id: string;
  import_id: string;
  merchant_id: string;
  provider: "alipay" | "wechat";
  trade_no: string | null;
  amount_cents: number;
  payer_note: string | null;
  counterparty: string | null;
  paid_at: string | null;
  status: "unmatched" | "matched";
  order_id: string | null;
  created_at: string;
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

export interface TicketRow {
  id: string;
  order_id: string;
  category: TicketCategory;
  status: "open" | "closed";
  opened_by: string;
  closed_by: string | null;
  closed_at: string | null;
  closed_reason: "user" | "admin" | "timeout" | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  message_count: number;
  /** 双方资料披露状态：hidden（默认隐藏）| pending（待平台审核）| approved（已披露）| rejected（已驳回） */
  parties_reveal_status: "hidden" | "pending" | "approved" | "rejected";
  parties_reveal_requested_by: string | null;
  parties_reveal_requested_at: string | null;
  parties_reveal_note: string | null;
  parties_revealed_at: string | null;
  parties_revealed_by: string | null;
}

export type TicketCategory = "amount" | "not_received" | "not_as_described" | "refund" | "other";

export interface TicketMessageRow {
  id: string;
  ticket_id: string;
  sender_id: string;
  /** user=订单双方自己发的消息，admin=平台客服在后台介入发的消息，system=平台系统提示（如披露审核结果） */
  sender_kind: "user" | "admin" | "system";
  body: string;
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
  /** 支付宝收款 PID（2088 开头），用于生成预填金额与备注的唤起链接；仅后台管理员可写 */
  pay_uid: string;
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
  /** 付款截图文件名（存放在数据目录的 payment-proofs 下，仅订单双方可读） */
  payment_proof: string | null;
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

export type AnnouncementLevel = "info" | "important" | "warning";

export interface AnnouncementRow {
  id: string;
  title: string;
  content: string;
  level: AnnouncementLevel;
  starts_at: string;
  ends_at: string;
  published_at: string | null;
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
  /** 工单消息邮件通知，1 表示开启 */
  ticket: number;
  /** 平台公告邮件通知，1 表示开启 */
  announcement: number;
  /** 个人信息修改邮件通知，1 表示开启 */
  profile: number;
  /** 支付密码修改/重置邮件通知，1 表示开启 */
  password: number;
  /** 登录提醒邮件通知，1 表示开启 */
  login: number;
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
  notificationSettings: {
    newOrder: boolean;
    paid: boolean;
    settled: boolean;
    /** 工单消息邮件通知 */
    ticket: boolean;
    /** 平台公告邮件通知 */
    announcement: boolean;
    /** 个人信息修改邮件通知 */
    profile: boolean;
    /** 支付密码修改/重置邮件通知 */
    password: boolean;
    /** 登录提醒邮件通知 */
    login: boolean;
  };
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

/**
 * 请求来源 IP（用于审计/风控日志）。
 *
 * 只信任 express 依据 `TRUST_PROXY` 解析后的 `req.ip`：直接信任
 * `X-Forwarded-For` 首段会让客户端随意伪造审计 IP（反代只会追加到末尾，
 * 首段仍是攻击者自己写的）。
 */
export function requestIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function isCampuxConfigured(): boolean {
  return Boolean(config.campux.clientId && config.campux.clientSecret);
}

export function findUserById(id: string): UserRow | undefined {
  return queryOne<UserRow>("SELECT * FROM users WHERE id = ?", id);
}
