#!/usr/bin/env python3
"""Generate MoneyLab v2 brand marks: circular ML monogram seal."""

from __future__ import annotations

from pathlib import Path

import cairosvg
from PIL import Image, ImageFont

FONT = "/usr/share/fonts/truetype/macos/Inter-SemiBold.ttf"

GOLD = "#D4AF37"
INK = "#07070C"
SEAL = "#0B0B10"
EMERALD = "#12B886"
WHITE = "#F4F4F7"

ROOT = Path("/workspace/brand")
APP_ICONS = Path("/workspace/delay xit lifetime/assets/icons")


def monogram_mark(cx: float, cy: float, scale: float, stroke: float) -> str:
    """Fused ML: mountain M + L stem, emerald peak."""

    def x(v: float) -> float:
        return cx + v * scale

    def y(v: float) -> float:
        return cy + v * scale

    # Local coords around (0, 0). Compact so the L stays inside the ring.
    path = (
        f"M {x(-86):.2f} {y(62):.2f} "
        f"L {x(-48):.2f} {y(-22):.2f} "
        f"L {x(-18):.2f} {y(30):.2f} "
        f"L {x(6):.2f} {y(-66):.2f} "
        f"L {x(42):.2f} {y(30):.2f} "
        f"L {x(64):.2f} {y(-2):.2f} "
        f"L {x(92):.2f} {y(-2):.2f} "
        f"L {x(92):.2f} {y(62):.2f}"
    )
    return f"""
  <path d="{path}" fill="none" stroke="{GOLD}" stroke-width="{stroke:.2f}"
        stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="2.6"/>
  <circle cx="{x(6):.2f}" cy="{y(-84):.2f}" r="{6.4 * scale:.2f}" fill="{EMERALD}"/>
"""


def icon_svg(size: int = 1024, background: str | None = INK, bold: bool = False) -> str:
    cx = cy = size / 2
    ring_r = size * (0.365 if bold else 0.38)
    ring_sw = size * (0.058 if bold else 0.034)
    mark_scale = size / 512 * (1.18 if bold else 1.22)
    mark_sw = size * (0.052 if bold else 0.042)
    bg = f'<rect width="{size}" height="{size}" fill="{background}"/>' if background else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  {bg}
  <circle cx="{cx}" cy="{cy}" r="{ring_r:.2f}" fill="{SEAL}" stroke="{GOLD}" stroke-width="{ring_sw:.2f}"/>
  {monogram_mark(cx - size * 0.004, cy + size * 0.014, mark_scale, mark_sw)}
</svg>
"""


def wordmark_svg(width: int = 1100, height: int = 320, background: str | None = INK) -> str:
    bg = f'<rect width="{width}" height="{height}" fill="{background}"/>' if background else ""
    box = 220
    ix, iy = 48, (height - box) / 2
    cx, cy = ix + box / 2, iy + box / 2
    text_x = ix + box + 28
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
  <circle cx="{cx:.1f}" cy="{cy:.1f}" r="96" fill="{SEAL}" stroke="{GOLD}" stroke-width="7.6"/>
  {monogram_mark(cx - 2, cy + 4, 0.78, 8.4)}
  <text x="{text_x}" y="{text_y:.1f}" font-family="InterBrand, Inter, sans-serif"
        font-size="108" font-weight="600" letter-spacing="-2">
    <tspan fill="{WHITE}">Money</tspan><tspan fill="{GOLD}">Lab</tspan>
  </text>
</svg>
"""


def stacked_svg(width: int = 720, height: int = 780, background: str | None = INK) -> str:
    bg = f'<rect width="{width}" height="{height}" fill="{background}"/>' if background else ""
    cx, cy = width / 2, 300
    font = ImageFont.truetype(FONT, 78)
    money_w = font.getlength("Money")
    lab_w = font.getlength("Lab")
    tracking = -2 * 8
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
  <circle cx="{cx}" cy="{cy}" r="188" fill="{SEAL}" stroke="{GOLD}" stroke-width="11"/>
  {monogram_mark(cx - 2, cy + 6, 1.22, 14.5)}
  <text x="{x0:.1f}" y="600" font-family="InterBrand, Inter, sans-serif"
        font-size="78" font-weight="600" letter-spacing="-2" fill="{WHITE}">Money</text>
  <text x="{x1:.1f}" y="600" font-family="InterBrand, Inter, sans-serif"
        font-size="78" font-weight="600" letter-spacing="-2" fill="{GOLD}">Lab</text>
</svg>
"""


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
            im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad))).save(dest)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    APP_ICONS.mkdir(parents=True, exist_ok=True)

    icon_dark = icon_svg(1024, INK)
    icon_clear = icon_svg(1024, None)
    icon_light = icon_svg(1024, "#F7F5EE")
    icon_bold = icon_svg(1024, INK, bold=True)
    word_clear = wordmark_svg(1100, 320, None)
    stack_dark = stacked_svg(720, 780, INK)

    (ROOT / "moneylab-icon.svg").write_text(icon_dark, encoding="utf-8")
    (ROOT / "moneylab-icon-transparent.svg").write_text(icon_clear, encoding="utf-8")
    (ROOT / "moneylab-wordmark.svg").write_text(wordmark_svg(1100, 320, INK), encoding="utf-8")
    (ROOT / "moneylab-wordmark-transparent.svg").write_text(word_clear, encoding="utf-8")
    (ROOT / "moneylab-stacked.svg").write_text(stack_dark, encoding="utf-8")

    raster(icon_dark, ROOT / "moneylab-icon.png", 1024)
    raster(icon_clear, ROOT / "moneylab-icon-transparent.png", 1024)
    raster(icon_light, ROOT / "moneylab-icon-light.png", 1024)
    raster(stack_dark, ROOT / "moneylab-stacked.png", 720)
    raster(word_clear, ROOT / "moneylab-wordmark-transparent.png", 1100, trim=True)
    clear = Image.open(ROOT / "moneylab-wordmark-transparent.png").convert("RGBA")
    dark_wm = Image.new("RGBA", clear.size, INK + "FF")
    dark_wm.alpha_composite(clear)
    dark_wm.save(ROOT / "moneylab-wordmark.png")

    for size in (16, 32, 48):
        raster(icon_bold, APP_ICONS / f"icon-{size}.png", size)
    for size in (128, 512):
        raster(icon_dark, APP_ICONS / f"icon-{size}.png", size)
    raster(icon_dark, APP_ICONS / "icon.png", 512)
    raster(word_clear, APP_ICONS / "wordmark.png", 640, trim=True)

    for p in sorted(ROOT.glob("moneylab-*")) + sorted(APP_ICONS.glob("icon*.png")):
        print(f"{p.stat().st_size:8d}  {p}")


if __name__ == "__main__":
    main()
