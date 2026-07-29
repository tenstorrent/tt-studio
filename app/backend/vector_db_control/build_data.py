#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Regenerate the model-support portion of the voice/chat RAG corpus.

Why this exists
---------------
The knowledge base the RAG agent answers from lives in ``data.py``. Two of its
hand-written documents went stale: the ``tt-inference-server`` entry carried a model
table pinned to ``tt-metal v0.56.0-rc*``, and the TT-QuietBox 2 entry answered
"which models are supported?" by telling the reader to go browse a website. Asking
the voice agent what it can run therefore produced either outdated names or a
non-answer.

This script writes ``model_support_data.py``, which ``data.py`` imports. Two docs:

``SUPPORTED_MODELS_BY_HARDWARE``
    Parsed from the tt-inference-server ``docs/model_support/models_by_hardware.md``
    matrix at the pinned artifact ref. This is upstream's own answer for every
    platform, including BH QuietBox 2.

``DEPLOYABLE_MODEL_CATALOG``
    Derived from ``shared_config/models_from_inference_server.json`` -- the same
    catalog the deploy UI reads. This is the stricter, more useful answer: not
    "what does the hardware support" but "what can this TT-Studio actually launch".
    Needs no network.

Generating a separate module rather than rewriting ``data.py`` in place is
deliberate: ``data.py`` is ~87k lines and mostly a scraped-page dump, and doing
regex surgery on it to replace a couple of string literals is the kind of thing that
silently truncates a corpus. The generated file is written atomically (temp file +
rename), so a failed run leaves the previous corpus intact.

Usage
-----
    python build_data.py                  # fetch upstream matrix + rebuild both docs
    python build_data.py --offline        # local catalog only, keep existing matrix
    python build_data.py --ref v0.19.0    # override the pinned artifact ref
    python build_data.py --check          # exit 1 if the output is out of date

Re-seeding is automatic: any change here changes ``knowledge_corpus_revision()`` in
``data.py``, and ``VectorDbConfig.ready()`` re-chunks and upserts on next start.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND_ROOT = HERE.parent
REPO_ROOT = BACKEND_ROOT.parent.parent

CATALOG_JSON = BACKEND_ROOT / "shared_config" / "models_from_inference_server.json"
OUTPUT_PY = HERE / "model_support_data.py"

MATRIX_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/tenstorrent/tt-inference-server/"
    "{ref}/docs/model_support/models_by_hardware.md"
)
MATRIX_FALLBACK_REF = "main"
FETCH_TIMEOUT_SECONDS = 30

# The board TT-Studio reports for a TT-QuietBox 2 is P300x2 (2 Blackhole cards,
# 4 ASICs). Single-chip models run on it too, via --tt-device p150. Mirrors
# board_to_device_map in docker_control/views.py -- keep the two in step.
QB2_BOARD_TYPE = "P300x2"
QB2_DEVICE_CONFIGS = ("P300x2", "P300", "P150")

# How device-configuration keys in the catalog read in prose, so a spoken answer
# says "TT-QuietBox 2" rather than "P300x2".
DEVICE_LABELS = {
    "N150": "n150 (single Wormhole card)",
    "N300": "n300 (dual-chip Wormhole card)",
    "N150X4": "4x n150",
    "N300x4": "4x n300",
    "T3K": "TT-LoudBox / TT-QuietBox (Wormhole, 8 chips)",
    "GALAXY": "WH Galaxy",
    "GALAXY_T3K": "WH Galaxy (T3K mesh)",
    "P100": "p100 (Blackhole)",
    "P150": "p150 (single Blackhole card)",
    "P300": "p300 (dual-ASIC Blackhole card)",
    "P150X4": "4x p150 (Blackhole)",
    "P150X8": "8x p150 (Blackhole)",
    "P300x2": "TT-QuietBox 2 / QB2 (2x p300, 4 Blackhole ASICs)",
    "P300Cx4": "4x p300 (Blackhole, 8 ASICs)",
}

STATUS_LEGEND = (
    "Status meanings: COMPLETE is validated end to end; FUNCTIONAL runs but is not "
    "fully validated for performance or accuracy; EXPERIMENTAL is under active "
    "development and may be unstable."
)

GENERATED_HEADER = """# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

# === GENERATED FILE -- DO NOT EDIT BY HAND ===
# Rebuild with:  python app/backend/vector_db_control/build_data.py
#
# Model-support knowledge for the RAG corpus. Imported by data.py into
# INTERNAL_KNOWLEDGE. Editing this by hand will be overwritten on the next run;
# change build_data.py instead.
"""


class BuildError(RuntimeError):
    """Raised when the corpus cannot be built. Nothing is written."""


