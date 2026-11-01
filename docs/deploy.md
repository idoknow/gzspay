# 部署说明

本文说明如何把 gzspay 部署到一台支持 HTTPS 的服务器上（校园墙 OAuth 要求回调地址为公网 HTTPS）。

## 1. 环境要求

- Node.js ≥ 22（生产使用 Node 22 LTS 或更新版本；`node:sqlite` 无需额外编译依赖）
- 反向代理（Nginx / Caddy）负责 HTTPS 与转发
- 一个公网可访问的域名，例如 `https://pay.example.com`

## 2. 构建

```bash
npm ci
cp .env.example .env    # 按第 3 节填写
npm run build           # 构建后端 dist 与前端 web/dist
npm test                # 可选：运行接口测试
```

构建产物：

- `server/dist/`：后端 JS 与 `db/schema.sql`
- `web/dist/`：前端静态资源（生产环境由后端同源托管，含 Service Worker）

## 3. 环境变量

完整清单见 [.env.example](../.env.example)，生产必须配置：

| 变量 | 说明 |
| --- | --- |
| `APP_BASE_URL` / `PUBLIC_BASE_URL` | 站点对外地址，如 `https://pay.example.com`（用于 OAuth 回调与 CSRF 同源校验） |
| `SESSION_SECRET` | 会话哈希密钥，至少 32 位随机字符串，务必更换默认值 |
| `CAMPUX_BASE_URL` | 校园墙地址，如 `https://campux.example.com` |
| `CAMPUX_CLIENT_ID` / `CAMPUX_CLIENT_SECRET` | 校园墙后台新建应用后获得（Secret 只放服务端） |
| `CAMPUX_TENANT_ID` | 可选，用于校验返回的用户属于桂中校园墙 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | 发信配置；未配置时邮件写入 `mail_outbox` 表而不发送 |
| `DATABASE_PATH` | SQLite 文件路径，建议放在持久化目录 |
| `EMAIL_CODE_DEV_MODE` | 仅本地/冒烟使用（把邮箱验证码回显到接口响应）；**生产必须为 `0` 或不设置** |
| `TRUST_PROXY` | 反向代理层数。Nginx 反代时设为 `1`（默认值）；直接公网监听时设为 `false`，否则 `X-Forwarded-For` 可被伪造绕过限流 |
| `ALLOW_INSECURE_BASE_URL` | 仅内网无证书部署时设为 `1`，允许 `APP_BASE_URL` / `PUBLIC_BASE_URL` 使用 http；生产默认要求 https |
| `RATE_LIMIT_*` | 各接口每分钟限流阈值（登录 / 回调 / 下单 / 转账 / 扫卡 / 邮箱验证码 / 动态码），设为 `0` 关闭对应限流 |
| `ALERT_WEBHOOK_URL` | 可选：严重系统错误的 Webhook 推送地址（企业微信 / 钉钉 / 飞书群机器人），接收 JSON POST |
| `ALERT_EMAIL_ENABLED` | 是否通过邮件通知已绑定邮箱的管理员（默认 `1`，需要 SMTP 已配置） |
| `ALERT_THROTTLE_MINUTES` / `ALERT_MAX_PER_HOUR` | 同一类错误的告警合并窗口（默认 10 分钟）与每小时最多告警次数（默认 30） |

> 启动时会做安全自检：生产环境下若 `SESSION_SECRET` 仍是示例值、短于 32 字符，或站点地址不是 https（且未设置 `ALLOW_INSECURE_BASE_URL=1`），服务会打印原因后直接退出。完整安全说明见 [security.md](./security.md)。
>
> 严重系统错误（接口 5xx、进程未捕获异常、启动迁移失败、定时清理失败、邮件发送失败）会写入 `system_errors` 并主动告警：邮件发给有邮箱的管理员，同时推送到 `ALERT_WEBHOOK_URL`（若配置）。告警通道是否就绪可在后台「系统状态 → 严重错误告警」查看。

校园墙后台只需登记一个回调地址：

