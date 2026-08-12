# Using `run.py` - Complete Guide

The `run.py` script automates the complete TT-Studio setup process, including environment configuration, Docker services, and the TT Inference Server setup.

## Table of Contents
1. [Basic Usage](#basic-usage)
2. [Command-Line Options](#command-line-options)
3. [Quick Setup (Default)](#quick-setup-default)
4. [Environment Configuration](#environment-configuration)
5. [Automatic Tenstorrent Hardware Detection](#automatic-tenstorrent-hardware-detection)
6. [Authentication Requirements](#authentication-requirements)
7. [Common Operations](#common-operations)

---

## Basic Usage

To use the setup script, run:

```bash
python run.py [options]
```

The script will guide you through all configuration options and set up everything automatically. You'll be prompted to provide:
- JWT_SECRET for authentication
- HF_TOKEN (Hugging Face token) for accessing models
- DJANGO_SECRET_KEY for backend security
- TAVILY_API_KEY for search functionality (optional)
- Other optional configuration options

---

## Command-Line Options

The options below mirror `python run.py --help` exactly, grouped by the same help
panels. Run with no flags for the default minimal setup; every flag is optional.

### Setup & Configuration

| Option | Description |
| --- | --- |
| `--help`, `-h` | Display the help message with all options grouped by panel. |
| `--dev` | Development mode: hot-reload frontend & backend, mount source, offer suggested defaults. Also skips the release-branch sync requirement (see below), so a checkout behind `origin/main`/`origin/dev` still starts. |
| `--configure-env` | Interactively configure **all** environment variables (secrets, modes, cloud endpoints). |
| `--reconfigure-inference-server` (alias `--reconfig-inf`) | Reconfigure the TT Inference Server artifact (version/branch selection). Prompts only for the artifact source; verifies the release tag / branch / commit exists upstream before accepting it. |
| `--install-shortcut` | Add a `tt-studio` shell shortcut (a function in your `~/.zshrc` / `~/.bashrc`) so you can launch from any directory without typing `python run.py`. |
| `--switch REF` | Switch this checkout to a git branch or tag (e.g. `dev`, `v2.9.0-rc1`): fetches origin, checks the ref out (fast-forwarding branches), then exits — re-run to start on that version. Refuses if you have uncommitted changes. |

### Model Deployment

| Option | Description |
| --- | --- |
| `--auto-deploy MODEL_NAME` | Auto-deploy the given model once the stack is up. |
| `--device-id CHIP_ID` | Chip slot index (0–7) to target with `--auto-deploy` (default `0`). |

> **⚠️ Not yet available**: `--auto-deploy` (and its `--device-id`) is a
> **work in progress and not fully developed**. The launcher currently only
> forwards the request to the frontend as a URL parameter
> (`?auto-deploy=<model>&device-id=<id>`); end-to-end automatic deployment is not
> functional yet. Deploy models from the UI for now. This flag and note will be
> updated once the feature lands.

### Lifecycle

| Option | Description |
| --- | --- |
| `--stop` | Stop TT Studio: tear down Docker containers and networks, keep the persistent volume. (Deprecated alias: `--cleanup`.) |
| `--status` | Open the live monitor TUI for a running stack (health, ports, hardware). |
| `--logs` | Stream all container logs (`docker compose logs -f`). Wires up `--env-file` so there are no "variable is not set" warnings; add `--dev` to match a dev bring-up. |
| `--info` | Re-show the "TT Studio is ready" summary panel (URLs, mode, classified hardware) from live probes — handy after the banner has scrolled away. |

### Reset

| Option | Description |
| --- | --- |
| `--purge-all` | Stop and wipe **everything** including the persistent volume, TT Studio's HuggingFace-cached model weights, and `.env`. (Deprecated alias: `--cleanup-all`.) |
| `--yes`, `-y` | Skip the `--purge-all` confirmation prompt (for non-interactive/scripted runs). |
| `--uninstall` | Full uninstall: run the `--purge-all` teardown **and** remove the `tt-studio` shell shortcut from your shell config. Declining the confirmation leaves both untouched. |

### Advanced

| Option | Description |
| --- | --- |
| `--reconfigure` | Reset saved preferences and reconfigure all options from scratch. |
| `--resync` | Force a resync of the model catalog. |
| `--pull-branch` | Re-download the inference artifact from its configured branch/SHA. |
| `--build-images` | Build the container images locally instead of pulling prebuilt ones from ghcr.io. By default `run.py` pulls the images CI published for the exact checkout (release tag, else `sha-<12>`) and falls back to a local build automatically when they aren't available (feature branch, local changes, offline, custom frontend config). |
| `--skip-fastapi` | Skip TT Inference Server FastAPI setup (see the note below). |
| `--skip-docker-control` | Skip starting the Docker Control Service (port 8002). |
| `--no-sudo` | Skip sudo usage for FastAPI setup (may limit functionality). |
| `--no-browser` | Don't open the frontend in a browser automatically. |
| `--wait-for-services` | Block until all services report healthy before returning. |
| `--browser-timeout N` | Seconds to wait for the frontend before opening the browser (default `60`). |

### Developer Tools

| Option | Description |
| --- | --- |
| `--add-headers` | Add missing SPDX license headers (excludes frontend). |
| `--check-headers` | Report files missing SPDX license headers (no changes). |

### Troubleshooting & Info

| Option | Description |
| --- | --- |
| `--help-env` | Show detailed help for environment variables. |
| `--report-bug` | Collect a diagnostics bundle (`logs/tt-studio-logs-ttbr-*.zip`) and open a pre-filled GitHub issue. |
| `--verbose`, `-v` | Show full per-phase output instead of the calm summary (see [Verbose & calm output](#verbose--calm-output)). |
| `--no-clear` | Don't clear the terminal at startup — keep whatever was already on screen and stream the full per-phase detail. Like `--verbose`, but it also preserves your scrollback. |

> **Important**: The `--skip-fastapi` option disables chat-based language models (LLMs) functionality. Only computer vision models (YOLO), image generation models (Stable Diffusion), and speech recognition models (Whisper) will be available for deployment and inference.

> **AI Playground Mode**: To use TT-Studio as a frontend for all model types (LLMs, YOLO, Whisper, Stable Diffusion), set `VITE_ENABLE_DEPLOYED=true` in your `.env` file and configure the corresponding model endpoints. See the [Model Interface Guide](../dev-docs/model-interface.md) for details.

To display the same help section in the terminal, run:

```bash
python run.py --help
```

### Verbose & calm output

By default the launcher runs in **calm mode**: each setup phase (environment,
inference artifact, Docker services, health checks) collapses to a single
summary line with a ✓/⚠/⛔ status, so the terminal stays readable and you see the
overall shape of the run at a glance. A sticky header keeps the current phase
pinned while output scrolls.

When something goes wrong — or you just want to watch every command — add
`--verbose` (or `-v`):

```bash
python run.py --verbose
```

This streams the full per-phase output (Docker build logs, artifact download,
sudo/FastAPI steps) instead of the collapsed summary. Reach for it first when a
phase reports ⚠ or ⛔ and you want the underlying error. For a run that already
finished, `--logs` and `--status` (below) are the equivalent live views, and
`--report-bug` bundles the logs for you.

To watch every step **without** losing whatever is already in your terminal, use
`--no-clear`. It implies `--verbose` (full per-phase output) and additionally
never clears the screen, so the calm sticky-header splash is skipped and your
existing scrollback stays put:

```bash
python run.py --no-clear
```

> The design of the calm output (phase stepper, sticky header, status glyphs) is
> documented in [Launcher terminal design](launcher-terminal-design.md) — read
> that before changing anything the launcher prints.

---

## Quick Setup (Default)

Running `python run.py` with no extra flags performs a streamlined setup designed for first-time users, quick testing, and development environments. It minimizes the configuration prompts and uses sensible defaults for everything except the Hugging Face token. To interactively configure every environment variable instead, use [`--configure-env`](#full-interactive-configuration).

### When the Default Setup Is Appropriate

**✅ Good for:**
- First-time exploration of TT-Studio
- Quick testing and evaluation
- Development and debugging
- Local prototyping
- Learning how TT-Studio works

**❌ Not appropriate for:**
- Production deployments
- Public-facing services
- Environments with sensitive data
- Production model serving

For those cases, use `--configure-env` and supply your own secure values.

### How the Default Setup Works

The default setup simplifies things by:

1. **Minimal Prompting**: Only prompts for your HF_TOKEN (Hugging Face token)
2. **Automatic Defaults**: Uses pre-configured default values for all other settings
3. **Faster Setup**: Skips local npm installation automatically
4. **TT Studio Mode**: Automatically configures for TT Studio mode (not AI Playground)
5. **Saves Configuration**: Stores settings in `.tt_studio_setup_config.json` for reference

### Usage

```bash
python3 run.py
```

You'll only be prompted for:
- **HF_TOKEN**: Your Hugging Face token (required for downloading models)

All other values are set automatically using defaults.

### Default Values Used

The default setup uses the following values:

| Variable | Default Value | Description |
|----------|---------------|-------------|
| `JWT_SECRET` | `test-secret-456` | JWT authentication secret (not secure) |
| `DJANGO_SECRET_KEY` | `django-insecure-default` | Django backend security key (not secure) |
| `TAVILY_API_KEY` | `tavily-api-key-not-configured` | Search functionality (disabled) |
| `VITE_APP_TITLE` | `Tenstorrent \| TT Studio` | Application title |
| `VITE_ENABLE_DEPLOYED` | `false` | AI Playground mode (disabled - uses TT Studio mode) |
| `VITE_ENABLE_RAG_ADMIN` | `false` | RAG admin interface (disabled) |
| `RAG_ADMIN_PASSWORD` | `tt-studio-rag-admin-password` | Default admin password |
| `FRONTEND_HOST` | `localhost` | Frontend host |
| `FRONTEND_PORT` | `3000` | Frontend port |
| `FRONTEND_TIMEOUT` | `60` | Frontend timeout (seconds) |
| Cloud Model Variables | Empty strings | All cloud/external model endpoints (disabled) |
| npm Installation | Automatically skipped | Local IDE support (skipped) |

> **⚠️ CRITICAL SECURITY WARNING**: The default values above are **NOT secure for production use**. They are intended only for development, testing, and quick evaluation. Never use these defaults for production deployments or public-facing services — use `--configure-env` and provide secure values instead.

### Configuration File

The default setup saves a snapshot of your setup to `.tt_studio_setup_config.json` in the repository root. This file contains:

- Setup timestamp
- Mode indicator (`"mode": "quick"`)
- Record of default values used
- Configuration flags

This file is for reference only and does not affect the actual runtime configuration (which is stored in the repo-root `.env`).

### Full Interactive Configuration

To configure every environment variable yourself — secrets, application modes, and cloud endpoints — run:

```bash
python3 run.py --configure-env
```

This is the path to use for production-ready or public-facing setups where the insecure defaults above are not acceptable.

### Mode Comparison

Here's how the setup paths compare:

| Feature | Default<br>`python run.py` | Full Config<br>`--configure-env` | Development<br>`--dev` |
|---------|----------------------------|----------------------------------|------------------------|
| **Primary Use** | First-time users, quick testing | Production deployments | Development work |
| **Prompts Required** | HF_TOKEN only | All security credentials | HF_TOKEN only (use `--dev --configure-env` for full interactive prompts) |
| **Security** | ⚠️ Insecure defaults | ✅ User-provided secure values | ⚠️ Dev defaults available |
| **AI Playground** | Disabled | User choice | User choice |
| **RAG Admin** | Disabled | User choice | User choice |
| **Cloud Models** | Empty/disabled | User choice | User choice |
| **npm Installation** | Auto-skipped | User choice | User choice |
| **Setup Time** | Fastest (~1 minute) | Moderate (~5 minutes) | Moderate (~5 minutes) |
| **Production Ready** | ❌ No | ✅ Yes | ❌ No |

### Example: Default Setup

```bash
# Clone the repository
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio

# Run the default setup
python3 run.py

# You'll only see:
# 🤗 Enter HF_TOKEN (Hugging Face token): ****

# That's it! Everything else is configured automatically.
```

### Switching from the Default Setup to Production

If you started with the default setup and want to switch to a production-ready setup:

1. **Stop TT-Studio** (if running):
   ```bash
   python3 run.py --stop
   ```

2. **Reconfigure with secure values**:
   ```bash
   python3 run.py --configure-env
   ```
   
   Or use the reconfigure flag to reset preferences first:
   ```bash
   python3 run.py --reconfigure --configure-env
   ```

3. **Provide secure credentials** when prompted:
   - Generate a strong JWT_SECRET
   - Generate a strong DJANGO_SECRET_KEY
   - Configure other services as needed

4. **Restart TT-Studio** with the new secure configuration

---

## Environment Configuration

The `run.py` script manages environment configuration through the `.env` file located at the repo root. During setup, it uses the repo-root `.env.default` as a template with placeholder values that are replaced with your inputs.

### Default Environment Template

The default environment template (`.env.default`) contains the following structure:

```
# TT Studio Environment Configuration
# This file contains default/placeholder values that will be replaced during setup

# Core Application Paths (auto-configured)
TT_STUDIO_ROOT=<PATH_TO_ROOT_OF_REPO>
HOST_PERSISTENT_STORAGE_VOLUME=${TT_STUDIO_ROOT}/tt_studio_persistent_volume
INTERNAL_PERSISTENT_STORAGE_VOLUME=/tt_studio_persistent_volume
BACKEND_API_HOSTNAME=tt-studio-backend-api

# Security Credentials (REQUIRED - keep secret in production!)
JWT_SECRET=test-secret-456
DJANGO_SECRET_KEY=django-insecure-default
HF_TOKEN=hf_***

# Optional Services
TAVILY_API_KEY=tvly-xxx

# Application Configuration
VITE_APP_TITLE="TT Studio"

# Application Modes (true or false)
VITE_ENABLE_DEPLOYED=false
VITE_ENABLE_RAG_ADMIN=false

# RAG Configuration (required if VITE_ENABLE_RAG_ADMIN=true)
RAG_ADMIN_PASSWORD=tt-studio-rag-admin-password

# Cloud/External Model APIs (only used when VITE_ENABLE_DEPLOYED=true)
# Chat UI
CLOUD_CHAT_UI_URL=
CLOUD_CHAT_UI_AUTH_TOKEN=

# Computer Vision
CLOUD_YOLOV4_API_URL=
CLOUD_YOLOV4_API_AUTH_TOKEN=

# Speech Recognition
CLOUD_SPEECH_RECOGNITION_URL=
CLOUD_SPEECH_RECOGNITION_AUTH_TOKEN=

# Image Generation
CLOUD_STABLE_DIFFUSION_URL=
CLOUD_STABLE_DIFFUSION_AUTH_TOKEN=
```

### Configuration Process

When you run `python run.py`, the script:

1. **Checks for an existing `.env` file**:
   - If none exists, it creates one from `.env.default`
   - If one exists, it asks whether to keep existing values or reconfigure all

2. **Prompts for required values**:
   - Replaces placeholder values with your inputs
   - In development mode (`--dev`), offers sensible defaults
   - Securely handles sensitive information like tokens and passwords

3. **Handles special configuration modes**:
   - Configures AI Playground mode when `VITE_ENABLE_DEPLOYED=true`
   - Sets up RAG admin interface when `VITE_ENABLE_RAG_ADMIN=true`
   - Configures cloud model endpoints when in AI Playground mode

### Environment Variables Reference

| Category | Variable | Description | Required |
|----------|----------|-------------|----------|
| **Core Paths** | TT_STUDIO_ROOT | Repository root path | Auto-configured |
| | HOST_PERSISTENT_STORAGE_VOLUME | Host storage path | Auto-configured |
| | INTERNAL_PERSISTENT_STORAGE_VOLUME | Container storage path | Auto-configured |
| | BACKEND_API_HOSTNAME | Backend API hostname | Auto-configured |
| **Security** | JWT_SECRET | JWT authentication secret | Yes |
| | DJANGO_SECRET_KEY | Django security key | Yes |
| | HF_TOKEN | Hugging Face API token | Yes |
| | TAVILY_API_KEY | Tavily search API key | Optional |
| **Application** | VITE_APP_TITLE | Application title | Yes |
| | VITE_ENABLE_DEPLOYED | Enable AI Playground mode | Yes |
| | VITE_ENABLE_RAG_ADMIN | Enable RAG admin interface | Yes |
| | RAG_ADMIN_PASSWORD | RAG admin password | If RAG enabled |
| **Hardware** | IS_QB2 | Opt-in QB2 board verification (see below) | Optional (default off) |
| **Inference Artifact** | TT_INFERENCE_ARTIFACT_VERSION | Pinned tt-inference-server release to download | Auto-configured |
| | TT_INFERENCE_ARTIFACT_BRANCH | Dev override: fetch a branch/SHA instead of a release | Optional |
| | TT_QB2_LAUNCH_BRANCH | Artifact branch for the QB2 launch (branch selection only) | Optional |
| **Cloud Models** | CLOUD_*_URL | Model endpoint URLs | If AI Playground enabled |
| | CLOUD_*_AUTH_TOKEN | Model authentication tokens | If AI Playground enabled |

To view detailed help about environment variables, run:
```bash
python run.py --help-env
```

---

## Automatic Tenstorrent Hardware Detection

The startup script now automatically detects Tenstorrent hardware by checking for `/dev/tenstorrent`. When hardware is detected:

1. The appropriate Docker configuration is applied automatically
2. Container access to hardware is configured
3. A confirmation message is displayed during startup

Detection is fully automatic — there is no flag to toggle it. (Earlier versions
had a `--tt-hardware` flag; it has been removed.)

> ⚠️ **Note**: Tenstorrent hardware is now automatically detected and enabled. The script will automatically mount `/dev/tenstorrent` when present, eliminating the need for manual configuration.

### QB2 hardware verification (`IS_QB2`)

QB2 (Blackhole QuietBox, `P300x2`) verification is **opt-in and off by default**,
so a dev laptop, cloud mode, or a different board is never held to the strict
check. Set `IS_QB2=true` in `.env` **only on an actual QB2** to have startup
verify the board with `tt-smi`. (The `tt_qb2_launch` release branch ships with it
set — see [CONTRIBUTING.md](../CONTRIBUTING.md) → Release Process.)

When `IS_QB2=true`, startup behaves as follows:

| tt-smi state | Result |
|---|---|
| Confirms a QB2 (`P300x2`) | ✓ proceeds — ready panel shows `QuietBox (QB2)` |
| Reports a **different** board | ⚠ non-fatal warning (likely misconfigured), proceeds |
| **Installed but can't read the chips** (real TT tooling present) | ⛔ **stops** at Checks — fix your tooling, or set `IS_QB2=false` |
| **Not installed** (`tt-smi` not on PATH) | ⚠ can't verify from the CLI — warns and **proceeds with caution** |
| No TT tooling at all (no `tt-smi`, no `/dev/tenstorrent`) | check skipped; panel shows "No accelerator" |

When `IS_QB2` is unset (the default), the whole verification path is skipped —
startup is never blocked or warned on hardware grounds.

`IS_QB2` is independent of `TT_INFERENCE_ARTIFACT_BRANCH` / `TT_QB2_LAUNCH_BRANCH`,
which only select which inference-server build to download.

### Release-branch sync check

At the Checks phase, startup compares your checkout against the same branch on
GitHub. What happens when you're behind depends on the branch:

| Checked-out branch | Behind `origin` | Result |
|---|---|---|
| Release (`main`, `dev`, `tt_qb2_launch_branch`, `rc/*`, `release/*`) | yes | ⛔ **stops** — `git pull` and re-run, **or** use `--dev` |
| Any of the above, with `--dev` | yes | proceeds; note shown under `--verbose` |
| Feature branch (e.g. `you/your-feature`) | yes | proceeds; note shown under `--verbose` |
| Any branch | no | proceeds silently (✓ under `--verbose`) |

`--dev` opts out because dev mode exists for iterating on local work — refusing
to start there would block exactly the people who need the stack running while
their branch is behind. Offline or unreachable GitHub is never a failure; the
check is skipped with a muted note.

---

## Authentication Requirements

When running the startup script, you'll need to provide the following credentials:

### 1. JWT_SECRET
A secret key used for JWT token authentication.
- This is required for secure API communication between components.
- You can use any strong secret string of your choice.

### 2. HF_TOKEN
Your Hugging Face API token.
- Required for downloading models from the Hugging Face Hub.
- Obtain this token by signing up at [Hugging Face](https://huggingface.co/settings/tokens).
- Make sure your token has appropriate permissions to access the models you need.

### 3. DJANGO_SECRET_KEY
- Used by the Django backend for cryptographic operations.
- Automatically generated if not provided.

### 4. TAVILY_API_KEY
- Required for web search capabilities in AI agents.
- You can obtain a free key from [Tavily](https://tavily.com/).

### 5. Sudo Access
- The FastAPI server requires sudo privileges to run on port 8001.
- You'll be prompted for your sudo password during startup.
- This is necessary for proper communication between components and hardware access.

These credentials are securely used by the TT Inference Server to authenticate requests, access model repositories, and interact with hardware when available.

---

## Common Operations

### Starting TT-Studio
```bash
python run.py
```

### Full Interactive Configuration
```bash
python run.py --configure-env
```

### Running in Development Mode
```bash
python run.py --dev
```

### Stopping and Cleaning Up
```bash
python run.py --stop
```

### Complete Cleanup (including data)
```bash
python run.py --purge-all
```

### A Shorter Command (`tt-studio`)
```bash
python run.py --install-shortcut
```
Adds a `tt-studio` shell function to your `~/.zshrc` / `~/.bashrc` that runs the
launcher from the repo no matter which directory you're in (it `cd`s in a
subshell, so your current directory is untouched). Reopen your terminal (or
`source` your rc), then use `tt-studio`, `tt-studio --dev`, `tt-studio --stop`,
etc. The first time you launch without the shortcut installed, TT-Studio also
offers to set it up for you (once). Bash/zsh are handled automatically; other
shells get a snippet to paste.

The shortcut bakes in the repo path it was installed from. If you move the repo
or start launching from a different clone, the next normal startup re-points the
shortcut to that checkout automatically (a one-line notice tells you when it
does).

### Switching Versions
```bash
python run.py --switch dev          # a branch
python run.py --switch v2.9.0-rc1   # a release tag / RC
```
Fetches origin and checks out the given branch (fast-forwarded to origin) or tag
(detached HEAD), then exits — re-run `python run.py` (or `tt-studio`) to start on
that version. It refuses to run if your checkout has uncommitted changes, and if
TT-Studio is currently running you should `--stop` and start again so the stack
matches the new code.

### Uninstalling
```bash
python run.py --uninstall
```
Runs the full `--purge-all` teardown (containers, volumes, `.env`, artifacts) and
then removes the `tt-studio` shell function from your shell config. One
confirmation covers both; answering no leaves everything in place.

### Reporting a Bug
```bash
python run.py --report-bug
```
Collects the available host-side logs (startup, model-run, docker-control) plus a
non-secret system snapshot into `logs/tt-studio-logs-ttbr-*.zip` and opens a
pre-filled GitHub issue in your browser — attach the ZIP to that issue. The
bundle never includes your `.env` (only whether it exists). If `python run.py`
itself errors, it offers the same flow interactively from the "Next steps" panel.

### Running on Remote Machine
To forward traffic between your local machine and a remote server, enabling you to access the frontend application in your local browser:

```bash
# Port forward frontend (3000) and FastAPI (8001) to allow local access from the remote server
ssh -L 3000:localhost:3000 -L 8001:localhost:8001 <username>@<remote_server>
```

---

For troubleshooting issues with `run.py`, please refer to our [Troubleshooting Guide](troubleshooting.md). 