"""Mock creative generation for the prototype.

Meta's Marketing API exposes no arbitrary text-to-image / text-to-video endpoint —
the only generative features are Advantage+ creative *enhancements* applied to an
already-uploaded asset (text variations, background generation, image expansion,
image→video), opted into via `creative_features_spec` / `degrees_of_freedom_spec`.

So for a visual-first prototype we synthesise a branded placeholder SVG sized to the
chosen placement. It renders in an <img>, needs no binary deps, and reads as a real
generated creative in the ad preview. `media_type="video"` adds a play affordance.
"""

from __future__ import annotations

import uuid
from pathlib import Path

# Generated assets are written here and served by the API under /api/uploads.
UPLOADS_DIR = Path(__file__).resolve().parent.parent / "data" / "uploads"

# Aspect ratio (w, h) per placement format — mirrors Meta's recommended specs.
_RATIO = {
    "feed": (1080, 1080),       # 1:1 square feed
    "stories": (1080, 1920),    # 9:16 full-screen
    "reels": (1080, 1920),      # 9:16 full-screen
    "whatsapp": (1080, 1080),   # Click-to-WhatsApp ad uses a feed-style 1:1 image
}

# A small palette of gradient pairs so successive generations look distinct.
_GRADIENTS = [
    ("#6366f1", "#a855f7"), ("#0ea5e9", "#22d3ee"), ("#f97316", "#f43f5e"),
    ("#10b981", "#14b8a6"), ("#8b5cf6", "#ec4899"), ("#2563eb", "#7c3aed"),
]


def _esc(text: str) -> str:
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _wrap(text: str, width: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= width:
            cur = f"{cur} {w}".strip()
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:4]


def generate_svg(
    *,
    fmt: str = "feed",
    media_type: str = "image",
    headline: str | None = None,
    brand: str | None = None,
    seed: int = 0,
) -> str:
    """Return an SVG string for a generated creative placeholder."""
    w, h = _RATIO.get(fmt, (1080, 1080))
    c1, c2 = _GRADIENTS[seed % len(_GRADIENTS)]
    title = _esc((headline or "Ваша реклама").strip())[:120]
    brand_txt = _esc((brand or "AdConnect").strip())[:40]
    lines = _wrap(title, 22)
    line_h = 92
    block_h = line_h * len(lines)
    y0 = h // 2 - block_h // 2

    text_spans = "".join(
        f'<text x="{w//2}" y="{y0 + i*line_h}" text-anchor="middle" '
        f'font-family="Inter, Arial, sans-serif" font-size="74" font-weight="700" '
        f'fill="#ffffff">{ln}</text>'
        for i, ln in enumerate(lines)
    )

    play = ""
    if media_type == "video":
        cx, cy, r = w // 2, h // 2 - block_h // 2 - 150, 70
        play = (
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="rgba(255,255,255,0.22)"/>'
            f'<polygon points="{cx-22},{cy-32} {cx-22},{cy+32} {cx+34},{cy}" fill="#ffffff"/>'
        )

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>'
        f'</linearGradient></defs>'
        f'<rect width="{w}" height="{h}" fill="url(#g)"/>'
        f'{play}{text_spans}'
        f'<text x="{w//2}" y="{h-90}" text-anchor="middle" '
        f'font-family="Inter, Arial, sans-serif" font-size="40" font-weight="600" '
        f'fill="rgba(255,255,255,0.85)">{brand_txt}</text>'
        f'</svg>'
    )


def save_generated(
    *,
    fmt: str = "feed",
    media_type: str = "image",
    headline: str | None = None,
    brand: str | None = None,
    seed: int = 0,
) -> str:
    """Render a placeholder creative, persist it, and return its /api/uploads URL."""
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    svg = generate_svg(fmt=fmt, media_type=media_type, headline=headline, brand=brand, seed=seed)
    name = f"{uuid.uuid4().hex}.svg"
    (UPLOADS_DIR / name).write_text(svg, encoding="utf-8")
    return f"/api/uploads/{name}"