- `${PUBLIC_BASE_URL}/api/auth/callback`（用户端与管理后台共用这一条）

权限范围（scope）：`profile`（若之后在应用里勾选 tenant，可改成 `profile tenant`）。

> 校园墙地址、Client ID / Secret、发件配置与站点信息也可以在首次打开 `/admin` 时的初始化向导里填写，会覆盖 `.env` 的对应值并存进数据库。

## 4. 启动

```bash
NODE_ENV=production node server/dist/index.js
```

首次启动会自动执行建表与迁移（`server/dist/db/schema.sql`），并加载数据库中保存的后台配置。

建议用 systemd 守护：

```ini
[Unit]
Description=gzspay
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/gzspay
EnvironmentFile=/srv/gzspay/.env
ExecStart=/usr/bin/node /srv/gzspay/server/dist/index.js
Restart=always
RestartSec=3s

[Install]
WantedBy=multi-user.target
```

## 5. 反向代理（Nginx 示例）

```nginx
server {
  listen 443 ssl http2;
  server_name pay.example.com;

  ssl_certificate     /etc/letsencrypt/live/pay.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/pay.example.com/privkey.pem;

  client_max_body_size 6m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE 实时推送（收款请求、订单状态）
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }
}
```

## 6. 首次初始化与管理员

部署完成后的第一次打开：

1. 访问 `https://<域名>/admin`，进入初始化向导（四步：校园墙 → 发件 → 站点信息 → 完成）。此时除初始化相关接口外，全站接口返回 `503 SYSTEM_NOT_INITIALIZED`，主站会显示「系统尚未初始化」提示页。
2. 配置好校园墙登录与发件配置后，用校园墙账号登录 —— **第一个登录的账号会自动成为超级管理员**，并被标记为系统初始化完成。
3. 之后在后台「管理员管理」中添加其他管理员。

管理员名单存在 `admins` 表，**复用主站登录会话**（没有独立的 OAuth、邮箱二次验证或 `gzs_admin` Cookie）；账号不在名单内时后台显示「账号不在管理员名单内」。命令行也可以直接授权/撤销（适合脚本化部署或找回权限）：

```bash
npm run admin:grant -- --list                                  # 查看现有管理员与最近登录过的账号
npm run admin:grant -- --sub <校园墙 sub> --role super         # 授予超级管理员
npm run admin:grant -- --email <邮箱> --role ops               # 也可以按邮箱 / QQ 号 / 用户 id 授权
npm run admin:grant -- --sub <sub> --revoke                    # 撤销
```

角色：`super`（全部权限，可改系统配置）、`ops`（运营，不能改系统配置）、`auditor`（只读审计）。脚本默认读取 `.env` 里的 `DATABASE_PATH`（相对路径按 `server/` 解析），也可用 `--db <路径>` 指定。手工授权过管理员的旧库无需再走初始化向导（`admins` 表非空即视为已初始化）。

## 7. 备份与维护

- 备份：定期复制 SQLite 文件（`DATABASE_PATH`）与上传目录（`UPLOAD_DIR`，默认 `server/data/uploads`）。
- 日志清理：服务每小时自动清理过期的会话、验证码、动态码、幂等记录，并删除 7 天前的接口指标。
- 监控：`GET /api/health` 返回服务与数据库状态；后台「系统状态」页展示邮件、校园墙、存储与错误告警。

## 8. 安全清单

- 全站 HTTPS；`SESSION_SECRET` 随机且妥善保管。
- 收款码只保存解码后的内容，展示时由服务端重新生成二维码。
- 支付密码使用 scrypt 慢哈希；错误 5 次锁定 30 分钟并邮件提醒。
- 学号、邮箱、卡号脱敏展示；管理员查看与修改敏感数据会写入审计日志。
- 写接口要求 `X-Requested-With: gzspay` 与同源校验（CSRF 防护）。
- 合规提示：个人收款码用于经营性收款可能触发支付宝/微信风控，请商家核对收款方信息。
