# gzspay 品牌规范

品牌形象来自设计稿：**蓝色圆角方块 + 白色 g + 暖黄硬币**，字标 `gzs`（深海军蓝）+ `pay`（品牌蓝），副标 `CAMPUS PAYMENT`。

## 色板

| 名称 | 色值 | 用途 |
| --- | --- | --- |
| 品牌蓝 | `#1E6BFF` | 图标底色、主按钮、`pay` 字标 |
| 暖黄 | `#FFC933` | 硬币、强调元素、徽标点缀 |
| 深海军蓝 | `#0B1B4D` | `gzs` 字标、深色文字 |
| 白色 | `#FFFFFF` | g 字形、卡片底色 |
| 浅蓝底 | `#F2F7FF` | 页面背景、浅色面板 |
| 辅助灰蓝 | `#4A5A8C` | 副标、说明文字 |

网页端对应 CSS 变量（`web/src/styles.css`）：

- `--brand: #1e6bff`、`--brand-strong: #1552d6`、`--brand-soft: #e8f0ff`
- `--accent: #ffc933`、`--accent-strong: #f0b21f`、`--accent-soft: #fff6d9`
- `--text: #0b1b4d`、`--muted: #4a5a8c`、`--bg: #f2f7ff`

管理后台有独立的 `.admin-root` 调色板（`web/src/admin/admin.css`），取同一组色值。

## 资产清单

| 文件 | 说明 |
| --- | --- |
| `web/public/logo.svg` | 图标（圆角透明底），用于 favicon、manifest 与后台品牌标记 |
| `web/public/logo-lockup.svg` | 横版组合：图标 + 两色字标 + 副标 |
| `web/public/splash.svg` | 竖版开屏图（矢量源，可整页预览） |
| `web/public/og.png` | 1200×630 分享卡片 |
| `web/public/icons/icon-180.png` | iOS 主屏幕图标（满版底色） |
| `web/public/icons/icon-192.png` | Android/PWA 图标 |
| `web/public/icons/icon-512.png` | PWA 大图标 |
| `web/public/icons/icon-maskable-512.png` | 自适应图标（内容在安全区内） |
| `web/public/splash/*.png` | iOS 添加到主屏幕启动图（10 种尺寸，媒体查询见 `web/index.html`） |
| `web/public/fonts/nunito-latin.woff2` | 字标字体 Nunito 800 的 ASCII 子集（OFL 许可，见同目录 `OFL.txt`） |

启动页的图标几何直接内联在 `web/src/components/Logo.tsx`（`LogoMark` / `Wordmark` / `Tagline`）与 `web/index.html` 的 `#boot-splash` 中，颜色走 CSS 变量，跟随浅色/深色主题。

## 图标几何

以 `viewBox="0 0 120 120"` 为基准：

- 底板：`<rect width="120" height="120" rx="30">`，填品牌蓝。
- g 字形：白色描边 11，圆头；硬币为圆心 `(60, 50)`、半径 19 的圆（白色描边 + 暖黄填充）；尾巴路径 `M79 50V74a16 16 0 0 1-16 16H49`。

字标与副标：

- 字标：Nunito 800，字距 `-0.02em`；`gzs` 深海军蓝，`pay` 品牌蓝。
- 副标：Nunito 800，字距 `0.38em`，全大写，颜色辅助灰蓝。

## 重新生成

品牌资产由脚本生成，修改设计参数后重跑即可（需要 Python 3 + Pillow，Pillow 用于位图；字体子集用 fonttools）：

```bash
python scripts/brand/generate-assets.py
```

脚本会：

1. 读取 `web/public/fonts/nunito-latin.woff2`（ASCII 子集可变字体），实例化 800 字重；
2. 输出 `logo.svg` / `logo-lockup.svg` / `splash.svg`（字形全部转为路径，不依赖外部字体）；
3. 用 Pillow 输出图标、iOS 启动图与 `og.png`。

字标字体子集可用 fonttools 重新裁剪：

```bash
pip install fonttools brotli
pyftsubset Nunito-var.woff2 --text="gzspayCAMPUSPAYMENT" --flavor=woff2 --output-file=web/public/fonts/nunito-latin.woff2
```

## 使用规范

- 图标最小显示尺寸 24px；小于 40px 时建议只使用图标，不排字标。
- 图标四周保持至少 `1/4` 边长的留白；不要拉伸、旋转或改变图标内部相对位置。
- 深浅背景下都用同一版图标；在深色界面上字标 `gzs` 用白色、`pay` 用亮蓝（网页端已由主题变量处理）。
- 不要把黄色硬币单独拆出作为按钮或图标，它只属于 g 字形。
- PWA 图标使用满版底色版本（iOS）与安全区版本（maskable），文字或其他元素不应进入 maskable 安全区外。
