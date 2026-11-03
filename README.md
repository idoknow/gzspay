# gzspay

<img src="web/public/logo-lockup.svg" alt="gzspay" width="360" />

校园收付款网页应用（手机浏览器 + 管理后台）。

资金不经过 gzspay：钱仍通过商家自己的支付宝、微信支付、QQ 钱包收款码转账；gzspay 负责认人、下单、支付密码授权与付款后的备注核对和商家确认。

完整设计见 [DESIGN.md](./DESIGN.md)，接口契约见 [docs/api.md](./docs/api.md)，品牌与图标规范见 [docs/brand.md](./docs/brand.md)，安全防护与上线检查清单见 [docs/security.md](./docs/security.md)。

[![CI](https://github.com/idoknow/gzspay/actions/workflows/ci.yml/badge.svg)](https://github.com/idoknow/gzspay/actions/workflows/ci.yml)

## 技术栈

- 后端：Node.js ≥ 22、Express 5、TypeScript、SQLite（`node:sqlite`）
- 前端：React 19、Vite 7、TypeScript、Tailwind CSS v4
- 测试：Vitest + Supertest

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量
cp .env.example .env
# 至少填写 SESSION_SECRET；校园墙与发件配置可以在首次打开 /admin 的初始化向导里填写
# 本地/内网联调没配 SMTP 时，可打开 EMAIL_CODE_DEV_MODE=1 让验证码直接回显到接口响应

# 3. 开发模式（同时启动后端 3000 与前端 5173）
npm run dev

# 4. 打开 http://localhost:5173
# 5. 第一次使用打开 http://localhost:5173/admin 完成初始化向导（校园墙 → 发件 → 站点信息 → 完成）
#    第一个登录的账号会自动成为超级管理员
```

### 用 Docker 运行（整站容器化）

前后端会一起打包进一个镜像，宿主机只需要 Docker 24+（含 compose v2），不需要安装 Node.js：

```bash
cp .env.example .env                 # 至少填 SESSION_SECRET、APP_BASE_URL / PUBLIC_BASE_URL
docker compose up -d --build
# 打开 http://<服务器地址>:3000/admin 完成初始化
```

- 数据（SQLite、上传文件、头像）保存在命名卷 `gzspay-data` 的 `/data` 下，升级镜像不会丢
- 宿主机端口可用 `GZSPAY_PORT=8080` 覆盖
- 推送到 `main` 或打 `v*` 标签时，GitHub Actions 会自动校验并推送镜像到 GHCR（`ghcr.io/idoknow/gzspay`）

完整的 Docker 部署、反向代理、备份与升级说明见 [docs/deploy.md](./docs/deploy.md) 第 6 节。

### 在局域网里预览（真机调试）

`npm run dev` 会把 Vite 监听在所有网卡上，启动日志里会打印 `Network: http://<本机局域网 IP>:5173/`，手机连同一个 Wi-Fi 直接打开该地址即可。

若用局域网地址访问，需要在 `.env` 里把域名同步过去，否则写请求会被 CSRF 来源校验拒绝：

```bash
APP_BASE_URL=http://192.168.1.10:5173
PUBLIC_BASE_URL=http://192.168.1.10:5173
# 想同时保留 localhost 访问时，把本地地址放进额外白名单
EXTRA_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

注意：

- Windows 首次运行需要在防火墙提示里允许 Node.js 入站，或手动放行 TCP 5173。
- 局域网访问走的是 HTTP，浏览器只把 `localhost`/HTTPS 视为安全上下文，**扫码（相机）功能在局域网 HTTP 下不可用**；真机测扫码需要用 HTTPS 反代或内网证书。
- 开发登录已移除：登录一律走校园墙 OAuth；本地联调可用 `EMAIL_CODE_DEV_MODE=1` 让邮箱验证码回显到接口响应（仅限本机/内网，公网或不可信 WiFi 下不要暴露）。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动前后端开发服务 |
| `npm run build` | 构建后端与前端 |
| `npm run typecheck` | 前后端类型检查 |
| `npm test` | 后端单元与集成测试 |
| `npm run check:changelog` | 校验 `CHANGELOG.md` 「未发布」小节是否随改动同步更新 |
| `npm run verify` | 提交前自检：类型检查 + 测试 + 更新日志校验 |
| `npm run hooks:install` | 安装本地 git 钩子，提交前自动校验更新日志 |
| `npm run admin:grant -- --list` | 查看管理员与最近账号；`-- --sub <校园墙 sub> --role super` 授予管理后台权限 |
| `npm run smoke` | 端到端冒烟：先构建并启动后端，用 `E2E_BASE_URL` 指向该服务（建议使用全新数据库） |
| `npm start` | 运行构建产物（需先 `npm run build`） |

## 目录

```text
server/   后端服务（API、领域逻辑、SQLite、邮件、二维码）
web/      前端（手机端页面 + /admin 管理后台；品牌资产在 web/public）
docs/     接口契约、部署说明、安全说明、品牌规范
scripts/  开发启动、端到端冒烟、品牌资产生成（scripts/brand）
```

## 环境变量

见 [.env.example](./.env.example)。生产环境必须配置真实的校园墙 OAuth 凭据、SMTP 与 HTTPS。

## 提交规范

提交信息统一使用中文，遵循 Conventional Commits（`feat:`/`fix:`/`docs:`/`test:`/`chore:`/`refactor:`），每完成一个功能提交一次，并同步更新 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

见 [LICENSE](./LICENSE)（GNU AGPL-3.0）。本项目由 **idoknow 组织** 维护，版权归 idoknow 组织所有。
