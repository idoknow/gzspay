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
```

## 安全边界

- gzspay 不接触资金，不接入任何支付机构资金接口。
- 支付密码校验失败 5 次锁定 30 分钟；锁定期间拒绝任何校验。
- 写接口需通过 CSRF 校验（SameSite Cookie + Origin 白名单）。
- 管理后台接口复用主站会话：账号必须在 `admins` 表内，写操作再按角色（`super`/`ops`/`auditor`）限制；没有独立的管理会话或二次验证。
- 系统未初始化（无管理员且未标记 `system.initialized`）时，除 `/api/health`、`/api/setup/*`、`/api/auth/*`、`/api/admin/auth/*` 外的接口必须返回 `503`。
