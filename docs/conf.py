# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
#
# Configuration file for the Sphinx documentation builder.
# https://www.sphinx-doc.org/en/master/usage/configuration.html
#
# This site reuses the Tenstorrent house documentation theme (sphinx_rtd_theme
# + tt_theme.css) so it matches docs.tenstorrent.com. The theme assets under
# _static/ are vendored from the tenstorrent.github.io `shared/` directory.

import os

# -- Project information -----------------------------------------------------
project = "TT-Studio"
copyright = "2026, Tenstorrent"
author = "Tenstorrent"

# -- General configuration ---------------------------------------------------
extensions = [
    "myst_parser",
    "sphinxcontrib.mermaid",
    "sphinx_copybutton",
    "sphinx_togglebutton",
]

# MyST (Markdown) configuration.
myst_enable_extensions = [
    "colon_fence",
    "deflist",
    "linkify",
]
# Render ```mermaid fenced code blocks through the mermaid directive so the
# DeepWiki-sourced diagrams draw as real diagrams.
myst_fence_as_directive = ["mermaid"]
myst_heading_anchors = 3

exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", "assets"]

# -- Options for HTML output -------------------------------------------------
html_theme = "sphinx_rtd_theme"
html_theme_options = {
    "collapse_navigation": False,  # show carets on sections that have children
    "titles_only": True,           # product-style nav: sections/pages, not in-page H2s
    "navigation_depth": 2,
}
html_title = "TT-Studio"
html_logo = "_static/tt_logo.svg"
html_favicon = "_static/favicon.png"
html_static_path = ["_static"]
# Files copied verbatim to the output root (e.g. .nojekyll so GitHub Pages does
# not strip the _static/ directory).
html_extra_path = ["_extra"]
html_js_files = ["external-nav-links.js", "sidebar-scroll.js"]
html_last_updated_fmt = "%b %d, %Y"
html_baseurl = "https://docs.tenstorrent.com/tt-studio/"

_HOME = "https://docs.tenstorrent.com/"
html_context = {
    "logo_link_url": os.environ.get("homepage") or _HOME,
}

# -- Mermaid -----------------------------------------------------------------
# Draw diagrams as inline SVG in the browser via mermaid.js.
mermaid_version = "10.9.1"


def setup(app):
    app.add_css_file("tt_theme.css")
    app.add_css_file("home.css")
