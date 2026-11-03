# 部署说明

本文说明如何把 gzspay 部署到一台支持 HTTPS 的服务器上（校园墙 OAuth 要求回调地址为公网 HTTPS）。

## 1. 环境要求

- Node.js ≥ 22（生产使用 Node 22 LTS 或更新版本；`node:sqlite` 无需额外编译依赖）
- 反向代理（Nginx / Caddy）负责 HTTPS 与转发
- 一个公网可访问的域名，例如 `https://pay.example.com`

用容器部署时宿主机不需要安装 Node.js，只要有 Docker 24+（含 compose v2），见第 6 节。

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
| `CAMPUX_INTERNAL_BASE_URL` | 可选。服务端调用校园墙 token / userinfo / revoke 时使用的地址，留空则与 `CAMPUX_BASE_URL` 相同；容器或内网部署无法直连校园墙公网入口时填内网地址（如 `http://campux-admin.campux.svc.cluster.local:8989`），浏览器跳转仍走 `CAMPUX_BASE_URL` |
| `CAMPUX_CLIENT_ID` / `CAMPUX_CLIENT_SECRET` | 校园墙后台新建应用后获得（Secret 只放服务端） |
| `CAMPUX_TENANT_ID` | 可选，用于校验返回的用户属于校园墙 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | 发信配置；未配置时邮件写入 `mail_outbox` 表而不发送 |
| `DATABASE_PATH` | SQLite 文件路径，建议放在持久化目录 |
| `EMAIL_CODE_DEV_MODE` | 仅本地/冒烟使用（把邮箱验证码回显到接口响应）；**生产必须为 `0` 或不设置** |
| `TRUST_PROXY` | 反向代理层数。Nginx 反代时设为 `1`（默认值）；直接公网监听时设为 `false`，否则 `X-Forwarded-For` 可被伪造绕过限流 |
| `ALLOW_INSECURE_BASE_URL` | 仅内网无证书部署时设为 `1`，允许 `APP_BASE_URL` / `PUBLIC_BASE_URL` 使用 http；生产默认要求 https |
| `RATE_LIMIT_*` | 各接口每分钟限流阈值（登录 / 回调 / 下单 / 转账 / 扫卡 / 邮箱验证码 / 动态码），设为 `0` 关闭对应限流 |
| `ALERT_WEBHOOK_URL` | 可选：严重系统错误的 Webhook 推送地址（企业微信 / 钉钉 / 飞书群机器人），接收 JSON POST |
| `ALERT_EMAIL_ENABLED` | 是否通过邮件通知已绑定邮箱的管理员（默认 `1`，需要 SMTP 已配置） |
| `ALERT_THROTTLE_MINUTES` / `ALERT_MAX_PER_HOUR` | 同一类错误的告警合并窗口（默认 10 分钟）与每小时最多告警次数（默认 30） |
| `GEO_BLOCK_NON_CHINA` | 设为 `1` 后只允许中国大陆 IP 访问，境外请求返回 `403 REGION_BLOCKED`（默认 `0` 关闭） |
| `GEO_IP_WHITELIST` / `GEO_BYPASS_PATHS` | 白名单 IP / CIDR，以及始终放行的路径（默认含 `/api/health`） |
| `GEO_UNKNOWN_POLICY` / `GEO_TRUST_HEADER` | 归属未知时 `deny`（默认拦截）或 `allow`；CDN 回源国家码请求头（如 `CF-IPCountry`，确认回源可信才配） |

> 启动时会做安全自检：生产环境下若 `SESSION_SECRET` 仍是示例值、短于 32 字符，或站点地址不是 https（且未设置 `ALLOW_INSECURE_BASE_URL=1`），服务会打印原因后直接退出。完整安全说明见 [security.md](./security.md)。
>
> 严重系统错误（接口 5xx、进程未捕获异常、启动迁移失败、定时清理失败、邮件发送失败）会写入 `system_errors` 并主动告警：邮件发给有邮箱的管理员，同时推送到 `ALERT_WEBHOOK_URL`（若配置）。告警通道是否就绪可在后台「系统状态 → 严重错误告警」查看。
>
> 只对中国大陆开放时：先确认反向代理已把真实客户端 IP 传进来（`TRUST_PROXY=1`），再设置 `GEO_BLOCK_NON_CHINA=1`。IP 归属数据随仓库提供（`server/assets/cn-ip-ranges.json`），想更新时执行 `node scripts/geo/build-cn-ranges.mjs` 后重新构建；数据文件缺失时服务照常启动，但会打印告警并按 `GEO_UNKNOWN_POLICY` 处理。

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

  # 静态资源已由服务端输出 br/gzip（Content-Encoding），不要再开 gzip，
  # 否则会被二次压缩或协商冲突。若想交给 Nginx 压缩，请先关闭应用的预压缩产物。
  gzip off;
}
```

> 静态资源压缩在构建期完成（`scripts/compress-dist.mjs` 生成 `.br` / `.gz`，服务端按 `Accept-Encoding` 协商），首屏主包从约 377KB 降到约 101KB。部署后可用 `curl -sI -H 'Accept-Encoding: br' https://你的域名/assets/xxx.js | grep -i content-encoding` 确认。

