# gzspay

<img src="web/public/logo-lockup.svg" alt="gzspay" width="360" />

桂中校园收付款网页应用（手机浏览器 + 管理后台）。

资金不经过 gzspay：钱仍通过商家自己的支付宝、微信支付、QQ 钱包收款码转账；gzspay 负责认人、下单、支付密码授权与付款后的备注核对和商家确认。

完整设计见 [DESIGN.md](./DESIGN.md)，接口契约见 [docs/api.md](./docs/api.md)，品牌与图标规范见 [docs/brand.md](./docs/brand.md)。

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
# 至少填写 CAMPUX_CLIENT_ID / CAMPUX_CLIENT_SECRET / SESSION_SECRET
# 本地联调可打开 DEV_AUTH_ENABLED=1 使用开发登录

# 3. 开发模式（同时启动后端 3000 与前端 5173）
npm run dev

# 4. 打开 http://localhost:5173
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动前后端开发服务 |
| `npm run build` | 构建后端与前端 |
| `npm run typecheck` | 前后端类型检查 |
| `npm test` | 后端单元与集成测试 |
| `npm run smoke` | 端到端冒烟：先构建并启动后端，用 `E2E_BASE_URL` 指向该服务（建议使用全新数据库） |
| `npm start` | 运行构建产物（需先 `npm run build`） |

## 目录

```text
server/   后端服务（API、领域逻辑、SQLite、邮件、二维码）
web/      前端（手机端页面 + /admin 管理后台；品牌资产在 web/public）
docs/     接口契约、部署说明、品牌规范
scripts/  开发启动、端到端冒烟、品牌资产生成（scripts/brand）
```

## 环境变量

见 [.env.example](./.env.example)。生产环境必须配置真实的校园墙 OAuth 凭据、SMTP 与 HTTPS。

## 提交规范

提交信息统一使用中文，遵循 Conventional Commits（`feat:`/`fix:`/`docs:`/`test:`/`chore:`/`refactor:`），每完成一个功能提交一次，并同步更新 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

见 [LICENSE](./LICENSE)。
