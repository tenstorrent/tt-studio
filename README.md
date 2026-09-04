[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/tenstorrent/tt-studio)

<p align="center">
  <img src="https://raw.githubusercontent.com/tenstorrent/tt-metal/main/docs/source/common/images/favicon.png" width="120" height="120" />
</p>

<h1 align="center">TT-Studio</h1>

> A web UI for deploying and chatting with AI models on Tenstorrent hardware. It wraps [TT Inference Server](https://github.com/tenstorrent/tt-inference-server) packaging and [TT-Metal](https://github.com/tenstorrent-metal/tt-metal) execution behind a Django + React + agent stack.

> **No Tenstorrent hardware?** You can still use it — point it at [remote endpoints](dev-docs/remote-endpoint-setup.md) running on cards elsewhere.


---

## Table of Contents

- [Before you start](#before-you-start)
- [Quickstart](#quickstart)
- [Documentation](#documentation)
- [Community & License](#community--license)

---

## Before you start

You'll need:

- **Python 3.8+** and **Docker** installed
- Your user in the `docker` group so you don't need `sudo` — `sudo usermod -aG docker $USER`, then log out and back in
- A **Hugging Face token** for any gated models you want to run (Llama, etc.)
- First time on Tenstorrent hardware? Do the [Getting Started Guide](https://docs.tenstorrent.com/getting-started/README.html) first.

Full prerequisites are in the [detailed setup guide](dev-docs/detailed-setup.md#prerequisites).

---

## Quickstart

```bash
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio
python3 run.py
```

`run.py` handles the rest — the tt-inference-server artifact, your `.env`, the right Docker overlays for your hardware, and all the containers. It asks for your Hugging Face token along the way. When it finishes, open **[http://localhost:3000](http://localhost:3000)**.

A few flags are worth knowing:

- **`python3 run.py --dev`** — development mode: mounts your local source so the backend and frontend hot-reload as you edit.
- **`python3 run.py --purge-all`** — tear everything down and wipe the persistent volume and `.env` for a clean slate. (Use `--stop` instead to stop the containers but keep your data.)
- **`python3 run.py --report-bug`** — bundle your logs into a ZIP and draft a pre-filled support email to support@tenstorrent.com — attach the ZIP and send (also offered automatically if setup errors out).
- **`python3 run.py --install-shortcut`** — add a `tt-studio` shell shortcut so you can launch from any directory without typing `python run.py`.

Hardware is auto-detected. On a **QB2 (QuietBox)** you can set `IS_QB2=true` in `.env` to have startup verify the board via tt-smi; it's off by default so dev laptops and cloud runs aren't held to that check. See the [run.py guide](dev-docs/run-py-guide.md) for the full behavior. Run `python run.py --help` for all flags and `python run.py --help-env` for every environment variable.

That's all most people need. Everything else — hardware modes, environment variables, the dev workflow, remote access, and troubleshooting — lives in the **[detailed setup guide](dev-docs/detailed-setup.md)**.

---

## Documentation

- **[Detailed setup & usage](dev-docs/detailed-setup.md)** — hardware modes, env vars, dev workflow, remote access, troubleshooting
- [run.py reference](dev-docs/run-py-guide.md) — every flag and environment variable, explained
- [Troubleshooting](dev-docs/troubleshooting.md) and [FAQ](dev-docs/FAQ.md)
- [Remote endpoints](dev-docs/remote-endpoint-setup.md) — use TT-Studio without local hardware
- [Contributing](CONTRIBUTING.md) — branching strategy and PR standards

---

## Community & License

- **Issues / feature requests** — [GitHub Issues](https://github.com/tenstorrent/tt-studio/issues)
- **Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md)
- **License** — Apache-2.0 (© Tenstorrent AI ULC)
