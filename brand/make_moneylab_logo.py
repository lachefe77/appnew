#!/usr/bin/env python3
"""Generate official MoneyLab brand marks (SVG + PNG)."""

from __future__ import annotations

import math
from pathlib import Path

import cairosvg
from PIL import Image, ImageFont

FONT = "/usr/share/fonts/truetype/macos/Inter-SemiBold.ttf"

GOLD = "#D4AF37"
GOLD_SOFT = "#E6C65A"
INK = "#07070C"
HEX_FILL = "#0C0D12"
EMERALD = "#12B886"
WHITE = "#F4F4F7"
MUTED = "#C8C8D0"

ROOT = Path("/workspace/brand")
APP_ICONS = Path("/workspace/delay xit lifetime/assets/icons")


def hexagon_points(cx: float, cy: float, r: float) -> str:
    pts = []
    for i in range(6):
        a = math.radians(-90 + i * 60)
        pts.append(f"{cx + r * math.cos(a):.2f},{cy + r * math.sin(a):.2f}")
    return " ".join(pts)


def flask_and_chart(cx: float, cy: float, scale: float = 1.0, stroke: float = 10.0) -> str:
    """Line-art Erlenmeyer flask + rising candles, centered on (cx, cy)."""
    s = scale
    sw = stroke

    def x(v: float) -> float:
        return cx + v * s

    def y(v: float) -> float:
        return cy + v * s

    # Local coords around (0,0): compact flask, shorter neck
    lip_l, lip_r, lip_y = -24, 24, -92
    neck_l, neck_r, neck_top, neck_bot = -15, 15, -86, -38
    body_l, body_r, body_y, bot_y = -80, 80, 70, 108

    flask = (
        f"M {x(neck_l):.2f} {y(neck_top):.2f} "
        f"L {x(neck_l):.2f} {y(neck_bot):.2f} "
        f"L {x(body_l):.2f} {y(body_y):.2f} "
        f"Q {x(body_l - 8):.2f} {y(bot_y):.2f} {x(-36):.2f} {y(bot_y):.2f} "
        f"L {x(36):.2f} {y(bot_y):.2f} "
        f"Q {x(body_r + 8):.2f} {y(bot_y):.2f} {x(body_r):.2f} {y(body_y):.2f} "
        f"L {x(neck_r):.2f} {y(neck_bot):.2f} "
        f"L {x(neck_r):.2f} {y(neck_top):.2f}"
    )

    candles = []
    specs = [
        (-42, 24, 8),
        (-21, 38, 10),
        (0, 54, 12),
        (21, 70, 13),
        (42, 86, 14),
    ]
    base = 92
    cw = 8
    for cx_c, h, wick in specs:
        left = x(cx_c - cw / 2)
        top = y(base - h)
        candles.append(
            f'<rect x="{left:.2f}" y="{top:.2f}" width="{cw * s:.2f}" '
            f'height="{h * s:.2f}" rx="{1.6 * s:.2f}" fill="{EMERALD}"/>'
        )
        candles.append(
            f'<line x1="{x(cx_c):.2f}" y1="{y(base - h - wick):.2f}" '
            f'x2="{x(cx_c):.2f}" y2="{y(base + 6):.2f}" '
            f'stroke="{EMERALD}" stroke-width="{1.8 * s:.2f}" stroke-linecap="round"/>'
        )

    return f"""
  <path d="{flask}" fill="none" stroke="{GOLD}" stroke-width="{sw}"
        stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="{x(lip_l):.2f}" y1="{y(lip_y):.2f}" x2="{x(lip_r):.2f}" y2="{y(lip_y):.2f}"
        stroke="{GOLD}" stroke-width="{sw * 1.05:.2f}" stroke-linecap="round"/>
  <circle cx="{x(0):.2f}" cy="{y(-108):.2f}" r="{6.8 * s:.2f}" fill="{GOLD}"/>
  {''.join(candles)}
"""


def icon_svg(size: int = 512, background: str | None = INK, pad: float = 36) -> str:
    cx = cy = size / 2
    r = (size / 2) - pad
    bg = f'<rect width="{size}" height="{size}" fill="{background}"/>' if background else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  {bg}
  <polygon points="{hexagon_points(cx, cy, r)}" fill="{HEX_FILL}" stroke="{GOLD}"
           stroke-width="{size * 0.018:.2f}" stroke-linejoin="round"/>
  {flask_and_chart(cx, cy + size * 0.012, scale=size / 512 * 1.55, stroke=size * 0.018)}
</svg>
"""


def wordmark_svg(width: int = 1100, height: int = 320, background: str | None = INK) -> str:
    bg = f'<rect width="{width}" height="{height}" fill="{background}"/>' if background else ""
    icon_box = 220
    icon_x, icon_y = 48, (height - icon_box) / 2
    cx = icon_x + icon_box / 2
    cy = icon_y + icon_box / 2
    text_x = icon_x + icon_box + 28
    text_y = height / 2 + 34
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <style>
      @font-face {{
        font-family: 'InterBrand';
        src: url('file:///usr/share/fonts/truetype/macos/Inter-SemiBold.ttf') format('truetype');
        font-weight: 600;
      }}
    </style>
  </defs>
  {bg}
  <polygon points="{hexagon_points(cx, cy, icon_box / 2 - 6)}" fill="{HEX_FILL}" stroke="{GOLD}"
           stroke-width="6.2" stroke-linejoin="round"/>
  {flask_and_chart(cx, cy + 3, scale=0.68, stroke=6.0)}
  <text x="{text_x}" y="{text_y:.1f}" font-family="InterBrand, Inter, sans-serif"
        font-size="108" font-weight="600" letter-spacing="-2">
    <tspan fill="{WHITE}">Money</tspan><tspan fill="{GOLD}">Lab</tspan>
  </text>
</svg>
"""


