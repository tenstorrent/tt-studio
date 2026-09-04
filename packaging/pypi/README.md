# TT Studio

Web interface for running AI models on [Tenstorrent](https://tenstorrent.com)
hardware. This package is a small installer/launcher: it keeps a managed copy
of [tenstorrent/tt-studio](https://github.com/tenstorrent/tt-studio) under
`~/.tt-studio/checkout`, pinned to the latest GitHub release, and runs it.

## Install

```bash
pipx install tt-studio   # recommended (isolated)
# or
pip install tt-studio
```

Requires Python ≥ 3.12, git, and Docker. Full local deployment needs a
Tenstorrent accelerator; the frontend can also run against remote endpoints.

## Use

```bash
tt-studio            # first run installs the latest release, then starts the stack
tt-studio --stop     # every run.py flag passes through
tt-studio --logs
```

On each launch the shim checks GitHub for a newer release and updates the
managed checkout automatically (offline runs use the installed version).

Shim-specific flags:

- `--no-update` — skip the update check for this launch
- `--pin vX.Y.Z` — stay on a specific release (`--pin latest` to unpin)
- `--shim-version` — print the shim's own version
- `TT_STUDIO_HOME` — move the managed root (default `~/.tt-studio`)

Developing TT Studio itself? Clone the repo and use `python run.py` — the shim
never touches clones it didn't create.

## Links

- Source & docs: https://github.com/tenstorrent/tt-studio
- Issues: https://github.com/tenstorrent/tt-studio/issues
