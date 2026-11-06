# gzspay

<img src="web/public/logo-lockup.svg" alt="gzspay" width="360" />

[![CI](https://github.com/idoknow/gzspay/actions/workflows/ci.yml/badge.svg)](https://github.com/idoknow/gzspay/actions/workflows/ci.yml)

面向校园场景的收付款网页应用：手机浏览器里完成扫码付款、转账与对账，管理后台负责账号、订单、商家与系统配置。

资金不经过 gzspay。钱仍然通过商家自己的支付宝、微信支付、QQ 钱包收款码流转，gzspay 只负责认人、下单、支付密码授权，以及付款后的备注核对与商家确认 —— 它更像一张「谁该付谁多少、付了没有」的账本。

## 能做什么

- **付款**：扫商家收款码或输入学号转账，用支付密码确认，订单状态一目了然。
- **收款**：商家维护自己的收款码与商品，生成固定金额的收款单，也可以给出临时动态码。
- **对账**：上传支付宝 / 微信账单，按「金额 + 备注」自动匹配订单并确认收款；也支持支付宝一键唤起自动填好金额和备注。
- **沟通**：每笔订单可以发起工单，双方在站内对话，需要时由平台客服介入；双方真实资料默认互相隐藏，向平台申请通过后才披露。
- **通知**：订单状态、工单、平台公告既可以站内提醒，也可以按个人设置发邮件。
- **公共设备**：在机房、教室的电脑上登录时可开启隐私模式，隐藏个人信息与设置，限时使用、退出需支付密码。
- **管理后台**：用户与商家审核、订单与工单处理、公告与邮件、地区限制、访问统计、错误告警、系统配置。

## 角色

| 角色 | 说明 |
| --- | --- |
| 同学（付款人） | 扫码付款、转账、查看订单与发起工单 |
| 商家 | 配置收款方式与商品、确认收款、查看与导出交易 |
| 平台管理员 | `super` / `ops` / `auditor` 三级：前两级可操作，`auditor` 只读 |

登录统一走校园墙 OAuth（不保存密码），支付相关操作再输入一次 6 位支付密码。

## 文档

| 文档 | 内容 |
| --- | --- |
| [DESIGN.md](./DESIGN.md) | 产品设计：页面、流程、状态机、权限与数据模型 |
| [docs/api.md](./docs/api.md) | 接口契约：请求 / 响应、错误码、DTO |
| [docs/deploy.md](./docs/deploy.md) | 部署：环境变量、容器、反向代理、备份升级 |
| [docs/security.md](./docs/security.md) | 安全边界、防护措施与上线检查清单 |
| [docs/brand.md](./docs/brand.md) | 品牌与图标规范 |
| [AGENTS.md](./AGENTS.md) | 本地开发、代码约定、提交规范 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本更新记录 |

## 技术栈

后端 Node.js（Express + TypeScript + SQLite），前端 React + Vite + Tailwind CSS，单仓 npm workspaces。

## 目录

```text
server/   后端服务（API、领域逻辑、SQLite、邮件、二维码）
web/      前端（手机端页面 + /admin 管理后台；品牌资产在 web/public）
docs/     接口契约、部署说明、安全说明、品牌规范
scripts/  开发启动、端到端冒烟、品牌资产生成
```

## 许可证

见 [LICENSE](./LICENSE)（GNU AGPL-3.0）。本项目由 **idoknow 组织** 维护，版权归 idoknow 组织所有。
