# gzspay 协作规范

本文件面向后续参与本仓库开发的协作者（含 AI 代理）。请先阅读 [DESIGN.md](./DESIGN.md) 与 [docs/api.md](./docs/api.md)。

## 技术约定

- Node.js ≥ 22，npm workspaces（`server`、`web` 两个包）。
- 后端 TypeScript ESM：相对导入必须带 `.js` 后缀（编译后路径），例如 `import { db } from "../db/index.js"`。
- 前端 TypeScript + React 19 函数组件，路由用 `react-router-dom`。
- 数据库使用 Node 内置 `node:sqlite` 的 `DatabaseSync`，不要引入 better-sqlite3 等原生依赖。
- 校验统一用 Zod，schema 放在 `server/src/lib/schemas.ts` 或路由文件顶部。
- 金额一律以「分」为单位的整数存取（`amountCents`），展示时再格式化为元。
- 时间统一存 ISO 8601 字符串（UTC），展示时按本地时区格式化。

## 本地开发

```bash
npm install
cp .env.example .env          # 至少填写 SESSION_SECRET
npm run dev                   # 后端 3000 + 前端 5173
```

打开 <http://localhost:5173>；第一次使用先打开 <http://localhost:5173/admin> 走初始化向导（校园墙 → 发件 → 站点信息 → 完成），第一个登录的账号会自动成为超级管理员。校园墙与发件配置也可以在向导里填写，会覆盖 `.env` 并存进数据库。

整站容器化、反向代理、备份与升级见 [docs/deploy.md](./docs/deploy.md)（第 6 节 Docker）。所有环境变量及其含义见 [docs/deploy.md](./docs/deploy.md) 第 3 节与 [.env.example](./.env.example)。

**局域网真机调试**：`npm run dev` 的 Vite 监听所有网卡，启动日志会打印 `Network: http://<本机 IP>:5173/`，手机连同一个 Wi-Fi 直接访问即可。用局域网地址访问时要把域名写进 `.env`，否则写请求会被 CSRF 来源校验拒绝：

```bash
APP_BASE_URL=http://192.168.1.10:5173
PUBLIC_BASE_URL=http://192.168.1.10:5173
EXTRA_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173   # 想同时保留 localhost 访问时
```

两个坑：Windows 首次运行需在防火墙提示里允许 Node.js 入站（或手动放行 TCP 5173）；局域网走 HTTP，浏览器不把非 `localhost` 的 HTTP 视为安全上下文，**扫码（相机）在局域网 HTTP 下不可用**，真机测扫码要用 HTTPS 反代或内网证书。

本地联调没有发件通道（Resend / SMTP）时，可以打开 `EMAIL_CODE_DEV_MODE=1` 让验证码回显到接口响应（仅限本机/内网，公网或不可信 WiFi 下不要开）。开发登录已移除，登录一律走校园墙 OAuth。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动前后端开发服务 |
| `npm run build` | 构建后端与前端 |
| `npm run typecheck` | 前后端类型检查 |
| `npm test` | 后端单元与集成测试 |
| `npm run verify` | 提交前自检：类型检查 + 测试 + 更新日志校验 |
| `npm run check:changelog` | 校验 `CHANGELOG.md`「未发布」小节是否随改动更新 |
| `npm run hooks:install` | 安装本地 git 钩子，提交前自动校验更新日志 |
| `npm run admin:grant -- --list` | 查看管理员与最近账号；`-- --sub <校园墙 sub> --role super` 授予后台权限 |
| `npm run smoke` | 端到端冒烟：构建并启动后端，用 `E2E_BASE_URL` 指向该服务（建议用全新数据库） |
| `npm start` | 运行构建产物（需先 `npm run build`） |

## 目录与写入边界

- `server/src/routes/*`：HTTP 路由，薄层，只做参数校验 + 调用 service。
- `server/src/services/*`：领域逻辑（订单状态机、支付密码、统计、通知），必须可单测。
- `server/src/lib/*`：基础设施（crypto、session、mail、qr、audit、rate-limit）。
- `web/src/pages/*`：手机端页面；`web/src/admin/*`：管理后台页面。
- `web/src/components/*`：可复用组件（内置键盘、倒计时弹窗、图表、扫码）。
- `web/src/lib/*`：API 客户端、格式化、hooks、主题。

新增文件请放在既有分类下，不要新建平行目录。

## 代码风格

- 中文注释与中文错误提示；面向用户的文案全部中文。
- 不使用 `any`（特殊情况用 `unknown` + 类型守卫）。
- 错误统一抛 `AppError`，由 `server/src/lib/errors.ts` 的错误中间件转成 JSON。
- 敏感信息（QQ 号、学号、邮箱、卡号、收款码内容、密码）禁止写日志。
- 支付密码只允许出现在请求体里，不落库、不回显；比较使用 `crypto.timingSafeEqual`。

## 提交规范

- 每个功能完成后提交一次，提交信息使用中文 Conventional Commits：
  - `feat: 校园墙 OAuth 登录`
  - `fix: 修复订单列表筛选状态错误`
  - `docs: 补充接口契约`
  - `test: 增加订单状态机测试`
  - `chore: 升级依赖`
