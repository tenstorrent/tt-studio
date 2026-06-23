---
name: license-attribution-compliance
description: >-
  Review third-party license attribution for TT-Studio when dependencies or
  bundled assets change, and keep the attribution files in sync. Use when a PR
  adds/updates a dependency (app/backend/requirements.txt, app/agent,
  inference-api, docker-control-service, or app/frontend/package.json), bundles
  a binary/model/weights file, or when the user asks to "attribute a license",
  "update third-party-licenses", "check license compliance", or run the license
  check. Pairs with the deterministic gate dev-tools/check_license_attribution.py
  (freshness + new-dependency attribution) that runs on pull requests; this
  skill does the judgment the script cannot -- classifying licenses and flagging
  NonCommercial/copyleft/provenance risks.
---

# License Attribution Compliance

TT-Studio is Apache-2.0 © Tenstorrent AI ULC and ships under a strict regime.
This skill keeps third-party attribution correct when dependencies or bundled
assets change. There are two layers:

- **Deterministic gate** — `dev-tools/check_license_attribution.py`, meant for CI
  on every PR. It catches *mechanical* drift: a stale frontend license file, or a
  newly added dependency that nobody attributed.
- **Judgment review (this skill)** — classify the actual license, flag
  NonCommercial / copyleft / provenance risks, and write the attribution in the
  right place using the repo's established patterns.

Run the gate first, then reason about whatever it surfaces.

## The repo's attribution surfaces

| Surface | What it covers | How it's maintained |
|---|---|---|
| Root `LICENSE` → "Third-Party Dependencies" list | Notable / distributed deps + pointers | Hand-edited bullets: `- Name (SPDX) [License available here](url)` |
| `app/frontend/third-party-licenses.txt` | Every frontend **production** npm dep (full license text) | `cd app/frontend && npm run generate-license` |
| SPDX file headers | Every source file (`.py`, `.sh`, Dockerfile, `.ts/.tsx/.js/.jsx`) | Enforced by existing CI (`check-copyright` / ESLint `header/header-format`); fix with `python run.py --add-headers` or `npm run header:fix:changed` |
| (none yet) backend Python deps | "utilized but not distributed" — covered by the blanket clause in LICENSE | If a backend dep is ever *distributed/bundled*, it needs an explicit notice |

## Step 1 — run the gate

```bash
python3 dev-tools/check_license_attribution.py            # both checks
python3 dev-tools/check_license_attribution.py --check-frontend
python3 dev-tools/check_license_attribution.py --check-new-deps --base origin/main
```

- **Frontend freshness FAIL** → `cd app/frontend && npm run generate-license`, commit
  the result. (Needs node; the check SKIPs where node is absent.)
- **New-dep attribution FAIL** → continue to Step 2 for each named dep.

> **Tool pin:** `generate-license-file` is pinned to **4.0.0** in
> `app/frontend/package.json`. 4.1.0+ silently drops `react`/`react-dom` from the
> output. The script regenerates with `@4.0.0` explicitly. Do not loosen the pin.

## Step 2 — classify the license

Find each dependency's real license (npm: its `package.json`/repo; pip: PyPI/repo).
**Models, datasets, and weights often carry a different, more restrictive license
than the code that loads them — check both.**

| Class | Examples | Action |
|---|---|---|
| Permissive | Apache-2.0, MIT, ISC, BSD-2/3 | ✅ Attribute (link/notice). Apache-2.0 §4 wants the NOTICE text retained, not just a link, for anything distributed. |
| Weak copyleft | MPL-2.0, LGPL | ⚠️ Usually OK if not modified/static-linked. Flag for review. |
| Strong copyleft | GPL, AGPL | 🛑 Generally incompatible with shipping Apache-2.0. Escalate before merging. |
| NonCommercial | CC BY-NC, CC BY-NC-SA, `*-NC*` | 🛑 **Blocker for commercial distribution.** Not a paperwork fix. Escalate to IP/legal. |

You are not a lawyer — for anything copyleft, NonCommercial, or of uncertain
provenance, flag it to whoever owns IP/legal rather than silently attributing it.

## Step 3 — attribute in the right place

- **Frontend prod dep** → already handled by regenerating `third-party-licenses.txt`.
  Add a root-`LICENSE` bullet too if it's notable/headline.
- **Notable / distributed dep (any language)** → add a bullet to the
  "Third-Party Dependencies" list in the root `LICENSE`, matching the existing form:
  `- <Name> (<SPDX>) [License available here](<upstream-license-url>)`.
- **Runtime-only backend dep, not distributed** → acknowledge in
  `dev-tools/license_attribution_allowlist.txt` (one name per line). This is the
  "considered, no LICENSE entry needed" escape hatch the gate honors.

## Step 4 — bundled binaries / models / weights (the high-risk case)

A checked-in `.onnx`/`.bin`/weights file is **distributed**, so its license travels
with the repo, and you can't put an SPDX header inside a binary. Convention:

- Add a sidecar `README.md` next to the file stating **exactly how it was produced**
  (self-trained vs. derived/fine-tuned from an upstream model) and **under what
  license**.
- If it's *derived from* a NonCommercial-licensed model, it **inherits** that license
  (e.g. ShareAlike) — that's a blocker for commercial use, not a notice you can write
  your way out of. Confirm provenance before shipping.

## Worked example — Wake mode (the case this skill was built from)

- `openWakeWord` package: **Apache-2.0** code ✅ — but its pre-trained models are
  **CC BY-NC-SA 4.0** (NonCommercial). The Apache link attributes the *code only*.
- `Silero VAD` (MIT) + `@ricky0123/vad-web` (ISC) — frontend, permissive ✅, covered
  by `third-party-licenses.txt` + a LICENSE bullet.
- `hey_quiet_box.onnx` (checked in) — needs a sidecar README: self-trained →
  Apache-2.0 ✅; derived from an openWakeWord model → inherits CC BY-NC-SA 🛑.
- Smell: code that `download_models([...])` an NC-licensed asset at runtime onto a
  deployed box even when only the Apache-2.0 preprocessing models are used — fetch
  only what you use, or document it.

## Wiring into GitHub Actions (when ready)

Run the gate on `pull_request` (mirror the triggers in
`.github/workflows/backend-license-checker.yml`). The runner needs node for the
frontend check:

```yaml
# license-attribution.yml (sketch)
on:
  pull_request:
    branches: [main, staging, dev]
    types: [opened, reopened, synchronize]
jobs:
  attribution:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }            # need base ref for --check-new-deps
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cd app/frontend && npm ci       # installs pinned generate-license-file@4.0.0
      - run: python3 dev-tools/check_license_attribution.py --base "origin/${{ github.base_ref }}"
```

To "tag this skill to run" in Actions (judgment review on the diff, beyond the
deterministic gate), invoke Claude Code headless in a job step, e.g.
`claude -p "/license-attribution-compliance review this PR's dependency changes"`,
after checkout — keep the deterministic gate as the always-on blocking check.