def plain_text(value: str) -> str:
    """Flatten a markdown cell to the words a person would say.

    Upstream writes both headings and model names as links
    (``[BH QuietBox 2](https://...)``, ``[FLUX.1-dev](image/FLUX.1-dev_p300x2.md)``)
    and marks status with emoji. Link targets and emoji are noise in a corpus that
    gets embedded for search and read aloud by TTS, so keep only the link text.
    """
    # [text](target) -> text, before any bracket stripping.
    value = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", value)
    # Note: underscores are NOT stripped -- they are load-bearing in model names
    # (speecht5_tts, stable-diffusion-xl-1.0-inpainting-0.1).
    value = re.sub(r"[`*\[\]]", "", value)
    # Emoji / symbol status markers.
    value = re.sub(r"[\U0001F000-\U0001FAFF☀-➿️]", "", value)
    return re.sub(r"\s+", " ", value).strip()


# --------------------------------------------------------------------------- #
# Upstream hardware matrix
# --------------------------------------------------------------------------- #


def resolve_artifact_ref() -> str:
    """Pin to the tt-inference-server version this TT-Studio actually deploys.

    Reading .env first (then .env.default) keeps the corpus describing the artifact
    in use rather than drifting with upstream main.
    """
    for env_file in (REPO_ROOT / ".env", REPO_ROOT / ".env.default"):
        if not env_file.is_file():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("TT_INFERENCE_ARTIFACT_VERSION="):
                ref = line.split("=", 1)[1].strip().strip("\"'")
                if ref:
                    return ref
    return MATRIX_FALLBACK_REF


def fetch_hardware_matrix(ref: str) -> tuple[str, str]:
    """Return (markdown, resolved_url). Falls back to main if the ref has no docs."""
    attempts = [ref]
    if ref != MATRIX_FALLBACK_REF:
        attempts.append(MATRIX_FALLBACK_REF)

    last_error: Exception | None = None
    for candidate in attempts:
        url = MATRIX_URL_TEMPLATE.format(ref=candidate)
        try:
            with urllib.request.urlopen(url, timeout=FETCH_TIMEOUT_SECONDS) as resp:
                body = resp.read().decode("utf-8")
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            last_error = exc
            print(f"  ! {candidate}: {exc}", file=sys.stderr)
            continue
        if "|" not in body:
            last_error = BuildError(f"{url} returned no table content")
            continue
        return body, url

    raise BuildError(f"could not fetch the hardware matrix: {last_error}")


def pick_cell(cells: list[str], columns: list[str], *names: str) -> str:
    """Read the first cell whose header contains one of ``names``.

    Column order in the upstream tables has moved between releases, so match on the
    header text rather than on position.
    """
    for name in names:
        for idx, col in enumerate(columns):
            if name in col and idx < len(cells):
                return plain_text(cells[idx])
    return ""


def parse_hardware_matrix(markdown: str) -> dict[str, list[tuple[str, str, str]]]:
    """Parse the matrix into {hardware: [(model, category, status), ...]}.

    Upstream writes one table per hardware platform under an ``##`` heading, with
    Model / Category / Status-ish columns. Column order has moved around between
    releases, so match on the header names rather than on position.
    """
    platforms: dict[str, list[tuple[str, str, str]]] = {}
    current: str | None = None
    columns: list[str] = []

    for raw_line in markdown.splitlines():
        line = raw_line.strip()

        heading = re.match(r"^#{2,3}\s+(.*\S)\s*$", line)
        if heading:
            current = plain_text(heading.group(1))
            platforms.setdefault(current, [])
            columns = []
            continue

        if not current or not line.startswith("|"):
            continue

        cells = [c.strip() for c in line.strip("|").split("|")]
        if not any(cells):
            continue

        lowered = [c.lower() for c in cells]
        if not columns and any(c.startswith("model") for c in lowered):
            columns = lowered
            continue
        # Separator row (|---|---|)
        if all(set(c) <= set("-: ") for c in cells if c):
            continue
        if not columns:
            continue

        model = pick_cell(cells, columns, "model")
        if not model or model.lower().startswith("model"):
            continue
        platforms[current].append(
            (
                model,
                pick_cell(cells, columns, "category", "type", "modality"),
                pick_cell(cells, columns, "status", "readiness"),
            )
        )

    return {name: rows for name, rows in platforms.items() if rows}


