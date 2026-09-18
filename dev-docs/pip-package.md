# The `tt-studio` pip package

`pip install tt-studio` installs a small shim (source: `packaging/pypi/`) —
not the launcher itself. The launcher is checkout-bound (compose files,
`.env.default`, `inference-api/`, `docker-control-service/`, and git metadata
all live at `TT_STUDIO_ROOT`), so the shim manages a real git clone and hands
off to it.

## How it works

On every `tt-studio` invocation the shim:

1. Ensures a managed clone exists at `~/.tt-studio/checkout` (override the
   root with `TT_STUDIO_HOME`). The first run clones the repo detached at the
   **latest GitHub release tag** and drops a `.tt-studio-managed` marker file.
2. Asks `api.github.com/repos/tenstorrent/tt-studio/releases/latest` for the
   newest tag. If the checkout is on an older tag, it fetches and checks out
   the new tag silently, printing one line (`tt-studio: updated vA.B.C → vX.Y.Z`).
   Offline or rate-limited → it runs whatever is installed; only the first run
   needs the network.
3. `chdir`s into the checkout, sets `TT_STUDIO_MANAGED=1`, and `exec`s
   `run.py` with all remaining arguments. From there everything is the normal
   launcher: its own bootstrap venv, GHCR image pulls (the tag-detached clean
   clone makes `git describe --tags --exact-match` resolve the release, so
   `tt_setup/image_source.py` pulls the matching prebuilt images), health
   checks, etc.

Shim-owned flags (stripped before passthrough): `--no-update`,
`--pin <tag>` / `--pin latest`, `--shim-version`. Everything else goes to
`run.py` unchanged.

## Safety rules baked into the shim

- It never mutates a checkout without the `.tt-studio-managed` marker — a
  developer clone is never touched, even if pointed at via `TT_STUDIO_HOME`.
- A dirty managed checkout skips the update with a warning (same guard as
  `run.py --switch`).
- If the managed checkout is on a named branch (someone ran `--switch dev`
  inside it), auto-update pauses until it's back on a release tag.
- `TT_STUDIO_MANAGED=1` also suppresses the launcher's shell-function
  shortcut offer/repair (`tt_setup/shortcut.py`) — the rc function would
  shadow the pip console script and hijack it to the managed root.

## Publishing

`.github/workflows/publish-pypi.yml` runs on every `v*` tag push (the release
CLI pushes tags from a maintainer machine, so the workflow fires). It stamps
the tag version into `packaging/pypi/pyproject.toml` and
`src/tt_studio/__init__.py`, builds the sdist/wheel, and uploads via PyPI
**trusted publishing** (OIDC, `environment: pypi`, no stored token).
`workflow_dispatch` does a dry-run build without uploading.

One-time admin setup before the first publish: create the `tt-studio` project
on pypi.org and register `tenstorrent/tt-studio` + `publish-pypi.yml` as a
trusted publisher (add a `pypi` environment in the repo settings if it doesn't
exist).

The shim itself rarely changes; publishing every release just keeps the PyPI
version in lockstep with the GitHub release. Users don't need
`pip install -U tt-studio` for new TT-Studio releases — the managed checkout
updates itself.

## Tests

`tests/test_pip_shim.py` (part of the normal launcher suite) unit-tests the
decision table (`plan_action`), the tolerant release lookup, flag splitting,
and the pin file. The shim imports from `packaging/pypi/src` directly — it is
not installed by the root `pip install .`.
