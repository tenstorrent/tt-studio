# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Read a high-resolution page in pieces instead of shrinking it.

PaddleOCR-VL accepts about 1.2 MP. A phone photo of a page is 9 MP or more, so
the single-pass path downscales it by roughly 3x linearly, to something near 100
DPI, and small or handwritten text stops being legible before the model sees it.
Raising the model's own limit does not fix this: past ~1.2 MP it starts
transcribing a page and then transcribing it a second time.

Two cheap preprocessing steps recover most of the loss, measured on a 9 MP photo
of a handwritten page against the words a human can read off it, end to end
through the endpoint:

    full frame, one pass          2/8 words correct, repeat count wrong
    cropped to the writing        4/8 words correct, repeat count right
    cropped + 3 strips            7/8 words correct, repeat count right

The crop matters because blank paper costs the same pixels as text: on that page
the writing was 34% of the frame, so cropping was worth 1.7x linear resolution
for free. The strips matter because each one then fits under the model's limit at
native resolution, with no downscaling at all.

Four strips scored worse than three, so this is not a knob to turn up; the
functions here derive the count from the pixel budget rather than exposing it.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

# Pen ink against printed rules. Measured on the reference photo: at this
# threshold rows of handwriting carry 10.7x the dark-pixel density of rows
# holding only a ruled line, which is the widest separation available. Going
# darker (60) loses the ink entirely; lighter (160) starts counting the rules.
DARK_THRESHOLD = 140

# The page against whatever it is lying on. A photo usually includes desk.
PAGE_BRIGHT_THRESHOLD = 140
PAGE_BRIGHT_FRACTION = 0.35

# Fraction of the page ignored at each edge when looking for content: a photo
# has a shadow line down the binding and along the lifted edge, and both are
# dark enough to read as ink.
EDGE_INSET = 0.04

# A row counts as content above this dark-pixel density, and bands of content
# separated by less than this many rows are one block. Without the merge, the
# gaps between written lines split the page into dozens of fragments.
CONTENT_ROW_DENSITY = 0.008
CONTENT_GAP_ROWS = 60

# Breathing room around the detected content, so ascenders and descenders that
# fall just outside the measured box are not clipped.
CONTENT_PAD = 30

# Vertical overlap between strips, as a fraction of strip height. Enough that
# any single line of text appears complete in at least one strip, which is what
# makes the seam merge a de-duplication problem rather than a repair problem.
TILE_OVERLAP = 0.12

# Bounds the work for one upload: each strip is its own model request.
MAX_TILES = 6

# Word run that must coincide for a seam to be treated as duplicated. Only the
# tail of one strip is compared against the head of the next, so deliberate
# repetition inside a strip can never be collapsed by this.
SEAM_MIN_WORDS = 4
SEAM_WINDOW_WORDS = 80


