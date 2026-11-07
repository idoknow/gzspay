"""生成安卓启动图标（与 web/public/logo.svg 一致的品牌图形）。

蓝色圆角方块 + 白色 'g' 环与钩 + 琥珀色圆点；同时产出 adaptive icon 的前景矢量。
运行：python gen_icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parent / "app" / "src" / "main" / "res"
BLUE = (30, 107, 255, 255)
AMBER = (255, 201, 51, 255)
WHITE = (255, 255, 255, 255)
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def draw_brand(size: int, *, rounded: bool, bg: bool = True) -> Image.Image:
    """按 120x120 设计稿坐标绘制，再按比例放大到 size。"""
    scale = size / 120.0
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if bg:
        if rounded:
            draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(30 * scale), fill=BLUE)
        else:
            draw.ellipse([0, 0, size - 1, size - 1], fill=BLUE)

    stroke = max(2, int(round(11 * scale)))
    ring = [int(round(41 * scale)), int(round(31 * scale)), int(round(79 * scale)), int(round(69 * scale))]
    draw.ellipse(ring, fill=AMBER, outline=WHITE, width=stroke)

    # 钩：从圆环右侧竖直向下，再向左收尾；端点与拐点补小圆点模拟圆头描边
    right_x = 79 * scale
    draw.line(
        [(right_x, 50 * scale), (right_x, 74 * scale)],
        fill=WHITE,
        width=stroke,
    )
    draw.arc(
        [int(47 * scale), int(58 * scale), int(79 * scale), int(90 * scale)],
        start=0,
        end=90,
        fill=WHITE,
        width=stroke,
    )
    draw.line(
        [(63 * scale, 90 * scale), (49 * scale, 90 * scale)],
        fill=WHITE,
        width=stroke,
    )
    knob = stroke / 2.0
    for cx, cy in ((79, 50), (79, 74), (63, 90), (49, 90)):
        draw.ellipse(
            [
                cx * scale - knob,
                cy * scale - knob,
                cx * scale + knob,
                cy * scale + knob,
            ],
            fill=WHITE,
        )
    return image


def write_pngs() -> None:
    for density, size in DENSITIES.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        draw_brand(size, rounded=True).save(folder / "ic_launcher.png")
        draw_brand(size, rounded=False).save(folder / "ic_launcher_round.png")
        print("png", folder.name, size)


ADAPTIVE_ICON = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
"""

FOREGROUND = """<?xml version="1.0" encoding="utf-8"?>
<!-- 108dp 画布，品牌图形按 120 设计稿等比缩放到中间的安全区 -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:scaleX="0.72"
        android:scaleY="0.72"
        android:translateX="10.8"
        android:translateY="10.8">
        <path
            android:fillColor="#FFC933"
            android:pathData="M41,50 a19,19 0 1,0 38,0 a19,19 0 1,0 -38,0"
            android:strokeColor="#FFFFFF"
            android:strokeWidth="11" />
        <path
            android:fillColor="#00000000"
            android:pathData="M79,50 V74 A16,16 0 0 1 63,90 H49"
            android:strokeColor="#FFFFFF"
            android:strokeWidth="11"
            android:strokeLineCap="round" />
    </group>
</vector>
"""

COLORS = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#1E6BFF</color>
</resources>
"""


def write_xml() -> None:
    anydpi = RES / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(ADAPTIVE_ICON, encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(ADAPTIVE_ICON, encoding="utf-8")
    (RES / "drawable" / "ic_launcher_foreground.xml").write_text(FOREGROUND, encoding="utf-8")
    (RES / "values" / "colors.xml").write_text(COLORS, encoding="utf-8")
    legacy = RES / "drawable" / "ic_launcher.xml"
    if legacy.exists():
        legacy.unlink()
    print("xml done")


if __name__ == "__main__":
    write_pngs()
    write_xml()