def stacked_svg(width: int = 720, height: int = 780, background: str | None = INK) -> str:
    bg = f'<rect width="{width}" height="{height}" fill="{background}"/>' if background else ""
    cx, cy, r = width / 2, 300, 200
    font = ImageFont.truetype(FONT, 78)
    money_w = font.getlength("Money")
    lab_w = font.getlength("Lab")
    tracking = -2 * 8  # 8 glyphs
    total = money_w + lab_w + tracking
    x0 = cx - total / 2
    x1 = x0 + money_w + tracking * (5 / 8)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <style>
      @font-face {{
        font-family: 'InterBrand';
        src: url('file:///usr/share/fonts/truetype/macos/Inter-SemiBold.ttf') format('truetype');
        font-weight: 600;
      }}
    </style>
  </defs>
  {bg}
  <polygon points="{hexagon_points(cx, cy, r)}" fill="{HEX_FILL}" stroke="{GOLD}"
           stroke-width="8" stroke-linejoin="round"/>
  {flask_and_chart(cx, cy + 4, scale=1.48, stroke=8.0)}
  <text x="{x0:.1f}" y="600" font-family="InterBrand, Inter, sans-serif"
        font-size="78" font-weight="600" letter-spacing="-2" fill="{WHITE}">Money</text>
  <text x="{x1:.1f}" y="600" font-family="InterBrand, Inter, sans-serif"
        font-size="78" font-weight="600" letter-spacing="-2" fill="{GOLD}">Lab</text>
</svg>
"""


def small_icon_svg(size: int = 128, background: str | None = INK) -> str:
    """Bolder mark for 16/32/48px toolbars."""
    cx = cy = size / 2
    r = size * 0.42
    sw = max(2.2, size * 0.07)
    bg = f'<rect width="{size}" height="{size}" fill="{background}"/>' if background else ""
    flask = flask_and_chart(cx, cy + size * 0.02, scale=size / 512 * 1.35, stroke=sw)
    # Drop the tiny bubble/candles readability issues by using thicker geometry only
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  {bg}
  <polygon points="{hexagon_points(cx, cy, r)}" fill="{HEX_FILL}" stroke="{GOLD}"
           stroke-width="{sw:.2f}" stroke-linejoin="round"/>
  {flask}
</svg>
"""


def write_svg(path: Path, svg: str) -> None:
    path.write_text(svg, encoding="utf-8")


def raster(svg: str, dest: Path, output_width: int | None = None, trim: bool = False) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(
        bytestring=svg.encode("utf-8"),
        write_to=str(dest),
        output_width=output_width,
        background_color=None,
    )
    if trim:
        im = Image.open(dest).convert("RGBA")
        bbox = im.getbbox()
        if bbox:
            pad = 36
            l, t, r, b = bbox
            l = max(0, l - pad)
            t = max(0, t - pad)
            r = min(im.width, r + pad)
            b = min(im.height, b + pad)
            im.crop((l, t, r, b)).save(dest)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    APP_ICONS.mkdir(parents=True, exist_ok=True)

    icon_dark = icon_svg(1024, INK)
    icon_clear = icon_svg(1024, None)
    icon_light = icon_svg(1024, "#F7F5EE")
    word_dark = wordmark_svg(1100, 320, INK)
    word_clear = wordmark_svg(1100, 320, None)
    stack_dark = stacked_svg(720, 780, INK)

    write_svg(ROOT / "moneylab-icon.svg", icon_dark)
    write_svg(ROOT / "moneylab-icon-transparent.svg", icon_clear)
    write_svg(ROOT / "moneylab-wordmark.svg", word_dark)
    write_svg(ROOT / "moneylab-wordmark-transparent.svg", word_clear)
    write_svg(ROOT / "moneylab-stacked.svg", stack_dark)

    raster(icon_dark, ROOT / "moneylab-icon.png", 1024)
    raster(icon_clear, ROOT / "moneylab-icon-transparent.png", 1024)
    raster(icon_light, ROOT / "moneylab-icon-light.png", 1024)
    raster(word_clear, ROOT / "moneylab-wordmark-transparent.png", 1100, trim=True)
    clear = Image.open(ROOT / "moneylab-wordmark-transparent.png").convert("RGBA")
    dark_wm = Image.new("RGBA", clear.size, INK + "FF")
    dark_wm.alpha_composite(clear)
    dark_wm.save(ROOT / "moneylab-wordmark.png")
    raster(stack_dark, ROOT / "moneylab-stacked.png", 720)

    # Extension icons — bold strokes under 64px
    for size in (16, 32, 48):
        raster(small_icon_svg(size * 8, INK), APP_ICONS / f"icon-{size}.png", size)
    for size in (128, 512):
        raster(icon_dark, APP_ICONS / f"icon-{size}.png", size)
    raster(icon_dark, APP_ICONS / "icon.png", 512)
    raster(word_clear, APP_ICONS / "wordmark.png", 640)

    # Sanity: files exist and are non-empty
    for p in sorted(ROOT.glob("*")) + sorted(APP_ICONS.glob("icon*.png")):
        print(f"{p.stat().st_size:8d}  {p}")


if __name__ == "__main__":
    main()
