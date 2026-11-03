-- gzspay 数据库结构（SQLite）
-- 时间统一为 ISO 8601 字符串（UTC）；金额统一为整数分。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- 账号主体：以校园墙 sub 作为唯一身份
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  campux_sub TEXT NOT NULL UNIQUE,
  qq TEXT,                                  -- 仅用于拉取头像，不展示、不写日志
  campux_username TEXT,
  surname TEXT,
  given_name TEXT,
  student_no TEXT UNIQUE,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  card_no TEXT UNIQUE,
  avatar_url TEXT,
  payment_pwd_hash TEXT,
  payment_fail_count INTEGER NOT NULL DEFAULT 0,
  payment_fail_window_start TEXT,
  payment_locked_until TEXT,
  onboard_step TEXT NOT NULL DEFAULT 'name', -- name|studentNo|email|card|password|done
  onboarded INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',      -- active|frozen
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_student_no ON users(student_no);
CREATE INDEX IF NOT EXISTS idx_users_card_no ON users(card_no);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- OAuth state + PKCE，10 分钟过期
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_to TEXT,
  purpose TEXT NOT NULL DEFAULT 'user',       -- user|admin
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- 服务端会话：库中只存令牌哈希
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                        -- sha256(token)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'user',          -- user|admin
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 邮箱验证码：哈希存储
CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,                      -- email_verify|email_change|password_reset|admin_2fa
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_codes_user_purpose ON email_codes(user_id, purpose);

-- 支付密码重置令牌
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,                        -- sha256(token)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

-- 支付密码重置的身份验证凭证：校园墙授权验证通过后签发，5 分钟有效、一次性
CREATE TABLE IF NOT EXISTS password_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,                       -- campux
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_verifications_user ON password_verifications(user_id, created_at);

-- 管理后台安全入口：未通过安全入口直接访问 /admin 的尝试记录
CREATE TABLE IF NOT EXISTS admin_entry_visits (
  id TEXT PRIMARY KEY,
  ip TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  query TEXT,
  user_agent TEXT,
  referer TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_entry_visits_created ON admin_entry_visits(created_at);

-- 访问统计：按「天 + 类型 + 名称」聚合的计数（只存聚合值，不存 IP / UA）
CREATE TABLE IF NOT EXISTS traffic_counters (
  day TEXT NOT NULL,                             -- 服务器本地时区日期 YYYY-MM-DD
  kind TEXT NOT NULL,                            -- route|status|device|browser|os|region|scan|security
  name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, kind, name)
);
CREATE INDEX IF NOT EXISTS idx_traffic_counters_kind ON traffic_counters(kind, day);
CREATE INDEX IF NOT EXISTS idx_traffic_counters_day ON traffic_counters(day);

-- 管理员
CREATE TABLE IF NOT EXISTS admins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'ops',           -- super|ops|auditor
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- 商家
CREATE TABLE IF NOT EXISTS merchants (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  note_requirement TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 商家收款方式（只保存解码后的收款码内容）
CREATE TABLE IF NOT EXISTS merchant_channels (
  merchant_id TEXT NOT NULL REFERENCES merchants(user_id) ON DELETE CASCADE,
  channel TEXT NOT NULL,                      -- alipay|wechat|qq
  qr_content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, channel)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant_id, sort_order);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL REFERENCES users(id),
  payer_id TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  title TEXT NOT NULL,
  items_json TEXT,
  reserved_note TEXT,
  actual_note TEXT,
  pay_channel TEXT,
  status TEXT NOT NULL,                       -- pending_payment|paid|completed|cancelled
  cancel_reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'payer',   -- payer|merchant
  merchant_name_snapshot TEXT NOT NULL,
  payer_name_snapshot TEXT NOT NULL,
  note_requirement_snapshot TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  flagged INTEGER NOT NULL DEFAULT 0,
  flag_reason TEXT,
  closed_by_admin_id TEXT,
  payment_proof TEXT                        -- 付款截图文件名（仅订单双方可读）
);
CREATE INDEX IF NOT EXISTS idx_orders_payer ON orders(payer_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT NOT NULL,                   -- payer|merchant|admin|system
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);

CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',        -- open|closed|flagged
  handled_by TEXT,
  handled_at TEXT,
  handling_note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status, created_at);

-- 下单幂等
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- 动态码（一次性令牌，只存哈希）
CREATE TABLE IF NOT EXISTS dynamic_codes (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

-- 客户展示动态码后，商家发起的收款请求
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES users(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  reserved_note TEXT,
  items_json TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending|accepted|rejected|expired
  order_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_requests_customer ON payment_requests(customer_id, status);

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  new_order INTEGER NOT NULL DEFAULT 1,
  paid INTEGER NOT NULL DEFAULT 1,
  settled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  published_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_window ON announcements(starts_at, ends_at);

-- 公告已读记录：删除记录即代表重新推送（用户会重新看到未读红点）
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id);

-- 只增不改的各类日志
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);

CREATE TABLE IF NOT EXISTS login_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  campux_sub TEXT,
  method TEXT,                                -- campux_user|campux_admin|dev
  result TEXT NOT NULL,                       -- success|fail
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_logs_created ON login_logs(created_at);

CREATE TABLE IF NOT EXISTS risk_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT NOT NULL,                         -- payment_password_failed|limit_exceeded|sensitive_view
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_logs_created ON risk_logs(created_at);

CREATE TABLE IF NOT EXISTS system_errors (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_system_errors_created ON system_errors(created_at);

-- 邮件发送记录（开发模式下也作为 outbox）
CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,                       -- sent|failed|skipped
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_created ON mail_outbox(created_at);

-- 接口耗时采样（用于管理后台系统状态）
CREATE TABLE IF NOT EXISTS request_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_metrics_created ON request_metrics(created_at);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