def _contiguous_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Half-open [start, end) runs of True in a 1-D boolean array."""
    runs: list[tuple[int, int]] = []
    start = None
    for i, flag in enumerate(mask):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(mask)))
    return runs


def find_content_box(img: Image.Image) -> tuple[int, int, int, int] | None:
    """Box around the writing on the page, or None if nothing stands out.

    Returns (left, top, right, bottom) in ``img`` coordinates. Returning None
    means "use the whole image": a screenshot or an already-cropped scan has no
    margins to remove, and guessing at one risks cutting off real text.
    """
    width, height = img.size
    if width < 64 or height < 64:
        return None

    gray = np.asarray(img.convert("L"), dtype=np.float32)

    # 1. Find the page, so desk and background do not count as content.
    bright = gray > PAGE_BRIGHT_THRESHOLD
    page_rows = np.where(bright.mean(axis=1) > PAGE_BRIGHT_FRACTION)[0]
    page_cols = np.where(bright.mean(axis=0) > PAGE_BRIGHT_FRACTION)[0]
    if page_rows.size == 0 or page_cols.size == 0:
        return None
    py0, py1 = int(page_rows.min()), int(page_rows.max()) + 1
    px0, px1 = int(page_cols.min()), int(page_cols.max()) + 1

    # 2. Inset past the edge shadow before looking for ink.
    inset = int(EDGE_INSET * min(py1 - py0, px1 - px0))
    py0, py1 = py0 + inset, py1 - inset
    px0, px1 = px0 + inset, px1 - inset
    if py1 - py0 < 32 or px1 - px0 < 32:
        return None

    page = gray[py0:py1, px0:px1]
    ink = page < DARK_THRESHOLD

    # 3. The largest block of inked rows is the writing. Taking min and max of
    #    every inked row instead would span the whole page, because a page
    #    number or a speck of shadow anywhere defeats it.
    row_mask = ink.mean(axis=1) > CONTENT_ROW_DENSITY
    runs = _contiguous_runs(row_mask)
    if not runs:
        return None
    merged: list[list[int]] = []
    for start, end in runs:
        if merged and start - merged[-1][1] < CONTENT_GAP_ROWS:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    ty0, ty1 = max(merged, key=lambda r: r[1] - r[0])

    col_mask = ink[ty0:ty1].mean(axis=0) > CONTENT_ROW_DENSITY
    col_runs = np.where(col_mask)[0]
    if col_runs.size == 0:
        return None
    tx0, tx1 = int(col_runs.min()), int(col_runs.max()) + 1

    left = px0 + max(0, tx0 - CONTENT_PAD)
    top = py0 + max(0, ty0 - CONTENT_PAD)
    right = px0 + min(page.shape[1], tx1 + CONTENT_PAD)
    bottom = py0 + min(page.shape[0], ty1 + CONTENT_PAD)

    # Nothing to trim. Compared against the page region rather than the whole
    # frame: the edge inset above already removes 4% of each side, so a frame
    # comparison can never reach a high threshold and this guard would be dead
    # code. An image with no margin -- a screenshot, a tight scan -- lands here
    # and is better left alone than cropped by a few percent for no gain.
    page_area = (px1 - px0) * (py1 - py0)
    if page_area <= 0 or (right - left) * (bottom - top) > 0.92 * page_area:
        return None
    if right - left < 32 or bottom - top < 32:
        return None
    return (left, top, right, bottom)


def plan_tiles(
    width: int,
    height: int,
    max_pixels: int,
    *,
    overlap: float = TILE_OVERLAP,
    max_tiles: int = MAX_TILES,
) -> list[tuple[int, int, int, int]]:
    """Horizontal strips covering ``width`` x ``height``, each within the budget.

    One box back means no tiling is needed. Strips run full width and are cut
    horizontally because text lines do: a vertical cut would split words, while
    a horizontal one with overlap leaves every line whole in some strip.
    """
    if width <= 0 or height <= 0 or max_pixels <= 0:
        return [(0, 0, width, height)]

    needed = -(-(width * height) // max_pixels)  # ceil
    count = max(1, min(int(needed), max_tiles))
    if count == 1:
        return [(0, 0, width, height)]

    step = height / count
    boxes: list[tuple[int, int, int, int]] = []
    for i in range(count):
        top = max(0, int(i * step - overlap * step))
        bottom = min(height, int((i + 1) * step + overlap * step))
        boxes.append((0, top, width, bottom))
    return boxes


def merge_tile_texts(
    texts: list[str],
    *,
    min_words: int = SEAM_MIN_WORDS,
    window: int = SEAM_WINDOW_WORDS,
) -> str:
    """Join strip transcriptions, dropping only what a seam duplicated.

    Overlapping strips mean the lines around each cut are transcribed twice. The
    merge compares the *end* of one strip against the *beginning* of the next and
    removes the longest run of words they share, so repetition that a writer put
    there on purpose survives: it sits inside a strip, never across a seam.
    """
    kept = [t for t in texts if t and t.strip()]
    if not kept:
        return ""

    merged = kept[0].strip()
    for nxt in kept[1:]:
        nxt = nxt.strip()
        prev_words = merged.split()
        next_words = nxt.split()
        limit = min(window, len(prev_words), len(next_words))

        overlap_len = 0
        for size in range(limit, min_words - 1, -1):
            tail = [w.lower() for w in prev_words[-size:]]
            head = [w.lower() for w in next_words[:size]]
            if tail == head:
                overlap_len = size
                break

        if overlap_len:
            remainder = " ".join(next_words[overlap_len:])
            merged = f"{merged} {remainder}".strip() if remainder else merged
        else:
            merged = f"{merged}\n{nxt}"
    return merged
