# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Rich panel builders (welcome / ready / kept / notice / steps)."""

from rich import box
from rich.console import Group
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from tt_setup.console._theme import console
from tt_setup.console._stepper import SETUP_PHASES


def steps_panel(phases=None, context=None):
    """A compact upfront overview of the run's steps (shown once, may scroll away):
    a numbered title + one-line description per step, plus optional context lines."""
    phases = phases or SETUP_PHASES
    grid = Table.grid(padding=(0, 2))
    grid.add_column(justify="right")   # number
    grid.add_column()                  # title
    grid.add_column()                  # description
    for i, (title, desc) in enumerate(phases, 1):
        grid.add_row(f"[bold accent]{i}[/bold accent]", f"[bold]{title}[/bold]", f"[muted]{desc}[/muted]")
    body = [grid]
    for line in (context or []):
        body.append(f"[muted]{line}[/muted]")
    return Panel(
        Group(*body),
        title=f"[bold accent]This run · {len(phases)} steps[/bold accent]",
        title_align="left",
        border_style="accent",
        box=box.ROUNDED,
        padding=(1, 2),
        expand=False,
    )


def _vdivider(height):
    """A full-height vertical divider for a two-column grid row (accent-colored)."""
    return "\n".join("[accent]│[/accent]" for _ in range(max(height, 1)))


# Fixed panel width: a stretched (terminal-width) panel re-wraps and garbles the
# ASCII logos when the user resizes the window, so we pin it. Capped to the
# current width so it still fits narrow terminals.
_PANEL_WIDTH = 78


def _panel_width():
    return min(_PANEL_WIDTH, console.width)


def _logo_text(art):
    """Centered accent logo that crops (never word-wraps) on narrow terminals,
    so a resize clips it cleanly instead of garbling the art."""
    return Text(art, style="accent", justify="center", no_wrap=True, overflow="crop")


def welcome_panel(title, left_lines, sections, logos=None, tagline=None):
    """Build the Claude-Code-style launch panel: title in the top border, an
    optional stack of centered logo bands, an optional centered tagline, then a
    two-column body (left context | divider | headed right sections).

    - title: text shown in the top border (e.g. "TT Studio · main").
    - left_lines: list of Rich-markup strings stacked in the left column.
    - sections: list of (heading, [item, ...]) rendered in the right column,
      each heading bold-accent, items muted, separated by a thin rule.
    - logos: optional list of multi-line ASCII strings, each centered in accent
      above the body (rendered as plain Text — backslashes/brackets are safe).
    - tagline: optional list of Rich-markup strings, centered under the logo
      (e.g. the product name + one-line description).

    Markup-bearing content (left_lines/sections/tagline) must be markup-safe.
    """
    right_lines = []
    for i, (heading, items) in enumerate(sections):
        if i:
            right_lines.append("")  # spacing between sections
        right_lines.append(f"[bold accent]{heading}[/bold accent]")
        right_lines.append("")  # spacing under the heading
        right_lines.extend(f"[muted]{item}[/muted]" for item in items)

    height = max(len(left_lines), len(right_lines), 1)
    left = list(left_lines) + [""] * (height - len(left_lines))
    right = right_lines + [""] * (height - len(right_lines))

    # expand=True + a ratio on the right column makes the body fill the panel
    # width (right column reaches the border) instead of leaving a hollow gap.
    grid = Table.grid(padding=(0, 2), expand=True)
    grid.add_column()           # left — sized to its content
    grid.add_column()           # vertical divider
    grid.add_column(ratio=1)    # right — absorbs the remaining width
    grid.add_row("\n".join(left), _vdivider(height), "\n".join(right))

    parts = []
    for art in (logos or []):
        if parts:
            parts.append("")  # blank line between stacked logos so they don't collide
        parts.append(_logo_text(art))
    if tagline and parts:
        parts.append("")  # breathing room between the logo and the tagline
    for line in (tagline or []):
        parts.append(Text.from_markup(line, justify="center"))  # centered under the logo
    if parts:
        parts.append("")  # blank line between the header and the body
    parts.append(grid)
    body = Group(*parts) if len(parts) > 1 else grid

    return Panel(
        body,
        title=f"[bold accent]{title}[/bold accent]",
        title_align="left",
        border_style="accent",
        box=box.ROUNDED,
        padding=(1, 2),
        width=_panel_width(),
    )


def ready_panel(title, rows, footer_lines=None):
    """Build the post-startup summary panel: title in the top border, an aligned
    label/value grid (endpoints, mode), plus optional muted footer lines.

    - rows: list of (label, value) or (label, value, status). Labels are muted;
      values render in info (cyan). A value that looks like a URL becomes an
      OSC-8 hyperlink (cmd-clickable in modern terminals). The optional `status`
      ("up" / "starting" / "down") prefixes the value with a live health glyph.
    - footer_lines: list of Rich-markup strings shown under the grid.
    """
    glyphs = {
        "up": "[success]●[/success] ",
        "starting": "[warning]…[/warning] ",
        "down": "[error]✗[/error] ",
    }
    grid = Table.grid(padding=(0, 3))
    grid.add_column()
    grid.add_column()
    for row in rows:
        label, value = row[0], row[1]
        status = row[2] if len(row) > 2 else None
        glyph = glyphs.get(status, "")
        if isinstance(value, str) and value.startswith("http"):
            rendered = f"[info][link={value}]{value}[/link][/info]"
        else:
            rendered = f"[info]{value}[/info]"
        grid.add_row(f"[muted]{label}[/muted]", f"{glyph}{rendered}")

    body = [grid]
    if footer_lines:
        body.append("")
        body.extend(footer_lines)

    return Panel(
        Group(*body),
        title=f"[bold accent]{title}[/bold accent]",
        title_align="left",
        border_style="accent",
        box=box.ROUNDED,
        padding=(1, 2),
        width=_panel_width(),
    )


def kept_panel(title, rows, footer_lines=None):
    """A content-sized panel for 'what was preserved' summaries (e.g. after
    --stop). Muted border (distinct from the accent ready card) signals
    secondary state; `expand=False` keeps it compact, not hollow.

    - title: Rich-markup string shown in the top border (caller styles it).
    - rows: list of (label, value), both Rich-markup strings the caller styles
      (labels readable, values can grey out secondary bits / accent a live count).
    - footer_lines: optional Rich-markup strings under the grid.
    """
    grid = Table.grid(padding=(0, 3))
    grid.add_column()
    grid.add_column()
    for label, value in rows:
        grid.add_row(label, value)

    body = [grid]
    if footer_lines:
        body.append("")
        body.extend(footer_lines)

    return Panel(
        Group(*body),
        title=title,
        title_align="left",
        border_style="muted",
        box=box.ROUNDED,
        padding=(1, 2),
        expand=False,
    )


def notice_panel(title, lines, border_style="accent"):
    """A compact, content-sized panel with a styled border and body lines —
    used for headers/callouts (e.g. the red --purge-all danger header).

    - title: Rich-markup string shown in the top border.
    - lines: list of Rich-markup strings stacked in the body.
    - border_style: theme style for the border (e.g. "error", "accent").
    """
    return Panel(
        Group(*lines),
        title=title,
        title_align="left",
        border_style=border_style,
        box=box.ROUNDED,
        padding=(1, 2),
        expand=False,
    )

