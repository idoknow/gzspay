#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gzspay 品牌图形资产生成器。

设计稿（2026-10-31）规格：
  - 图标：蓝色圆角方块（120×120，rx=30，#1E6BFF）+ 白色 g（黄色硬币 #FFC933 描白边）+ 白色 g 尾巴；
  - 字标：gzs（#0B1B4D）+ pay（#1E6BFF），Nunito 800，负字距；
  - 副标：CAMPUS PAYMENT，Nunito 800，大写，宽字距，色 #4A5A8C；
  - 色板：#1E6BFF 品牌蓝、#FFC933 暖黄、#0B1B4D 深海军蓝、#FFFFFF、#F2F7FF 浅蓝底、#4A5A8C 灰蓝。

输入：web/public/fonts/nunito-latin.woff2（Nunito 可变字体，ASCII 子集，OFL 1.1）
输出：
  web/public/logo.svg                        图标（透明圆角底）
  web/public/logo-lockup.svg                 横版组合（图标 + 字标 + 副标）
  web/public/splash.svg                      开屏矢量图（390×844）
  web/public/og.png                          社交分享图（1200×630）
  web/public/icons/icon-180.png              iOS 主屏图标（满版蓝底）
  web/public/icons/icon-192.png              PWA 图标（圆角透明底）
  web/public/icons/icon-512.png              PWA 图标（圆角透明底）
  web/public/icons/icon-maskable-512.png     PWA maskable 图标（满版蓝底 + 安全区）
  web/public/splash/*.png                    iOS 启动图（竖屏，按设备尺寸）

用法（需要 Python 3.10+、Pillow、fontTools、brotli）：
    python scripts/brand/generate-assets.py

脚本只用于重新生成静态资产，运行时不依赖 Python。所有尺寸均为按比例计算，
调整比例常量后重跑即可得到一致的结果。
"""

from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "web" / "public"
FONT_WOFF2 = PUBLIC / "fonts" / "nunito-latin.woff2"
FONT_TTF = Path(tempfile.gettempdir()) / "gzspay-nunito-800.ttf"
CJK_FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/PingFang.ttc",
]

# ---------- 设计常量（图标坐标系 120×120） ----------
VIEW = 120.0
BLUE = "#1E6BFF"
YELLOW = "#FFC933"
NAVY = "#0B1B4D"
WHITE = "#FFFFFF"
TINT = "#F2F7FF"
MUTED = "#4A5A8C"

ICON_RADIUS = 30.0
COIN = {"cx": 60.0, "cy": 50.0, "r": 19.0, "stroke": 11.0}
TAIL = {"start": (79.0, 50.0), "v_end": (79.0, 74.0), "arc": 16.0, "h_end": (49.0, 90.0)}

WORDMARK_TRACKING = -0.02  # 相对字号
TAGLINE = "CAMPUS PAYMENT"
TAGLINE_TRACKING = 0.38  # 相对字号
CJK_TEXT = "桂中校园收付款"

SURFACE_BG = (242, 247, 255, 255)  # #F2F7FF
WHITE_RGBA = (255, 255, 255, 255)
BLUE_RGB = (30, 107, 255)
YELLOW_RGB = (255, 201, 51)
NAVY_RGB = (11, 27, 77)
MUTED_RGB = (74, 90, 140)


def log(message: str) -> None:
    print(f"[brand] {message}")


# ---------- 字体 ----------
def prepare_font() -> tuple[TTFont, Path]:
    """把 woff2 可变字体实例化为 800 静态字体，供 Pillow 与矢量路径使用。"""
    if not FONT_WOFF2.exists():
        raise SystemExit(f"缺少字体文件：{FONT_WOFF2}")
    font = TTFont(FONT_WOFF2)
    if "fvar" in font:
        instantiateVariableFont(font, {"wght": 800}, inplace=True)
    font.flavor = None
    font.save(FONT_TTF)
    log(f"字体就绪：{FONT_TTF.name}（{len(font.getBestCmap())} 个字符映射）")
    return font, FONT_TTF


def cjk_font_path() -> str | None:
    for candidate in CJK_FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return None


def pill_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_TTF), size)


def pill_cjk_font(size: int) -> ImageFont.FreeTypeFont | None:
    path = cjk_font_path()
    return ImageFont.truetype(path, size) if path else None


# ---------- 矢量字标（把 Nunito 字形转成 SVG path，避免外部字体依赖） ----------
def layout_glyphs(font: TTFont, text: str, size: float, tracking: float) -> tuple[list[tuple[str, float, float]], float]:
    """返回 [(字形路径, 起点 x, 终点 x)] 与总宽度。路径坐标以字标基线为 y=0、y 向下。"""
    upm = font["head"].unitsPerEm
    scale = size / upm
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    items: list[tuple[str, float, float]] = []
    x = 0.0
    for ch in text:
        glyph = glyph_set[cmap[ord(ch)]]
        pen = SVGPathPen(glyph_set)
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        items.append((pen.getCommands(), x, x + glyph.width * scale))
        x += glyph.width * scale + tracking
    total = x - tracking if text else 0.0
    return items, total


def wordmark_parts(font: TTFont, size: float, tracking: float) -> list[tuple[str, float, float, str]]:
    """把 gzspay 拆成 gzs / pay 两段，返回 [(路径, 起点x, 终点x, 颜色)]。"""
    items, _ = layout_glyphs(font, "gzspay", size, tracking)
    groups = [("gzs", NAVY), ("pay", BLUE)]
    result: list[tuple[str, float, float, str]] = []
    index = 0
    for text, color in groups:
        chunk = items[index : index + len(text)]
        d = " ".join(item[0] for item in chunk if item[0])
        start = chunk[0][1] if chunk else 0.0
        end = chunk[-1][2] if chunk else 0.0
        result.append((d, start, end, color))
        index += len(text)
    return result


def wordmark_width(font: TTFont, size: float, tracking: float) -> float:
    _, total = layout_glyphs(font, "gzspay", size, tracking)
    return total


def tracked_text_width(font: TTFont, text: str, size: float, tracking: float) -> float:
    _, total = layout_glyphs(font, text, size, tracking)
    return total


# ---------- SVG 输出 ----------
def svg_mark(fill: str = BLUE, coin: str = YELLOW) -> str:
    cx = COIN["cx"]
    cy = COIN["cy"]
    r = COIN["r"]
    sw = COIN["stroke"]
    start = TAIL["start"]
    v_end = TAIL["v_end"]
    arc = TAIL["arc"]
    h_end = TAIL["h_end"]
    return (
        f'<rect width="120" height="120" rx="{ICON_RADIUS:g}" fill="{fill}"/>\n'
        f'    <g fill="none" stroke="{WHITE}" stroke-width="{sw:g}" stroke-linecap="round">\n'
        f'      <circle cx="{cx:g}" cy="{cy:g}" r="{r:g}" fill="{coin}"/>\n'
        f'      <path d="M{start[0]:g} {start[1]:g}V{v_end[1]:g}'
        f'a{arc:g} {arc:g} 0 0 1 -{arc:g} {arc:g}H{h_end[0]:g}"/>\n'
        f"    </g>"
    )


def write_icon_svg(font: TTFont) -> None:
    content = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"'
        ' role="img" aria-label="gzspay">\n'
        f"  {svg_mark()}\n"
        "</svg>\n"
    )
    (PUBLIC / "logo.svg").write_text(content, encoding="utf-8")
    log("web/public/logo.svg")


def write_lockup_svg(font: TTFont) -> None:
    icon = 120.0
    gap = 24.0
    size = 88.0
    tracking = size * WORDMARK_TRACKING
    width = wordmark_width(font, size, tracking)
    tagline_size = 13.0
    tagline_tracking = tagline_size * TAGLINE_TRACKING
    tagline_width = tracked_text_width(font, TAGLINE, tagline_size, tagline_tracking)

    cap = size * 0.71
    baseline = icon / 2 + cap / 2
    tagline_baseline = baseline + 22.0
    total_width = icon + gap + max(width, tagline_width) + 8.0
    height = 132.0
    left = 4.0
    word_left = icon + gap

    parts = wordmark_parts(font, size, tracking)
    body = [f'  <g transform="translate(0 0)">{svg_mark()}</g>']
    for d, _start, _end, color in parts:
        body.append(
            f'  <g transform="translate({word_left:g} {baseline:g})">'
            f'<path d="{d}" fill="{color}"/></g>'
        )
    body.append(
        f'  <g transform="translate({word_left:g} {tagline_baseline:g})">'
        f'<path d="{" ".join(item[0] for item in layout_glyphs(font, TAGLINE, tagline_size, tagline_tracking)[0])}"'
        f' fill="{MUTED}"/></g>'
    )
    content = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_width:g} {height:g}"'
        f' width="{total_width:g}" height="{height:g}" role="img" aria-label="gzspay 桂中校园收付款">\n'
        + "\n".join(body)
        + "\n</svg>\n"
    )
    (PUBLIC / "logo-lockup.svg").write_text(content, encoding="utf-8")
    log("web/public/logo-lockup.svg")


def splash_geometry(width: float, height: float) -> dict[str, float]:
    """开屏页排版比例（SVG 与 PNG 共用）。"""
    icon = round(width * 0.30)
    word_size = icon * 0.70
    tagline_size = max(10.0, width * 0.028)
    tagline_tracking = tagline_size * TAGLINE_TRACKING
    cjk_size = max(11.0, width * 0.031)
    gap_icon_word = icon * 0.26
    cap = word_size * 0.71
    gap_word_tagline = word_size * 0.22
    block_height = icon + gap_icon_word + cap + gap_word_tagline + tagline_size
    icon_top = height * 0.46 - block_height / 2
    return {
        "width": width,
        "height": height,
        "icon": icon,
        "icon_top": icon_top,
        "icon_left": (width - icon) / 2,
        "word_size": word_size,
        "word_baseline": icon_top + icon + gap_icon_word + cap,
        "tagline_size": tagline_size,
        "tagline_tracking": tagline_tracking,
        "tagline_baseline": icon_top + icon + gap_icon_word + cap + gap_word_tagline + tagline_size * 0.74,
        "cjk_size": cjk_size,
        "cjk_baseline": height * 0.9,
        "cjk_width": 0.0,
    }


def write_splash_svg(font: TTFont) -> None:
    geometry = splash_geometry(390, 844)
    icon = geometry["icon"]
    scale = icon / VIEW
    word_size = geometry["word_size"]
    tracking = word_size * WORDMARK_TRACKING
    parts = wordmark_parts(font, word_size, tracking)
    word_width = wordmark_width(font, word_size, tracking)
    word_left = (geometry["width"] - word_width) / 2
    tagline = layout_glyphs(font, TAGLINE, geometry["tagline_size"], geometry["tagline_tracking"])[0]
    tagline_width = tracked_text_width(font, TAGLINE, geometry["tagline_size"], geometry["tagline_tracking"])
    tagline_left = (geometry["width"] - tagline_width) / 2

    body = [
        f'  <rect width="390" height="844" fill="{TINT}"/>',
        f'  <g transform="translate({geometry["icon_left"]:g} {geometry["icon_top"]:g}) scale({scale:g})">'
        f'<g transform="scale(1)">{svg_mark()}</g></g>',
    ]
    for d, _start, _end, color in parts:
        body.append(
            f'  <g transform="translate({word_left:g} {geometry["word_baseline"]:g})">'
            f'<path d="{d}" fill="{color}"/></g>'
        )
    body.append(
        f'  <g transform="translate({tagline_left:g} {geometry["tagline_baseline"]:g})">'
        f'<path d="{" ".join(item[0] for item in tagline)}" fill="{MUTED}"/></g>'
    )
    body.append(
        f'  <text x="195" y="{geometry["cjk_baseline"]:g}" text-anchor="middle"'
        f' font-family="PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif"'
        f' font-size="{geometry["cjk_size"]:g}" fill="{MUTED}">{CJK_TEXT}</text>'
    )
    content = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 844" width="390" height="844"'
        ' role="img" aria-label="gzspay 桂中校园收付款">\n' + "\n".join(body) + "\n</svg>\n"
    )
    (PUBLIC / "splash.svg").write_text(content, encoding="utf-8")
    log("web/public/splash.svg")


# ---------- PNG 绘制 ----------
def draw_mark(draw: ImageDraw.ImageDraw, size: float, *, rounded: bool, background: tuple[int, int, int] | None) -> None:
    """在 (size×size) 画布上绘制图标 mark；rounded=False 时铺满整块蓝底。"""
    scale = size / VIEW
    sw = int(round(COIN["stroke"] * scale))
    if background is not None:
        if rounded:
            draw.rounded_rectangle(
                [0, 0, size - 1, size - 1], radius=ICON_RADIUS * scale, fill=background
            )
        else:
            draw.rectangle([0, 0, size - 1, size - 1], fill=background)

    cx, cy, r = COIN["cx"] * scale, COIN["cy"] * scale, COIN["r"] * scale
    # 白色描边是画在半径上的：外沿 = r + stroke/2，内沿 = r - stroke/2
    outer = (COIN["r"] + COIN["stroke"] / 2) * scale
    inner = (COIN["r"] - COIN["stroke"] / 2) * scale
    draw.ellipse([cx - outer, cy - outer, cx + outer, cy + outer], fill=WHITE_RGBA)
    draw.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=YELLOW_RGB)

    start_x, start_y = TAIL["start"][0] * scale, TAIL["start"][1] * scale
    v_end_x, v_end_y = TAIL["v_end"][0] * scale, TAIL["v_end"][1] * scale
    arc = TAIL["arc"] * scale
    # 圆弧圆心 (63,74)，从 (79,74) 顺时针 90° 到 (63,90)
    arc_cx = (TAIL["v_end"][0] - TAIL["arc"]) * scale
    arc_cy = TAIL["v_end"][1] * scale
    h_end_x = TAIL["h_end"][0] * scale
    h_end_y = TAIL["h_end"][1] * scale
    half = sw / 2

    # 尾巴：沿中心线均匀盖圆点，得到与 SVG 圆头笔画一致的平滑描边
    centerline: list[tuple[float, float]] = []
    steps = max(8, int(round(24 * scale)))
    for index in range(steps + 1):
        ratio = index / steps
        centerline.append((start_x, start_y + (v_end_y - start_y) * ratio))
    arc_steps = max(8, int(round(arc / 2)))
    for index in range(arc_steps + 1):
        angle = math.radians(90 * index / arc_steps)
        centerline.append((arc_cx + arc * math.cos(angle), arc_cy + arc * math.sin(angle)))
    steps = max(8, int(round(arc / 2)))
    for index in range(steps + 1):
        ratio = index / steps
        centerline.append((arc_cx + (h_end_x - arc_cx) * ratio, h_end_y))
    for px, py in centerline:
        draw.ellipse([px - half, py - half, px + half, py + half], fill=WHITE_RGBA)


def render_icon(size: int, *, mode: str) -> Image.Image:
    """mode: rounded（透明圆角）/ flat（满版蓝底）/ maskable（满版 + 安全区）。"""
    supersample = 4
    canvas = Image.new("RGBA", (size * supersample, size * supersample), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    big = size * supersample
    if mode == "rounded":
        draw_mark(draw, big, rounded=True, background=BLUE_RGB + (255,))
    elif mode in ("flat", "maskable"):
        # 满版蓝底 + 图标缩到画布 70%/72%（iOS 自行裁圆角 / maskable 安全区）
        draw.rectangle([0, 0, big - 1, big - 1], fill=BLUE_RGB + (255,))
        glyph_scale = ((0.70 if mode == "flat" else 0.72) * big) / 70.0
        glyph = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        glyph_draw = ImageDraw.Draw(glyph)
        draw_mark(glyph_draw, VIEW * glyph_scale, rounded=False, background=None)
        # 图标坐标系中 mark 的视觉中心约为 (60, 60.5)
        offset_x = int(big / 2 - 60.0 * glyph_scale)
        offset_y = int(big / 2 - 60.5 * glyph_scale)
        canvas.alpha_composite(glyph, (offset_x, offset_y))
    else:
        raise ValueError(f"未知图标模式：{mode}")
    return canvas.resize((size, size), Image.LANCZOS)


def draw_tracked_text(
    image: Image.Image,
    text: str,
    font: ImageFont.FreeTypeFont,
    tracking: float,
    fill: tuple[int, int, int],
    baseline: float,
    center_x: float,
) -> float:
    """逐字绘制带字距的文本（以基线对齐）；返回总宽度。"""
    draw = ImageDraw.Draw(image)
    widths = [font.getlength(char) for char in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = center_x - total / 2
    for char, width in zip(text, widths):
        draw.text((x, baseline), char, font=font, fill=fill, anchor="ls")
        x += width + tracking
    return total


def draw_two_tone_wordmark(
    image: Image.Image, font: ImageFont.FreeTypeFont, size: float, center_x: float, baseline: float
) -> float:
    draw = ImageDraw.Draw(image)
    first = "gzs"
    second = "pay"
    width_first = font.getlength(first)
    width_second = font.getlength(second)
    total = width_first + width_second
    start = center_x - total / 2
    draw.text((start, baseline), first, font=font, fill=NAVY_RGB, anchor="ls")
    draw.text((start + width_first, baseline), second, font=font, fill=BLUE_RGB, anchor="ls")
    return total


def render_splash(width: int, height: int) -> Image.Image:
    geometry = splash_geometry(width, height)
    image = Image.new("RGB", (width, height), SURFACE_BG[:3])
    icon = int(geometry["icon"])
    icon_image = render_icon(icon, mode="rounded")
    image.paste(icon_image, (int(geometry["icon_left"]), int(geometry["icon_top"])), icon_image)

    word_size = int(round(geometry["word_size"]))
    word_font = pill_font(word_size)
    draw_two_tone_wordmark(image, word_font, word_size, width / 2, geometry["word_baseline"])

    tagline_size = max(8, int(round(geometry["tagline_size"])))
    tagline_font = pill_font(tagline_size)
    draw_tracked_text(
        image,
        TAGLINE,
        tagline_font,
        geometry["tagline_tracking"],
        MUTED_RGB,
        geometry["tagline_baseline"],
        width / 2,
    )

    cjk_font = pill_cjk_font(max(10, int(round(geometry["cjk_size"]))))
    if cjk_font is not None:
        draw = ImageDraw.Draw(image)
        draw.text((width / 2, geometry["cjk_baseline"]), CJK_TEXT, font=cjk_font, fill=MUTED_RGB, anchor="ms")
    return image


def render_og() -> Image.Image:
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), SURFACE_BG[:3])
    draw = ImageDraw.Draw(image)
    card = [80, 60, width - 80, height - 60]
    draw.rounded_rectangle(card, radius=44, fill=WHITE_RGBA)

    icon = 176
    icon_image = render_icon(icon, mode="rounded")
    icon_x = int((width - icon) / 2)
    icon_y = 108
    image.paste(icon_image, (icon_x, icon_y), icon_image)

    word_size = 112
    word_font = pill_font(word_size)
    word_baseline = icon_y + icon + 24 + int(word_size * 0.71)
    draw_two_tone_wordmark(image, word_font, word_size, width / 2, word_baseline)

    tagline_size = 18
    tagline_font = pill_font(tagline_size)
    draw_tracked_text(
        image,
        TAGLINE,
        tagline_font,
        tagline_size * TAGLINE_TRACKING,
        MUTED_RGB,
        word_baseline + 48,
        width / 2,
    )

    cjk_font = pill_cjk_font(28)
    if cjk_font is not None:
        draw.text((width / 2, word_baseline + 100), CJK_TEXT, font=cjk_font, fill=MUTED_RGB, anchor="ms")
    return image


IOS_SPLASH_SIZES = [
    ("iphone-1290x2796", 1290, 2796),
    ("iphone-1179x2556", 1179, 2556),
    ("iphone-1284x2778", 1284, 2778),
    ("iphone-1170x2532", 1170, 2532),
    ("iphone-1125x2436", 1125, 2436),
    ("iphone-828x1792", 828, 1792),
    ("iphone-1242x2688", 1242, 2688),
    ("iphone-750x1334", 750, 1334),
    ("ipad-2048x2732", 2048, 2732),
    ("ipad-1668x2388", 1668, 2388),
]


def write_pngs() -> None:
    icons_dir = PUBLIC / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    for name, size, mode in (
        ("icon-180.png", 180, "flat"),
        ("icon-192.png", 192, "rounded"),
        ("icon-512.png", 512, "rounded"),
        ("icon-maskable-512.png", 512, "maskable"),
    ):
        render_icon(size, mode=mode).save(icons_dir / name, "PNG", optimize=True)
        log(f"web/public/icons/{name}")

    splash_dir = PUBLIC / "splash"
    splash_dir.mkdir(parents=True, exist_ok=True)
    for name, width, height in IOS_SPLASH_SIZES:
        render_splash(width, height).save(splash_dir / f"{name}.png", "PNG", optimize=True)
        log(f"web/public/splash/{name}.png")

    render_og().save(PUBLIC / "og.png", "PNG", optimize=True)
    log("web/public/og.png")


def main() -> int:
    font, _ = prepare_font()
    write_icon_svg(font)
    write_lockup_svg(font)
    write_splash_svg(font)
    write_pngs()
    log("完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