- 提交前必须通过：`npm run typecheck`、`npm test`（涉及前端时再加 `npm run build`），或直接 `npm run verify`（类型检查 + 测试 + 更新日志校验）。
- **每次改动都要同步更新 `CHANGELOG.md` 的「未发布」小节**，按「新增 / 变更 / 修复」写清做了什么；同一功能的多笔提交可合并描述，但不要漏。忘记更新会被 `npm run check:changelog` 和提交前钩子拦下（钩子检查的是「本次提交是否真的新增了条目」）。
- 发版时把「未发布」标题改成 `## [版本号] - 日期`，并在最上方新建空的「未发布」小节（可为空，关于页会自动隐藏空版本），同时同步 `package.json`（根 / server / web）与 `DESIGN.md` 的版本号。
- 建议首次克隆后执行 `npm run hooks:install`，安装「提交前自动校验更新日志」的 git 钩子；紧急情况用 `GZSPAY_SKIP_CHANGELOG_CHECK=1 git commit ...` 跳过单次校验。

## 验证清单

```bash
npm run verify          # 类型检查 + 单元/集成测试 + 更新日志校验（提交前跑这个）
npm run typecheck       # 前后端类型检查
npm test                # 后端单测 + 集成测试
npm run check:changelog # 校验 CHANGELOG.md「未发布」小节
npm run build           # 生产构建
node scripts/smoke.mjs  # 冒烟：启动服务并跑关键接口
node scripts/bench-seed.mjs   # 可选：复制一份库并为测试账号写入会话（输出 cookie）
node scripts/bench.mjs        # 可选：并发压测关键只读接口，输出 req/s 与 p95
```

持续集成：`.github/workflows/ci.yml` 在 push / PR 上跑 `npm ci` + `npm run verify` + `npm run build`，并在 `main` 与 `v*` 标签构建 Docker 镜像推送到 GHCR；容器化部署见 [docs/deploy.md](./docs/deploy.md) 第 6 节（`Dockerfile` / `docker-compose.yml`，数据在 `/data` 卷）。

## 安全边界

- gzspay 不接触资金，不接入任何支付机构资金接口。完整措施与上线检查清单见 [docs/security.md](./docs/security.md)。
- 支付密码校验失败 5 次锁定 30 分钟；锁定期间拒绝任何校验。
- 写接口需通过 CSRF 校验（SameSite Cookie + Origin 白名单）。
- 敏感接口必须挂限流（`server/src/lib/rate-limit.ts`）：登录发起、OAuth 回调、下单、转账、扫卡、邮箱验证码、动态码；超限返回 `429 RATE_LIMITED` 并带 `Retry-After`。
- 商家收款码上传必须先按文件头校验 PNG/JPEG（`server/src/lib/image.ts`），不能只看 Content-Type 或扩展名；用户头像不直接下发 QQ 头像地址（会泄露 QQ 号），统一走服务端代理 `GET /api/avatar/:userId`。
- 生产环境启动会做配置自检（SESSION_SECRET 强度、https 站点地址），不合格直接退出；不要把示例密钥带上线。
- 管理后台接口复用主站会话：账号必须在 `admins` 表内，写操作再按角色（`super`/`ops`/`auditor`）限制；没有独立的管理会话或二次验证。
- 系统未初始化（无管理员且未标记 `system.initialized`）时，除 `/api/health`、`/api/setup/*`、`/api/auth/*`、`/api/admin/auth/*` 外的接口必须返回 `503`。
- 地区限制由 `server/src/lib/geo.ts` 的中间件实现：只放行中国大陆 IP，本机 / 内网地址、例外路径与 IP 白名单例外；开关与策略在管理后台「系统配置 → 地区访问限制」保存（`app_config`，`GEO_*` 环境变量仅作默认值）；IP 归属数据在 `server/assets/cn-ip-ranges.json`（`node scripts/geo/build-cn-ranges.mjs` 更新，零第三方依赖），不要在业务路由里另写一套 IP 判断。
- 管理后台安全入口由 `server/src/lib/admin-entry.ts` 的 `createAdminEntryGuard()` 实现：入口名存在 `app_config`（`admin.entryPath`），访问 `/<入口名>/admin` 后下发 8 小时 HMAC Cookie 并跳 `/admin`；无凭据直接访问 `/admin` 会被写入 `admin_entry_visits` 并返回 404。它只隐藏入口地址，不替代 `admins` 表与角色鉴权。
- 访问统计只能写聚合计数：新增埋点调用 `server/src/lib/traffic.ts` 的 `recordTraffic(kind, name)`，`traffic_counters` 表只保存 `(day, kind, name, count)`，**禁止把 IP、User-Agent、请求参数或个人数据写进统计**；安全拦截计数通过 `res.locals`（`regionBlocked`/`scannerBlocked`/`adminEntryProbe`/`csrfRejected`/`paymentPasswordWrong`/`paymentPasswordLocked`）交给统计中间件统一记，不要在拦截器里直接写库。统计只通过 `GET /api/admin/traffic` 提供给管理员。
- 新增可疑路径防护时加到 `server/src/lib/http.ts` 的 `SCANNER_PATHS` / `SCANNER_EXTENSIONS`，由 `scannerGuard` 统一返回 404，不要在业务路由里各写一份。
