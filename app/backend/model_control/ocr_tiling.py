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

import difflib
import math
import re
import unicodedata

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

# A block apart from the main one is kept only if it could be a line of text:
# tall enough for a glyph and wide enough to be more than a page number.
MIN_BAND_ROWS = 12
MIN_BAND_WIDTH = 0.15

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
SEAM_WINDOW_WORDS = 160

# How far from the edges a shared run may sit and still mark the seam, and how
# long it must be when it does not touch them. Measured on dense print, the two
# reads of an overlap disagreed for up to 22 words before or after the run.
SEAM_SLACK_WORDS = 40
SEAM_MIN_INSET_WORDS = 8


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

    # 3. Every block of inked rows that looks like text is the writing, so a
    #    title set well apart from the body is kept. Taking min and max of
    #    every inked row instead would span the whole page, because a page
    #    number or a speck of shadow anywhere defeats it: those are dropped
    #    as too short or too narrow to be a line of text.
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

    def _band_cols(band: list[int]) -> np.ndarray:
        return np.where(ink[band[0] : band[1]].mean(axis=0) > CONTENT_ROW_DENSITY)[0]

    largest = max(merged, key=lambda r: r[1] - r[0])
    bands = []
    for band in merged:
        cols = _band_cols(band)
        if cols.size == 0:
            continue
        is_text = (
            band[1] - band[0] >= MIN_BAND_ROWS
            and cols.max() - cols.min() + 1 >= MIN_BAND_WIDTH * page.shape[1]
        )
        if band is largest or is_text:
            bands.append((band, cols))
    if not bands:
        return None

    ty0 = min(band[0] for band, _ in bands)
    ty1 = max(band[1] for band, _ in bands)
    tx0 = int(min(cols.min() for _, cols in bands))
    tx1 = int(max(cols.max() for _, cols in bands)) + 1

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

    The count is sized for the strip *with* its overlap, so each one fits the
    budget at native resolution. Only a page needing more than ``max_tiles``
    strips gets strips over budget, which the caller then downscales.
    """
    if width <= 0 or height <= 0 or max_pixels <= 0:
        return [(0, 0, width, height)]
    if width * height <= max_pixels:
        return [(0, 0, width, height)]

    # An interior strip spans step * (1 + 2 * overlap) rows.
    max_step = max_pixels / (width * (1 + 2 * overlap))
    needed = math.ceil(height / max_step) if max_step > 0 else max_tiles
    count = max(2, min(needed, max_tiles))

    step = height / count
    boxes: list[tuple[int, int, int, int]] = []
    for i in range(count):
        top = max(0, int(i * step - overlap * step))
        bottom = min(height, int((i + 1) * step + overlap * step))
        boxes.append((0, top, width, bottom))
    return boxes


def _seam_tokens(text: str) -> list[tuple[str, int, int]]:
    """Words of ``text`` in comparable form, each with its (start, end) offsets.

    The two reads of a seam line routinely disagree on punctuation and case
    (``was`` in one strip, ``was,`` in the next), so words are compared with
    both stripped. Tokens that are nothing but punctuation are skipped entirely,
    since one strip may read a dash or bullet the other does not.
    """
    tokens: list[tuple[str, int, int]] = []
    for match in re.finditer(r"\S+", text):
        word = unicodedata.normalize("NFKC", match.group()).casefold()
        word = "".join(
            ch for ch in word if not unicodedata.category(ch).startswith(("P", "S"))
        )
        if word:
            tokens.append((word, match.start(), match.end()))
    return tokens


def merge_tile_texts(
    texts: list[str],
    *,
    min_words: int = SEAM_MIN_WORDS,
    window: int = SEAM_WINDOW_WORDS,
) -> str:
    """Join strip transcriptions, dropping only what a seam duplicated.

    Overlapping strips mean the lines around each cut are transcribed twice. The
    merge compares the *end* of one strip against the *beginning* of the next and
    cuts at the longest run of words they share (see _find_seam for how much
    disagreement around it is tolerated), so repetition that a writer put there
    on purpose survives: it sits inside a strip, never across a seam. The
    earlier strip is kept up to the end of that run, taking whichever reading of
    each shared word is longer (one read often drops a trailing comma), and the
    next strip carries on from there as written, line breaks included.
    """
    kept = [t.strip() for t in texts if t and t.strip()]
    if not kept:
        return ""

    merged = kept[0]
    for nxt in kept[1:]:
        prev_tokens = _seam_tokens(merged)
        next_tokens = _seam_tokens(nxt)
        prev_words = [t[0] for t in prev_tokens]
        next_words = [t[0] for t in next_tokens]
        tail = prev_words[-window:]
        head = next_words[:window]
        base = len(prev_words) - len(tail)

        seam = _find_seam(tail, head, min_words)
        if seam is None:
            merged = f"{merged}\n{nxt}"
            continue

        i, j, n = seam
        shared = prev_tokens[base + i : base + i + n]
        # Words the earlier strip read past the shared run are in the next
        # strip too, which carries on from the same point.
        merged = merged[: shared[-1][2]]
        # Right to left, so earlier offsets stay valid as words are swapped.
        for (_, ps, pe), (_, ns, ne) in reversed(
            list(zip(shared, next_tokens[j : j + n]))
        ):
            if ne - ns > pe - ps:
                merged = merged[:ps] + nxt[ns:ne] + merged[pe:]
        remainder = nxt[next_tokens[j + n - 1][2] :]
        if remainder.strip():
            sep = "" if remainder[0].isspace() else " "
            merged = f"{merged}{sep}{remainder}"
    return merged


def _find_seam(
    tail: list[str], head: list[str], min_words: int
) -> tuple[int, int, int] | None:
    """The run of words a seam shares, as (index in tail, index in head, length).

    The two reads of the overlap rarely agree word for word: one misreads a
    word partway through, or reads a few words the other does not, which
    splits the duplicated text into several runs. Any run that ends close to
    the tail's end and starts close to the head's start marks the seam; the
    longest is taken. A run flush with both edges needs only ``min_words``;
    one set in from them needs SEAM_MIN_INSET_WORDS, so a chance coincidence
    inside the overlap cannot trim real text.
    """
    matcher = difflib.SequenceMatcher(None, tail, head, autojunk=False)
    best = None
    for i, j, n in matcher.get_matching_blocks():
        if n == 0:
            continue
        end_gap = len(tail) - (i + n)
        if end_gap > SEAM_SLACK_WORDS or j > SEAM_SLACK_WORDS:
            continue
        needed = (
            min_words
            if end_gap == 0 and j == 0
            else max(min_words, SEAM_MIN_INSET_WORDS)
        )
        if n >= needed and (best is None or n > best[2]):
            best = (i, j, n)
    return best
