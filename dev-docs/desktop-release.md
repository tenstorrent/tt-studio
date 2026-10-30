# Desktop release runbook

How the Tauri desktop app (`desktop/`) is packaged, signed, and published,
and what a maintainer has to set up once for signing to work.

## One tag drives everything

TT-Studio releases are plain git tags (`vX.Y.Z`) on `main`, normally created
by `python run.py --merge-rc-branch` (see the `cut-release` skill). A single
`v*` tag (and the GitHub release created for it) triggers two workflows:

| Workflow | Produces |
|---|---|
| `.github/workflows/publish-images.yml` | GHCR service images (`backend`, `frontend`, `frontend-dev`, `agent`) tagged `vX.Y.Z` / `latest` / `sha-<12>` |
| `.github/workflows/desktop-release.yml` | Desktop installers + updater manifest, attached as assets on the GitHub release |

Both share the same caveat: tags or releases created by a workflow using the
default `GITHUB_TOKEN` do **not** trigger them (GitHub suppresses recursive
triggers). Today the tag is pushed from a maintainer's machine with their own
credentials, which triggers both. Because the tag push and the subsequent
`release: published` event both match, the workflow can run twice for one
release; the concurrency group serializes the runs and the second re-uploads
the same assets — wasteful but harmless.

## What desktop-release.yml builds

| Platform | Runner | Artifacts |
|---|---|---|
| macOS | `macos-latest` | universal (aarch64 + x86_64) `.dmg` + `.app.tar.gz` updater package |
| Windows | `windows-latest` | NSIS `.exe` installer (doubles as the updater package) |
| Linux | `ubuntu-22.04` | `.AppImage` (+ updater package) and `.deb` — the `.deb` follows tt-local-generator's release-deb precedent; `ubuntu-22.04` keeps the glibc floor low |

Each job also uploads/merges `latest.json` on the release
(`includeUpdaterJson`), which is the exact asset the in-app updater polls
(endpoint in `desktop/src-tauri/tauri.conf.json`). See
`desktop/README.md` → *Updates* for how the app consumes it.

Versions are stamped from the tag at build time
(`desktop/scripts/stamp-version.mjs` syncs `tauri.conf.json`, `package.json`,
`Cargo.toml`, `Cargo.lock`) — git tags are the source of truth, matching
`tt_setup/env_config/_version.py`; no version-bump commits are needed.

### Dry runs

`workflow_dispatch` builds everything without uploading; set its `publish`
input to true (and dispatch on a `v*` tag ref) for an explicit ad-hoc upload.
Every signing step is skip-if-secret-absent, so forks and dry runs without
secrets still build green — just unsigned, and without updater artifacts.

## Secrets inventory

All plain repository **Actions secrets** (admin: Settings → Secrets and
variables → Actions). None exist yet at the time of writing.

| Secret | Needed for | Required? |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Signing updater packages; without it `latest.json` artifacts are skipped and **in-app updates cannot ship** | Yes, for updates to work |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the key above (set at generation time) | Yes, with the key |
| `APPLE_CERTIFICATE` | macOS codesigning — base64 of a Developer ID Application `.p12` (`base64 -i cert.p12`) | Optional — unsigned builds still ship, Gatekeeper warns |
| `APPLE_CERTIFICATE_PASSWORD` | Password of the `.p12` export | With `APPLE_CERTIFICATE` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Tenstorrent AI ULC (TEAMID)` | With `APPLE_CERTIFICATE` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | Notarization (app-specific password for the Apple ID) | Optional — signing without notarization still warns on download |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | Azure Trusted Signing service principal for Windows Authenticode | Optional — unsigned installer triggers SmartScreen |
| `AZURE_SIGNING_ENDPOINT` / `AZURE_SIGNING_ACCOUNT` / `AZURE_SIGNING_PROFILE` | Trusted Signing endpoint URL, account name, certificate profile | With the Azure credentials |

## One-time setup: the updater signing key

The `pubkey` currently in `desktop/src-tauri/tauri.conf.json` is a
development placeholder — the updater deliberately fails closed against it.
A maintainer must, once:

```bash
cd desktop
npm run tauri signer generate    # choose a password; prints both keys
```

1. Put the **private key** and its password into the
   `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   secrets. Never commit the private key; losing it means shipped apps can
   never verify another update (users must reinstall manually).
2. Replace the placeholder `pubkey` in `tauri.conf.json` with the printed
   public key (a normal PR).

Rotating the key has the same reinstall consequence as losing it — treat it
as permanent.

## Interaction with the existing release flow

Nothing about cutting a release changes: `--make-rc-branch` →
`--update-rc-branch` → `--merge-rc-branch` as before. The merge step's tag
push + release creation now additionally produce desktop artifacts. Points of
contact:

- **Release assets**: desktop installers and `latest.json` appear on the
  release alongside the auto-generated notes; don't delete `latest.json`,
  every installed app polls it.
- **Stack updates**: the desktop app also updates the *stack checkout* it
  manages via `run.py --switch <tag>` (see `desktop/README.md`), which relies
  on the same tag having GHCR images from publish-images.yml.
- **RC tags**: any `v*` tag builds and publishes desktop artifacts to its
  release. `latest.json` lives on each release, but the updater endpoint
  resolves `releases/latest/download/latest.json`, so only the release GitHub
  marks *latest* (non-prerelease) is what installed apps see.
