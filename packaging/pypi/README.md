# TT Studio

Web interface for running AI models on [Tenstorrent](https://tenstorrent.com)
hardware. It wraps [TT Inference Server](https://github.com/tenstorrent/tt-inference-server)
packaging and [TT-Metal](https://github.com/tenstorrent/tt-metal) execution
behind a Django + React + agent stack, deployed with Docker.

## Install

```bash
pipx install tt-studio   # recommended (isolated)
# or
pip install tt-studio
```

Requires Python 3.12+ and Docker (with your user in the `docker` group). Full
local deployment needs a Tenstorrent accelerator; the web UI can also run
against remote inference endpoints with no local hardware.

## Use

```bash
tt-studio               # set up and start the stack, then open http://localhost:3000
tt-studio run <model>   # start the stack and deploy a model from the terminal
tt-studio --stop        # stop the containers (keeps your data)
tt-studio --help        # every option
```

The package carries the whole application. On first run — and after each
upgrade — `tt-studio` copies its app files into `~/.tt-studio` (set
`TT_STUDIO_HOME` to use another folder), which also holds your `.env`, logs
and downloaded models. Prebuilt container images matching the installed
version are pulled from `ghcr.io/tenstorrent/tt-studio`.

## Upgrade or uninstall

```bash
pipx upgrade tt-studio                  # or: pip install -U tt-studio
pipx install tt-studio==X.Y.Z --force   # pin a specific release
tt-studio --uninstall && pipx uninstall tt-studio
```

`tt-studio` tells you at startup when a newer release is on PyPI.

## Links

- Source & docs: https://github.com/tenstorrent/tt-studio
- Issues: https://github.com/tenstorrent/tt-studio/issues

Developing TT Studio itself? Clone the repository and use `python run.py`
(including `--dev` for hot reload) — see the
[setup guide](https://github.com/tenstorrent/tt-studio/blob/main/dev-docs/detailed-setup.md).
