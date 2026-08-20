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

**macOS (WKWebView)** — TODO:

- [ ] `tauri build` succeeds (CI covers the debug/no-bundle variant)
- [ ] Launcher renders; button navigates to a live stack
- [ ] Stack UI functional after navigation (WebSocket, login, deploy flows)

**Windows (WebView2)** — TODO:

- [ ] `tauri build` succeeds (CI covers the debug/no-bundle variant)
- [ ] WebView2 runtime bootstrap on a clean machine
- [ ] Launcher renders; button navigates to a live stack
- [ ] Stack UI functional after navigation (WebSocket, login, deploy flows)