def render_hardware_matrix_doc(
    platforms: dict[str, list[tuple[str, str, str]]], ref: str, url: str
) -> str:
    lines = [
        "# Supported Models by Tenstorrent Hardware",
        "",
        "Which models the tt-inference-server can serve on each Tenstorrent platform.",
        f"Source: {url}",
        f"tt-inference-server ref: {ref}",
        "",
        STATUS_LEGEND,
        "",
    ]

    # QB2 first -- it is the platform most questions are about.
    ordered = sorted(
        platforms.items(),
        key=lambda kv: (0 if "quietbox 2" in kv[0].lower() else 1, kv[0].lower()),
    )

    for platform, rows in ordered:
        aliases = ""
        if "quietbox 2" in platform.lower():
            aliases = " (also called TT-QuietBox 2, QB2, the Blackhole QuietBox)"
        lines.append(f"## {platform}{aliases}")
        lines.append("")
        by_status: dict[str, list[str]] = {}
        for model, category, status in rows:
            key = (status or "unspecified").strip()
            label = f"{model} ({category})" if category else model
            by_status.setdefault(key, []).append(label)
        for status, models in by_status.items():
            lines.append(f"- {status}: {', '.join(sorted(models))}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


# --------------------------------------------------------------------------- #
# Local deployable catalog
# --------------------------------------------------------------------------- #


def load_catalog() -> dict:
    if not CATALOG_JSON.is_file():
        raise BuildError(
            f"model catalog not found at {CATALOG_JSON}. Regenerate it with "
            "shared_config/sync_models_from_inference_server.py"
        )
    try:
        catalog = json.loads(CATALOG_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BuildError(f"{CATALOG_JSON} is not valid JSON: {exc}") from exc
    if not catalog.get("models"):
        raise BuildError(f"{CATALOG_JSON} contains no models")
    return catalog


def render_catalog_doc(catalog: dict) -> str:
    models = catalog["models"]
    artifact_version = (catalog.get("source") or {}).get("artifact_version", "unknown")

    qb2_models = [
        m
        for m in models
        if set(m.get("device_configurations") or ()) & set(QB2_DEVICE_CONFIGS)
    ]

    intro = (
        "The models this TT-Studio installation can launch on Tenstorrent hardware, "
        "from the tt-inference-server catalog the deploy UI reads. Every model here is "
        "served through the tt-inference-server; LLMs and VLMs run on vLLM, media "
        "models on the media inference server."
    )
    qb2_intro = (
        f"The TT-QuietBox 2 reports as board type {QB2_BOARD_TYPE} (2x p300 cards, "
        "4 Blackhole ASICs, 480 Tensix cores, 128 GB GDDR6). It runs models built for "
        "the whole 4-chip mesh as well as single-chip models. "
        f"{len(qb2_models)} of the {len(models)} catalog models can be deployed on it."
    )

    lines = [
        "# Models TT-Studio Can Deploy",
        "",
        intro,
        f"tt-inference-server artifact version: {artifact_version}",
        f"Total models in the catalog: {len(models)}",
        "",
        "## Models supported on the TT-QuietBox 2 (QB2)",
        "",
        qb2_intro,
        "",
    ]

    for label, group in (
        ("Text and chat models (LLM)", "LLM"),
        ("Vision-language models (VLM)", "VLM"),
        ("Image generation", "IMAGE"),
        ("Video generation", "VIDEO"),
        ("Speech to text", "AUDIO"),
        ("Text to speech", "TEXT_TO_SPEECH"),
        ("Text embeddings", "EMBEDDING"),
        ("Computer vision (CNN)", "CNN"),
    ):
        entries = [
            m for m in qb2_models if (m.get("display_model_type") or "") == group
        ]
        if not entries:
            continue
        lines.append(f"### {label} on the QB2")
        for m in sorted(entries, key=lambda x: x["model_name"]):
            status = (m.get("status") or "").capitalize()
            hf = m.get("hf_model_id") or ""
            suffix = f" -- Hugging Face id {hf}" if hf else ""
            lines.append(f"- {m['model_name']} ({status}){suffix}")
        lines.append("")

    lines.append("## Full catalog, grouped by model type")
    lines.append("")
    for group in (
        "LLM",
        "VLM",
        "IMAGE",
        "VIDEO",
        "AUDIO",
        "TEXT_TO_SPEECH",
        "EMBEDDING",
        "CNN",
    ):
        entries = [m for m in models if (m.get("display_model_type") or "") == group]
        if not entries:
            continue
        lines.append(f"### {group}")
        for m in sorted(entries, key=lambda x: x["model_name"]):
            devices = ", ".join(
                DEVICE_LABELS.get(d, d) for d in (m.get("device_configurations") or ())
            )
            lines.append(
                f"- {m['model_name']} ({(m.get('status') or '').capitalize()}) "
                f"runs on: {devices or 'unspecified'}"
            )
        lines.append("")

    lines.append("## Notes")
    lines.append("")
    lines.append(
        "- A model listed here is deployable from the TT-Studio model catalog; it "
        "still has to be deployed before it can answer requests."
    )
    lines.append(
        "- Gated models such as the Llama family need a Hugging Face token (HF_TOKEN) "
        "with access granted on Hugging Face first."
    )
    lines.append(
        "- Status Complete means validated end to end, Functional means it runs but is "
        "not fully validated, Experimental means under active development."
    )

    return "\n".join(lines).rstrip() + "\n"


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #


def render_module(matrix_doc: str, catalog_doc: str, ref: str) -> str:
    stamp = datetime.now(UTC).replace(microsecond=0).isoformat()

    def literal(name: str, body: str) -> str:
        # The corpus is prose and markdown tables; a stray triple quote would break
        # the generated module, so refuse rather than emit something unparseable.
        if '"""' in body:
            raise BuildError(f"{name} contains a triple quote and cannot be embedded")
        return f'{name} = """\n{body}"""\n'

    return "\n".join(
        [
            GENERATED_HEADER,
            f"# Generated: {stamp}",
            f"# tt-inference-server ref: {ref}",
            "",
            literal("SUPPORTED_MODELS_BY_HARDWARE", matrix_doc),
            literal("DEPLOYABLE_MODEL_CATALOG", catalog_doc),
            "",
            "MODEL_SUPPORT_DOCS = [",
            "    SUPPORTED_MODELS_BY_HARDWARE,",
            "    DEPLOYABLE_MODEL_CATALOG,",
            "]",
            "",
        ]
    )


def existing_matrix_doc() -> str | None:
    """Recover the previously generated matrix so --offline can keep it."""
    if not OUTPUT_PY.is_file():
        return None
    text = OUTPUT_PY.read_text(encoding="utf-8")
    match = re.search(r'SUPPORTED_MODELS_BY_HARDWARE = """\n(.*?)"""', text, re.DOTALL)
    return match.group(1) if match else None


def write_atomically(content: str) -> None:
    """Write via temp file + rename so an interrupted run never truncates output."""
    fd, tmp_path = tempfile.mkstemp(dir=str(HERE), prefix=".build_data.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.replace(tmp_path, OUTPUT_PY)
    except BaseException:
        Path(tmp_path).unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--offline",
        action="store_true",
        help="skip the network fetch and reuse the existing hardware matrix",
    )
    parser.add_argument(
        "--ref",
        default=None,
        help="tt-inference-server ref to read the matrix from "
        "(default: TT_INFERENCE_ARTIFACT_VERSION from .env)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if the generated file is out of date; write nothing",
    )
    args = parser.parse_args()

    ref = args.ref or resolve_artifact_ref()

    try:
        catalog = load_catalog()
        catalog_doc = render_catalog_doc(catalog)
        print(
            f"  catalog: {len(catalog['models'])} models from {CATALOG_JSON.name} "
            f"(artifact {(catalog.get('source') or {}).get('artifact_version')})"
        )

        if args.offline:
            matrix_doc = existing_matrix_doc()
            if matrix_doc is None:
                raise BuildError(
                    "--offline needs a previously generated model_support_data.py to "
                    "reuse; run once without --offline first"
                )
            print("  matrix:  reused existing (offline)")
        else:
            print(f"  matrix:  fetching for ref {ref}")
            markdown, url = fetch_hardware_matrix(ref)
            platforms = parse_hardware_matrix(markdown)
            if not platforms:
                raise BuildError(f"parsed no hardware platforms from {url}")
            qb2 = [p for p in platforms if "quietbox 2" in p.lower()]
            if not qb2:
                print(
                    "  ! warning: no 'QuietBox 2' platform found upstream; "
                    f"got {sorted(platforms)}",
                    file=sys.stderr,
                )
            matrix_doc = render_hardware_matrix_doc(platforms, ref, url)
            print(f"  matrix:  {len(platforms)} platforms parsed")

        module = render_module(matrix_doc, catalog_doc, ref)
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        print("nothing written; the existing corpus is unchanged", file=sys.stderr)
        return 1

    if args.check:
        current = OUTPUT_PY.read_text(encoding="utf-8") if OUTPUT_PY.is_file() else ""

        # The timestamp line always differs; compare only the document bodies.
        def strip(text: str) -> str:
            return re.sub(r"^# Generated: .*$", "", text, flags=re.MULTILINE)

        if strip(current) != strip(module):
            print(f"{OUTPUT_PY.name} is out of date", file=sys.stderr)
            return 1
        print(f"{OUTPUT_PY.name} is up to date")
        return 0

    write_atomically(module)
    print(f"wrote {OUTPUT_PY} ({len(module):,} bytes)")
    print("restart the backend to re-seed the vector DB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
