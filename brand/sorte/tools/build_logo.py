#!/usr/bin/env python3
"""Generate the Sorte logo assets (SVG lockups + PNG exports).

The wordmark is converted from Montserrat (variable) into outlines, so the
resulting SVG files do not depend on any font being installed.

Usage:
    pip install fonttools cairosvg
    python3 brand/sorte/tools/build_logo.py
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONT_URL = "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf"
BRAND_DIR = Path(__file__).resolve().parents[1]
CACHE_DIR = BRAND_DIR / "tools" / ".cache"
FONT_PATH = CACHE_DIR / "Montserrat-variable.ttf"

VIOLET = "#8b5cf6"
VIOLET_LIGHT = "#a78bfa"
VIOLET_DEEP = "#6d28d9"
GOLD = "#f59e0b"
GOLD_LIGHT = "#fcd34d"
INK = "#03030e"
PAPER = "#ffffff"
TEXT_LIGHT = "#f4f4f7"
TEXT_DARK = "#0b0b14"
MUTED_ON_DARK = "#8b8b9e"
MUTED_ON_LIGHT = "#6b6b7b"


def font_file() -> Path:
    if not FONT_PATH.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(FONT_URL, FONT_PATH)
    return FONT_PATH


def outline(text: str, weight: float, size: float, tracking: float) -> tuple[str, float]:
    """Return an SVG path for `text` plus its advance width.

    Baseline sits at y=0 and the first glyph starts at x=0; `tracking` is
    expressed as a fraction of the font size (letter-spacing).
    """
    font = instancer.instantiateVariableFont(TTFont(font_file()), {"wght": weight})
    upem = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    scale = size / upem
    step = tracking * size

    parts: list[str] = []
    x = 0.0
    for char in text:
        name = cmap[ord(char)]
        glyph = glyphs[name]
        pen = SVGPathPen(glyphs)
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        drawn = pen.getCommands()
        if drawn:
            parts.append(drawn)
        x += glyph.width * scale + step
    if text:
        x -= step
    return " ".join(parts), x


def gradient_defs() -> str:
    return f"""  <defs>
    <linearGradient id="violet" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{VIOLET_LIGHT}"/>
      <stop offset="1" stop-color="{VIOLET_DEEP}"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{GOLD_LIGHT}"/>
      <stop offset="1" stop-color="{GOLD}"/>
    </linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{VIOLET_LIGHT}"/>
      <stop offset="0.55" stop-color="{VIOLET_DEEP}"/>
      <stop offset="1" stop-color="{VIOLET}"/>
    </linearGradient>
    <linearGradient id="word" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{TEXT_LIGHT}"/>
      <stop offset="0.82" stop-color="{TEXT_LIGHT}"/>
      <stop offset="1" stop-color="{GOLD_LIGHT}"/>
    </linearGradient>
  </defs>
"""


SUIT_DEFS = """    <g id="spade">
      <path d="M50 6C50 6 13 37 13 60c0 13 10 23 23 23 6 0 12-3 16-8-2 14-8 24-18 30h32c-10-6-16-16-18-30 4 5 10 8 16 8 13 0 23-10 23-23C87 37 50 6 50 6z"/>
    </g>
    <g id="heart">
      <path d="M50 94S6 62 6 35C6 19 18 8 31 8c9 0 17 5 19 12 2-7 10-12 19-12 13 0 25 11 25 27 0 27-44 59-44 59z"/>
    </g>
    <g id="club">
      <circle cx="50" cy="24" r="21"/>
      <circle cx="26" cy="55" r="21"/>
      <circle cx="74" cy="55" r="21"/>
      <path d="M42 60c2 16-3 28-13 34h42c-10-6-15-18-13-34z"/>
    </g>
    <g id="diamond">
      <path d="M50 5Q63 33 93 50Q63 67 50 95Q37 67 7 50Q37 33 50 5z"/>
    </g>
    <g id="spark">
      <path d="M50 0Q55 45 100 50Q55 55 50 100Q45 55 0 50Q45 45 50 0z"/>
    </g>
