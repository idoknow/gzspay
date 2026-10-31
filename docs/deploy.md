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

校园墙后台需登记两个回调地址：

- 用户端：`${PUBLIC_BASE_URL}/api/auth/callback`
- 管理端：`${PUBLIC_BASE_URL}/api/admin/auth/callback`

权限范围（scope）：`profile tenant`。

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

## 6. 首个管理员

管理员通过「校园墙 OAuth 登录 + 邮箱验证码二次验证」进入后台，其校园墙用户 ID（`sub`）必须在 `admins` 表中。首个管理员可先注册普通账号，再在服务器上执行：

```bash
node -e "import('node:sqlite').then(({DatabaseSync})=>{const db=new DatabaseSync(process.argv[1]);const u=db.prepare('SELECT id FROM users WHERE campux_sub=?').get(process.argv[2]);if(!u)throw new Error('用户不存在');db.prepare(\"INSERT OR REPLACE INTO admins (user_id, role, created_by, created_at) VALUES (?, 'super', NULL, ?)\").run(u.id,new Date().toISOString());console.log('已添加超级管理员',u.id)})" "$DATABASE_PATH" "$CAMPUX_SUB"
```

之后即可在后台「管理员管理」中添加其他管理员。

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
