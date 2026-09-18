# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Unit tests for the OCR tiling helpers.

No Django and no model: these are pure functions over an image and some strings,
which is most of what makes tiling correct or not.

The content-box tests are the ones worth keeping. Three earlier versions of that
detection looked plausible and were wrong in ways the numbers hid: one counted
the faint printed rules of a notebook as writing, one took the minimum and
maximum of every inked row and so spanned the whole page because of a page
number in the corner, and one latched onto the desk the page rested on. Each of
those cases is pinned below.
"""

from PIL import Image, ImageDraw

from model_control.ocr_tiling import (
    MAX_TILES,
    find_content_box,
    merge_tile_texts,
    plan_tiles,
)


def _photo_of_a_page(
    *,
    size=(900, 1600),
    page_margin=60,
    text_top=200,
    text_bottom=600,
    ruled=True,
    page_number=True,
) -> Image.Image:
    """A synthetic phone photo: dark desk, bright page, writing near the top.

    Deliberately includes the two things that fooled earlier versions of the
    detection: faint ruled lines down the whole page, and a dark page number far
    below the writing.
    """
    img = Image.new("RGB", size, (26, 24, 22))  # desk
    d = ImageDraw.Draw(img)
    d.rectangle(
        [page_margin, page_margin, size[0] - page_margin, size[1] - page_margin],
        fill=(246, 245, 242),
    )
    if ruled:
        for y in range(text_top - 60, size[1] - page_margin - 20, 40):
            d.line(
                [(page_margin + 20, y), (size[0] - page_margin - 20, y)],
                fill=(203, 208, 214),
            )
    for y in range(text_top, text_bottom, 40):
        d.line(
            [(page_margin + 40, y), (size[0] - page_margin - 60, y)],
            fill=(30, 30, 40),
            width=5,
        )
    if page_number:
        d.text(
            (size[0] - page_margin - 60, size[1] - page_margin - 40),
            "123",
            fill=(60, 60, 60),
        )
    return img


class TestFindContentBox:
    def test_crops_to_the_writing_and_ignores_blank_ruled_paper(self):
        img = _photo_of_a_page()
        box = find_content_box(img)
        assert box is not None
        left, top, right, bottom = box
        # The writing occupies y 200-600 of a 1600px frame; the box should track
        # it rather than running to the bottom of the page.
        assert top < 250
        assert bottom < 800, f"box ran past the writing into blank paper: {box}"
        assert right - left > 300

    def test_a_page_number_far_below_the_text_does_not_stretch_the_box(self):
        with_num = find_content_box(_photo_of_a_page(page_number=True))
        without = find_content_box(_photo_of_a_page(page_number=False))
        assert with_num is not None and without is not None
        # Within a hair of each other: taking min/max of inked rows instead of
        # the largest contiguous block made this differ by ~900px.
        assert abs(with_num[3] - without[3]) < 60

    def test_ruled_lines_alone_are_not_treated_as_content(self):
        """A page with rules but no writing has no content box to find."""
        blank = _photo_of_a_page(text_top=200, text_bottom=200, page_number=False)
        box = find_content_box(blank)
        if box is not None:
            # If it returns anything it must not be most of the page.
            _, top, _, bottom = box
            assert (bottom - top) < 0.5 * blank.size[1]

    def test_declines_on_an_image_with_no_margin_to_remove(self):
        """A screenshot or a tight scan should be left alone, not guessed at."""
        dense = Image.new("RGB", (800, 600), "white")
        d = ImageDraw.Draw(dense)
        for y in range(10, 590, 12):
            d.line([(5, y), (795, y)], fill=(20, 20, 20), width=4)
        assert find_content_box(dense) is None

    def test_declines_on_a_uniform_image(self):
        assert find_content_box(Image.new("RGB", (500, 500), "white")) is None

    def test_declines_on_a_tiny_image(self):
        assert find_content_box(Image.new("RGB", (20, 20), "white")) is None


class TestPlanTiles:
    def test_an_image_within_budget_is_one_tile(self):
        assert plan_tiles(1000, 1000, 2_000_000) == [(0, 0, 1000, 1000)]

    def test_a_large_page_is_split_and_the_strips_cover_it(self):
        boxes = plan_tiles(2000, 3000, 1_204_224)
        assert len(boxes) > 1
        assert boxes[0][1] == 0
        assert boxes[-1][3] == 3000
        # Contiguous with no gap: every row of the page lands in some strip.
        for prev, nxt in zip(boxes, boxes[1:]):
            assert nxt[1] <= prev[3], "strips must not leave a gap"

    def test_strips_overlap_so_no_line_is_only_ever_half_seen(self):
        boxes = plan_tiles(2000, 3000, 1_204_224)
        assert any(nxt[1] < prev[3] for prev, nxt in zip(boxes, boxes[1:]))

    def test_strips_run_the_full_width(self):
        for left, _, right, _ in plan_tiles(2000, 3000, 1_204_224):
            assert (left, right) == (0, 2000)

    def test_tile_count_is_bounded(self):
        # A 100 MP input must not become 80 model requests.
        assert len(plan_tiles(10_000, 10_000, 1_204_224)) <= MAX_TILES

    def test_degenerate_input_does_not_explode(self):
        assert plan_tiles(0, 0, 1_204_224) == [(0, 0, 0, 0)]
        assert plan_tiles(100, 100, 0) == [(0, 0, 100, 100)]


class TestMergeTileTexts:
    def test_text_duplicated_across_a_seam_is_removed_once(self):
        a = "the quick brown fox jumps over the lazy dog"
        b = "jumps over the lazy dog and keeps running"
        assert merge_tile_texts([a, b]) == (
            "the quick brown fox jumps over the lazy dog and keeps running"
        )

    def test_repetition_a_writer_put_there_on_purpose_survives(self):
        """The case that motivated matching only at the seam.

        Some pages really do repeat a phrase. A general de-duplication pass
        would collapse it; restricting the match to one strip's tail against the
        next strip's head cannot, because the repeats sit inside a strip.
        """
        a = "all work and no play all work and no play all work and no play the seam starts here"
        b = "the seam starts here and this part is new"
        merged = merge_tile_texts([a, b])
        assert merged.count("all work and no play") == 3
        assert merged.endswith("and this part is new")

    def test_strips_with_nothing_in_common_are_both_kept(self):
        merged = merge_tile_texts(["first strip text", "second strip text"])
        assert "first strip text" in merged
        assert "second strip text" in merged

    def test_a_short_coincidence_is_not_treated_as_a_seam(self):
        """Two or three shared words can happen by chance; don't drop content."""
        merged = merge_tile_texts(["ends with the", "the next line begins"])
        assert "next line begins" in merged
        assert merged.count("the") >= 2

    def test_matching_ignores_case(self):
        """Four words is the minimum seam, so the overlap here is four."""
        assert (
            merge_tile_texts(
                ["alpha beta gamma delta epsilon", "Beta Gamma Delta Epsilon zeta"]
            )
            == "alpha beta gamma delta epsilon zeta"
        )

    def test_empty_and_blank_strips_are_skipped(self):
        assert merge_tile_texts([]) == ""
        assert merge_tile_texts(["", "   "]) == ""
        assert merge_tile_texts(["", "real text", ""]) == "real text"

    def test_a_single_strip_is_returned_as_is(self):
        assert merge_tile_texts(["  just the one  "]) == "just the one"