## 6. Docker 部署

前后端可以打包成一个镜像运行，镜像由根目录的 `Dockerfile` 多阶段构建：

- 构建阶段：`npm ci` 安装全部依赖后执行 `npm run build`（后端 `tsc` + 前端 Vite）
- 运行阶段：只安装生产依赖，保留 `server/dist`、`server/assets`、`web/dist`，以非 root 的 `node` 用户运行并监听 3000

镜像内不包含 `.env`、数据库与源码；配置通过环境变量传入，数据放在 `/data` 卷里。

### 6.1 用 compose 启动（推荐）

```bash
cp .env.example .env      # 至少填 SESSION_SECRET 与 APP_BASE_URL / PUBLIC_BASE_URL
docker compose up -d --build
docker compose logs -f gzspay
```

- 数据（SQLite、上传文件、头像）都在命名卷 `gzspay-data` 的 `/data` 下，重建镜像不会丢
- 宿主机端口默认 3000，可用 `GZSPAY_PORT=8080 docker compose up -d` 覆盖（容器内始终是 3000）
- 首次打开 `http://<服务器地址>:3000/admin` 走初始化向导；容器健康检查走 `GET /api/health`

### 6.2 只用 docker 命令

```bash
docker build -t gzspay:latest .
docker run -d --name gzspay --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v gzspay-data:/data \
  gzspay:latest
```

`DATABASE_PATH`、`UPLOAD_DIR`、`AVATAR_DIR`、`WEB_DIST_DIR` 在镜像里已经指向 `/data` 与 `/app/web/dist`，一般不需要再改；如果要换路径，记得同步调整卷挂载。

### 6.3 使用 CI 构建的镜像

推送到 `main` 分支或打 `v*` 标签时，GitHub Actions 会校验代码并把镜像推送到 GHCR（见 `.github/workflows/ci.yml`）：

```bash
docker pull ghcr.io/<owner>/<repo>:latest
docker run -d --name gzspay --restart unless-stopped \
  -p 3000:3000 --env-file .env -v gzspay-data:/data \
  ghcr.io/<owner>/<repo>:latest
```

公开仓库的镜像默认公开；私有仓库拉取前需要 `docker login ghcr.io`。

### 6.4 反向代理与 HTTPS

容器只监听 HTTP 3000，HTTPS 仍由 Nginx / Caddy 负责（见第 5 节）。反代到容器时注意：

- 保持 `TRUST_PROXY=1`，让真实客户端 IP 传进应用（限流、地区限制、审计都依赖它）
- SSE（`/api/events/stream`）需要 `proxy_buffering off` 与较长的 `proxy_read_timeout`
- 校园墙回调地址填 `https://<域名>/api/auth/callback`

### 6.5 升级与备份

```bash
docker compose pull && docker compose up -d          # 用 CI 镜像
# 或者本地重新构建
git pull && docker compose up -d --build
```

备份数据卷（SQLite 与上传文件都在 `/data`）：

```bash
docker run --rm -v gzspay-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/gzspay-data.tgz -C /data .
```

删除卷（`docker compose down -v`）会同时删除数据库与上传文件，操作前先备份。

## 7. 首次初始化与管理员

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

## 8. 备份与维护

- 备份：定期复制 SQLite 文件（`DATABASE_PATH`）与上传目录（`UPLOAD_DIR`，默认 `server/data/uploads`；容器部署时都在 `/data` 卷里，备份命令见 6.5）。
- 日志清理：服务每小时自动清理过期的会话、验证码、动态码、幂等记录，并删除 7 天前的接口指标。
- 监控：`GET /api/health` 返回服务与数据库状态；后台「系统状态」页展示邮件、校园墙、存储与错误告警。

## 9. 安全清单

- 全站 HTTPS；`SESSION_SECRET` 随机且妥善保管。
- 收款码只保存解码后的内容，展示时由服务端重新生成二维码。
- 支付密码使用 scrypt 慢哈希；错误 5 次锁定 30 分钟并邮件提醒。
- 学号、邮箱、卡号脱敏展示；管理员查看与修改敏感数据会写入审计日志。
- 写接口要求 `X-Requested-With: gzspay` 与同源校验（CSRF 防护）。
- 合规提示：个人收款码用于经营性收款可能触发支付宝/微信风控，请商家核对收款方信息。