"""


def emblem(size: float, x: float, y: float, framed: bool = True) -> str:
    """Emblem markup scaled into a `size` x `size` box anchored at (x, y)."""
    k = size / 512.0

    def t(sx: float, sy: float, scale: float) -> str:
        return f"translate({x + sx * k:.2f} {y + sy * k:.2f}) scale({scale * k:.4f})"

    frame = (
        f'  <rect x="{x + 62 * k:.2f}" y="{y + 62 * k:.2f}" width="{388 * k:.2f}" '
        f'height="{388 * k:.2f}" rx="{96 * k:.2f}" fill="none" stroke="url(#frame)" '
        f'stroke-width="{12 * k:.2f}"/>\n'
        if framed
        else ""
    )
    return (
        frame + '  <g fill="url(#violet)">\n'
        f'    <use href="#spade" transform="{t(124, 124, 1.25)}"/>\n'
        f'    <use href="#heart" transform="{t(263, 124, 1.25)}"/>\n'
        f'    <use href="#club" transform="{t(124, 263, 1.25)}"/>\n'
        '  </g>\n'
        '  <g fill="url(#gold)">\n'
        f'    <use href="#diamond" transform="{t(263, 263, 1.25)}"/>\n'
        f'    <use href="#spark" transform="{t(356, 92, 0.56)}"/>\n'
        '  </g>\n'
    )


def symbol_svg(framed: bool = True) -> str:
    defs = gradient_defs().replace("  </defs>\n", SUIT_DEFS + "  </defs>\n")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" '
        'height="512" role="img" aria-label="Sorte">\n'
        "  <title>Sorte symbol</title>\n"
        f"{defs}{emblem(512, 0, 0, framed)}</svg>\n"
    )


def compact_symbol_svg() -> str:
    """Frameless, oversized suits: keeps the mark readable at 16-48 px."""
    defs = gradient_defs().replace("  </defs>\n", SUIT_DEFS + "  </defs>\n")
    scale = 1.62
    cell = 100 * scale
    gap = 26.0
    first = 256 - (cell + gap / 2)
    second = first + cell + gap

    def t(sx: float, sy: float) -> str:
        return f"translate({sx:.1f} {sy:.1f}) scale({scale})"

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" '
        'height="512" role="img" aria-label="Sorte">\n'
        "  <title>Sorte symbol (compact)</title>\n"
        f"{defs}"
        '  <g fill="url(#violet)">\n'
        f'    <use href="#spade" transform="{t(first, first)}"/>\n'
        f'    <use href="#heart" transform="{t(second, first)}"/>\n'
        f'    <use href="#club" transform="{t(first, second)}"/>\n'
        "  </g>\n"
        f'  <use href="#diamond" transform="{t(second, second)}" fill="url(#gold)"/>\n'
        "</svg>\n"
    )


def lockup_svg(theme: str, tagline: str = "APOSTAS INTELIGENTES", background: bool = True) -> str:
    dark = theme == "dark"
    word_size = 150.0
    word_path, word_w = outline("SORTE", 800, word_size, 0.02)
    tag_size = 40.0
    tag_path, tag_w = outline(tagline, 600, tag_size, 0.34)

    emblem_size = 260.0
    gap = 54.0
    pad = 72.0
    text_x = pad + emblem_size + gap
    text_w = max(word_w, tag_w)
    width = text_x + text_w + pad
    height = pad * 2 + emblem_size

    word_baseline = height / 2 + 13
    tag_baseline = word_baseline + tag_size + 34
    emblem_y = (height - emblem_size) / 2

    word_fill = "url(#word)" if dark else TEXT_DARK
    tag_fill = MUTED_ON_DARK if dark else MUTED_ON_LIGHT
    bg = INK if dark else PAPER

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'width="{width:.0f}" height="{height:.0f}" role="img" '
        'aria-label="Sorte - Apostas Inteligentes">\n'
        "  <title>Sorte</title>\n"
        f"{gradient_defs().replace('  </defs>', SUIT_DEFS + '  </defs>')}"
        + (f'  <rect width="{width:.0f}" height="{height:.0f}" fill="{bg}"/>\n' if background else "")
        + f"{emblem(emblem_size, pad, emblem_y)}"
        f'  <g transform="translate({text_x:.1f} {word_baseline:.1f})">\n'
        f'    <path d="{word_path}" fill="{word_fill}"/>\n'
        "  </g>\n"
        f'  <g transform="translate({text_x:.1f} {tag_baseline:.1f})">\n'
        f'    <path d="{tag_path}" fill="{tag_fill}"/>\n'
        "  </g>\n"
        "</svg>\n"
    )


def stacked_svg(theme: str, tagline: str = "APOSTAS INTELIGENTES") -> str:
    dark = theme == "dark"
    word_size = 132.0
    word_path, word_w = outline("SORTE", 800, word_size, 0.02)
    tag_size = 34.0
    tag_path, tag_w = outline(tagline, 600, tag_size, 0.34)

    emblem_size = 300.0
    pad = 72.0
    width = max(word_w, tag_w, emblem_size) + pad * 2
    height = pad * 2 + emblem_size + 12 + word_size + 46

    emblem_x = (width - emblem_size) / 2
    word_baseline = pad + emblem_size + 12 + word_size * 0.72
    tag_baseline = word_baseline + 46

    word_fill = "url(#word)" if dark else TEXT_DARK
    tag_fill = MUTED_ON_DARK if dark else MUTED_ON_LIGHT
    bg = INK if dark else PAPER

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'width="{width:.0f}" height="{height:.0f}" role="img" '
        'aria-label="Sorte - Apostas Inteligentes">\n'
        "  <title>Sorte</title>\n"
        f"{gradient_defs().replace('  </defs>', SUIT_DEFS + '  </defs>')}"
        f'  <rect width="{width:.0f}" height="{height:.0f}" fill="{bg}"/>\n'
        f"{emblem(emblem_size, emblem_x, pad)}"
        f'  <g transform="translate({width / 2:.1f} {word_baseline:.1f})">\n'
        f'    <path d="{word_path}" fill="{word_fill}" transform="translate({-word_w / 2:.1f} 0)"/>\n'
        "  </g>\n"
        f'  <g transform="translate({width / 2:.1f} {tag_baseline:.1f})">\n'
        f'    <path d="{tag_path}" fill="{tag_fill}" transform="translate({-tag_w / 2:.1f} 0)"/>\n'
        "  </g>\n"
        "</svg>\n"
    )


def avatar_svg() -> str:
    """1:1 social avatar: emblem on a violet-to-ink gradient tile."""
    defs = gradient_defs().replace(
        "  </defs>\n",
        SUIT_DEFS
        + '    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">\n'
        f'      <stop offset="0" stop-color="{VIOLET_DEEP}"/>\n'
        f'      <stop offset="0.55" stop-color="#1b1035"/>\n'
        f'      <stop offset="1" stop-color="{INK}"/>\n'
        "    </linearGradient>\n"
        "  </defs>\n",
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" '
        'height="512" role="img" aria-label="Sorte">\n'
        "  <title>Sorte avatar</title>\n"
        f"{defs}"
        '  <rect width="512" height="512" rx="112" fill="url(#tile)"/>\n'
        '  <rect x="18" y="18" width="476" height="476" rx="96" fill="none" '
        f'stroke="{GOLD_LIGHT}" stroke-opacity="0.6" stroke-width="5"/>\n'
        '  <g fill="#ffffff">\n'
        '    <use href="#spade" transform="translate(112 118) scale(1.35)"/>\n'
        '    <use href="#heart" transform="translate(262 118) scale(1.35)"/>\n'
        '    <use href="#club" transform="translate(112 268) scale(1.35)"/>\n'
        "  </g>\n"
        '  <use href="#diamond" transform="translate(262 268) scale(1.35)" fill="url(#gold)"/>\n'
        "</svg>\n"
    )


def main() -> None:
    written: dict[str, str] = {}

    files = {
        "sorte-symbol.svg": symbol_svg(framed=True),
        "sorte-symbol-plain.svg": symbol_svg(framed=False),
        "sorte-symbol-compact.svg": compact_symbol_svg(),
        "sorte-logo-dark.svg": lockup_svg("dark"),
        "sorte-logo-light.svg": lockup_svg("light"),
        "sorte-logo-stacked-dark.svg": stacked_svg("dark"),
        "sorte-logo-stacked-light.svg": stacked_svg("light"),
        "sorte-logo-dark-transparent.svg": lockup_svg("dark", background=False),
        "sorte-logo-light-transparent.svg": lockup_svg("light", background=False),
        "sorte-avatar.svg": avatar_svg(),
    }
    for name, content in files.items():
        path = BRAND_DIR / name
        path.write_text(content, encoding="utf-8")
        written[name] = "svg"

    try:
        import cairosvg
    except ImportError:
        print(json.dumps(written, indent=2))
        print("cairosvg not installed: skipped PNG exports")
        return

    png_dir = BRAND_DIR / "png"
    png_dir.mkdir(exist_ok=True)
    for name, out, w in (
        ("sorte-logo-dark.svg", "sorte-logo-dark.png", 1600),
        ("sorte-logo-light.svg", "sorte-logo-light.png", 1600),
        ("sorte-logo-stacked-dark.svg", "sorte-logo-stacked-dark.png", 1000),
        ("sorte-logo-stacked-light.svg", "sorte-logo-stacked-light.png", 1000),
        ("sorte-logo-dark-transparent.svg", "sorte-logo-dark-transparent.png", 1600),
        ("sorte-logo-light-transparent.svg", "sorte-logo-light-transparent.png", 1600),
        ("sorte-avatar.svg", "sorte-avatar.png", 1024),
    ):
        cairosvg.svg2png(url=str(BRAND_DIR / name), write_to=str(png_dir / out), output_width=w)
        written[out] = "png"

    for size in (16, 32, 48, 128, 256, 512, 1024):
        source = "sorte-symbol-compact.svg" if size <= 48 else "sorte-symbol.svg"
        out = png_dir / f"sorte-icon-{size}.png"
        cairosvg.svg2png(
            url=str(BRAND_DIR / source),
            write_to=str(out),
            output_width=size,
            output_height=size,
            background_color=INK,
        )
        written[out.name] = "png"

    print(json.dumps(written, indent=2))


if __name__ == "__main__":
    main()
