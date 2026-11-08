"""Writes the debug-text test fixtures from the desktop app's reader (the reference implementation).

    cd "../ScanLake Desktop"
    PYTHONPATH=. .venv/Scripts/python.exe "../ScanLake Capture/test/fixtures/make_debug_text_fixtures.py"

- debug_font/synthetic.{json,png}: the desktop tests' synthetic font (Hershey glyphs, 9 px advance);
- debug_font/synthetic_frac.{json,png}: the same glyphs at a fractional 9.5 px advance;
- debug_text/<font>.png: the whiteness of a synthetic screen's debug-text corner (the 9.5 px lines
  drawn at alternating grid phases), and debug_text/<font>.json: what the desktop reader reads there;
- debug_text/real/<crop>.png: the desktop tests' crops of real 2560x1440 screenshots, and
  debug_text/real/<crop>.json: what the desktop reader reads there with its shipped font (the one
  `npm run sync-debug-font` copies to public/display_info_font/).

The Capture tests check that the TypeScript reader reads the same.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict, replace
from pathlib import Path

import cv2

from scanlake_core.domain.position import parse_position
from scanlake_core.vision.debug_text import DebugTextReader, TextLine, corner, whiteness
from tests.test_debug_text import LINES, OTHER_LINES, REAL, synthetic_font, synthetic_screen

HERE = Path(__file__).resolve().parent
SIZE = (1700, 520)  # a small screen keeps the corner fixture small (850×130)
PHASES = (0.0, 0.5, 0.5, 0.0, 0.5, 0.0, 0.5)  # per line, for the 9.5 px font


def reading(lines: list[TextLine]) -> dict[str, object]:
    position = parse_position([(line.text, line.score) for line in lines])
    return {
        "lines": [asdict(line) for line in lines],
        "position": None if position is None else {
            "zones": [asdict(z) for z in position.zones],
            "camDir": list(position.cam_dir) if position.cam_dir else None,
        },
    }


def write(path: Path, lines: list[TextLine]) -> None:
    path.write_text(json.dumps(reading(lines), indent=2) + "\n", "utf-8")
    print(path.name, [line.text for line in lines])


def main() -> None:
    out = HERE / "debug_text"
    (out / "real").mkdir(parents=True, exist_ok=True)

    base = synthetic_font()
    for font, phases in ((base, ()), (replace(base, name="synthetic_frac", advance=9.5), PHASES)):
        font.save(HERE / "debug_font")
        screen = synthetic_screen(font, [*LINES, *OTHER_LINES], seed=7, size=SIZE, phases=phases)
        white = whiteness(corner(screen))
        cv2.imwrite(str(out / f"{font.name}.png"), white)
        write(out / f"{font.name}.json", DebugTextReader([font]).read(white))

    reader = DebugTextReader()  # the shipped font
    for crop in sorted(REAL.glob("*.png")):
        shutil.copyfile(crop, out / "real" / crop.name)
        image = cv2.imread(str(crop))
        write(out / "real" / f"{crop.stem}.json", reader.read(image))


if __name__ == "__main__":
    main()
