# TT-Studio Desktop

Tauri v2 desktop shell for TT-Studio. A small bundled launcher UI (Vite +
React + TypeScript + Tailwind, mirroring `app/frontend`'s stack) whose window
navigates to a running TT-Studio stack at `http://localhost:3000`.

The web deployment at the repo root is unaffected by this directory.

## Architecture

Single window, two phases:

1. **Launcher** — the bundled UI in `src/` loads from Tauri's own origin
   (`tauri://localhost` / `http://tauri.localhost`). It has one job: offer an
   "Open TT-Studio" button.
2. **Stack** — clicking the button invokes the `open_stack(url)` Tauri command
   (`src-tauri/src/commands.rs`), which validates the URL (http/https on
   `localhost`/`127.0.0.1` only) and navigates the *same* WebviewWindow to
   `http://localhost:3000`.

The real TT-Studio frontend is **never bundled** into the app. It must load
from its own `http://localhost:3000` origin because the web app derives API
and WebSocket URLs from `window.location` — serving it from a bundled
`file://`/`tauri://` origin would break those.

### Security

`src-tauri/capabilities/default.json` grants IPC to the bundled launcher
origin only (`core:default`). The remote `http://localhost:3000` origin is
deliberately granted **no** capabilities — once the window navigates to the
stack, the page has no Tauri IPC access at all. The only bridge back into the
shell is the URL validation in `open_stack`, which runs before navigation.

## Running

Prerequisites: Node 22+, Rust (stable, via rustup), and on Linux the WebKitGTK
stack (`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
librsvg2-dev libxdo-dev libssl-dev`).

```bash
cd desktop
npm install
npm run tauri dev        # launcher with hot reload (vite on :1420)
npm run tauri build      # release build + bundles
```

Start the TT-Studio stack separately (`python run.py` at the repo root) so
`http://localhost:3000` is live before clicking "Open TT-Studio".

## Updates

Two layers, both keyed to tagged GitHub releases of tenstorrent/tt-studio.
Release tags (`v*`) are the source of truth for both: they're the only refs
`.github/workflows/publish-images.yml` publishes GHCR images for, so
following raw `main`/`dev` would force local image builds.

### Shell updates (the app itself)

The tauri updater plugin checks the `latest.json` asset on the latest GitHub
release (endpoint in `src-tauri/tauri.conf.json`). The launcher checks once
on launch — silently, so being offline never gets in the way of connecting —
and offers a manual "Check for updates" button whose failures are shown
(`src/views/UpdateBanner.tsx`). Installing downloads, applies, and relaunches
via the process plugin.

**Signing key**: the `pubkey` in `tauri.conf.json` is a development
placeholder — a real keypair must be generated **once, by a maintainer**
(`npm run tauri signer generate`; never commit the private key). The private
key + password go into the repo secrets `TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and the matching public key replaces
the placeholder here. Release CI (`.github/workflows/desktop-release.yml`)
then signs the updater artifacts and attaches them + `latest.json` to each
release. Until the real key lands, the updater rejects downloaded artifacts
(signature mismatch) — by design, it fails closed.

### Stack updates (the checkout `run.py` runs in)

Before every bring-up — local spawn or SSH — the app compares the target
checkout's release tag against the latest `v*` tag
(`src-tauri/src/update/stack.rs`) and, when behind, runs the stack's own
guarded `python run.py --switch <tag>` there. Policy is a user setting
(auto / ask first / never, default ask) stored with the app settings.

Behavior at the edges:

- **Dirty checkout** (tracked changes): `--switch` refuses dirty trees, and
  the app never forces or resets — it shows "developer checkout detected,
  skipping stack update" and proceeds with the current version.
- **Not on a release tag** (branch or detached sha): also treated as a
  developer checkout and left alone.
- **Offline / can't learn the latest tag**: skip the update, proceed to
  bring-up. Updates are best-effort; connecting is the job.
- **Attach** (stack already healthy): never updated — the checkout isn't
  switched under a running stack.
- **Images**: no explicit pull step. The bring-up after a switch pins
  `TT_STUDIO_IMAGE_TAG` to the exact tag (`tt_setup/env_config/_version.py`)
  and pulls the matching GHCR images itself (`tt_setup/cli/_run.py`).

## Session resume

The launcher records the machine it last put on screen (`src-tauri/src/session.rs`,
`settings.json` → `last_session`) and reconnects to it on the next launch:
tunnel, port check, one health probe, then the stack UI. The record is stamped
by `open_stack` — the app's one definition of "attached" — and swept again on
exit.

Two guarantees make that safe to do automatically:

- **Always cancellable.** The reconnect renders `ResumeGate`, never a blank
  wait, with Cancel and "Pick another machine" from the first frame. Turn it
  off entirely with "Reconnect on launch" in the picker footer.
- **Never mutates the remote machine.** A resume attaches or gives up. It does
  not bring a stack up (that claims hardware on a shared box for minutes), and
  it never shows the unknown-host-key prompt — a trust decision has to follow
  something the user deliberately did.

Resume is one-shot per process (`take_resume_target`). The launcher URL is
re-loaded several times in a single run — the `?quit=1` prompt, the return to
the launcher on hard tunnel loss, the tray's "Switch machine" — and a resume
that fired on each of those would reconnect to the machine whose tunnel just
died, forever.

## Quitting, and the macOS Cmd+Q path

`teardown.rs` decides what closing does (ask / minimize to tray / leave the
stack running / stop it), and every exit route now reaches that decision:

| Route | Arrives as |
|---|---|
| Window close button, Alt+F4 | `WindowEvent::CloseRequested` |
| Tray → Quit | `teardown::request_quit` |
| **macOS Cmd+Q, app menu → Quit, Dock → Quit** | our own menu item (`menu.rs`) → `request_quit` |
| Programmatic (`app.exit`, updater relaunch) | `RunEvent::ExitRequested`, always proceeds |
| Signal kill, logout, force quit | `RunEvent::Exit` — records the session, cannot prompt |

macOS needed `menu.rs` because Tauri's default menu uses muda's *predefined*
Quit, which maps to `terminate:`; tao registers only
`applicationWillTerminate:`, so that path is unpreventable and never saw
`teardown` at all. We build the menu ourselves (same shape as Tauri's default,
Edit's predefined items kept verbatim so WKWebView keeps its editing
shortcuts) with an id'd Quit item plus Window → Switch Machine (⌘⇧M). It has
to be built from `Builder::menu`: every method on a live menu hops to the main
thread and blocks for the reply, which cannot complete from inside `setup`.

## Local ports

The tunnel must bind the real port numbers (3000/8000/8001/8002/4000/8080) —
the web app derives its service URLs from `window.location` plus those fixed
ports. `port_clear.rs` therefore runs before the tunnel and frees a port when
it can positively identify what holds it:

- an `ssh` client forwarding that port — usually an editor's Remote-SSH
  session inheriting a `LocalForward` from `~/.ssh/config`, which is why
  `ssh_config.rs` collects `local_forwards`; and
- a leftover instance of this app.

Everything else — including Docker, whose listener is a proxy rather than the
container — is reported with the right remedy and left alone. The allowlist is
closed by default (`tests/port_clear.rs` asserts it), there is no automatic
SIGKILL, and every freed port is named in the UI and written to the launcher
log that `bug_report.rs` bundles.

## Machines from ~/.ssh/config

`ssh_config.rs` lists the machines the user already has configured: `Host`
lines are parsed for names (following `Include`), then each alias goes through
`ssh -G` for its effective settings, because `ssh` cannot enumerate aliases
and re-implementing its matching rules would be a bug farm. Resolution runs
with `CanonicalizeHostname=no` so nothing touches the network until the user
clicks a machine. Detected hosts are ephemeral — `profiles.json` gains a row
only on `adopt_detected_host`.

## OS matrix

| OS | Webview | Stack mode |
|---|---|---|
| Linux | WebKitGTK 4.1 | Native (local `run.py` stack) — this is the only OS where the stack itself can run locally today |
| macOS | WKWebView | SSH-client mode (remote stack) — coming in later PRs |
| Windows | WebView2 | SSH-client mode (remote stack) — coming in later PRs |

CI (`.github/workflows/desktop-ci.yml`) builds all three: `cargo fmt --check`,
`cargo clippy -- -D warnings`, `cargo test`, `npm run build`, and a debug
`tauri build --no-bundle`.

## Webview validation checklist

Per-OS smoke checks for the launcher → stack navigation path.

**Linux (WebKitGTK 2.52 / Ubuntu 24.04)** — validated 2026-08-20:

- [x] `npm ci && npm run build` produces the launcher bundle
- [x] `cargo check` / `cargo clippy -- -D warnings` / `cargo fmt --check` clean
- [x] `cargo test` — URL-validation unit tests pass (local hosts accepted;
      external hosts, `file://`, and garbage rejected)
- [x] `tauri build --debug --no-bundle` produces a runnable binary
- [x] Headless launch under Xvfb: window + WebKitGTK webview initialize and the
      app stays alive with no errors on stderr
- [ ] Interactive click-through: launcher button navigates to a live
      `http://localhost:3000` stack (needs a display + running stack)

**macOS (WKWebView)** — partially validated 2026-09-01:

- [x] `tauri build --bundles dmg` produces a runnable signed-less bundle
- [x] Launcher renders; the app menu is ours (no predefined-Quit fallback log)
- [x] A graceful quit writes `last_session` (verified via
      `osascript -e 'tell application "TT-Studio" to quit'`)
- [x] A stale `last_session` (deleted profile) lands on the picker and starts
      no connect
- [x] `~/.ssh/config` machines are detected with the right user/host/port/key
- [ ] Cmd+Q **with an SSH session active** shows the quit dialog rather than
      exiting (needs a reachable remote; a detached session correctly just
      quits, so it cannot be checked locally)
- [ ] App menu → Quit and Dock → Quit do the same
- [ ] Cmd+Shift+M returns to the picker from the stack page
- [ ] Edit-menu Cmd+C/V still work in the webview after the menu swap
- [ ] Resume reconnects to a live remote stack and lands in the web UI
- [ ] A held port 3000 is freed and the notice names the ssh pid
- [ ] An unrecognized holder (`python3 -m http.server 3000`) is left alone
- [ ] Stack UI functional after navigation (WebSocket, login, deploy flows)

**Windows (WebView2)** — TODO:

- [ ] `tauri build` succeeds (CI covers the debug/no-bundle variant)
- [ ] WebView2 runtime bootstrap on a clean machine
- [ ] Launcher renders; button navigates to a live stack
- [ ] Stack UI functional after navigation (WebSocket, login, deploy flows)
