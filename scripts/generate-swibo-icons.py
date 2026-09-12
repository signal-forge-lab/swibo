from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "swibo-icon-source.png"
OUTPUT = ROOT / "assets" / "swibo-icons"
SIZES = (16, 24, 32, 48, 64, 96, 128, 256)


def main() -> None:
    image = Image.open(SOURCE).convert("RGBA")
    OUTPUT.mkdir(parents=True, exist_ok=True)

    for size in SIZES:
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        target = OUTPUT / f"{size}.png"
        resized.save(target, "PNG", optimize=True)
        if size == 256:
            resized.save(ROOT / "assets" / "swibo-icon.png", "PNG", optimize=True)


if __name__ == "__main__":
    main()
