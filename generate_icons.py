"""
generate_icons.py
Generates PNG icons for the Chrome extension (16, 32, 48, 128px).
Run once: python generate_icons.py
Requires: Pillow  (pip install Pillow)
"""

import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Installing Pillow...")
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw, ImageFont

ICON_SIZES = [16, 32, 48, 128]
OUTPUT_DIR = Path(__file__).parent / "icons"
OUTPUT_DIR.mkdir(exist_ok=True)

# Colour palette
BG_COLOR     = (15, 23, 42)      # #0f172a — dark navy
ACCENT_COLOR = (99, 102, 241)    # #6366f1 — indigo
TEXT_COLOR   = (241, 245, 249)   # #f1f5f9 — near-white

def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded-rectangle background
    margin = max(1, size // 12)
    r = max(2, size // 6)
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=r,
        fill=BG_COLOR,
    )

    # Accent circle (top-right corner)
    circ_r  = size // 6
    circ_cx = size - margin - circ_r
    circ_cy = margin + circ_r
    draw.ellipse(
        [circ_cx - circ_r, circ_cy - circ_r, circ_cx + circ_r, circ_cy + circ_r],
        fill=ACCENT_COLOR,
    )

    # Magnifier lines — simple representation
    if size >= 32:
        # Lens circle
        cx, cy = size // 2 - size // 10, size // 2
        lens_r = size // 4
        lw = max(1, size // 16)
        draw.ellipse(
            [cx - lens_r, cy - lens_r, cx + lens_r, cy + lens_r],
            outline=TEXT_COLOR,
            width=lw,
        )
        # Handle
        hx1 = cx + int(lens_r * 0.7)
        hy1 = cy + int(lens_r * 0.7)
        hx2 = cx + int(lens_r * 0.7) + size // 6
        hy2 = cy + int(lens_r * 0.7) + size // 6
        draw.line([hx1, hy1, hx2, hy2], fill=ACCENT_COLOR, width=lw + 1)
    else:
        # For tiny icons just show a filled accent square
        s = max(3, size // 3)
        ox, oy = (size - s) // 2, (size - s) // 2
        draw.rectangle([ox, oy, ox + s, oy + s], fill=ACCENT_COLOR)

    return img


for sz in ICON_SIZES:
    icon = draw_icon(sz)
    path = OUTPUT_DIR / f"icon{sz}.png"
    icon.save(path, "PNG")
    print(f"  [OK] Created {path}")

print("\nAll icons generated successfully!")
