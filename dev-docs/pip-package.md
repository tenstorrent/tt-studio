# The `tt-studio` pip package

`pip install tt-studio` (or `pipx install tt-studio`) installs the whole
application: the `tt_setup` launcher plus the app tree it drives. There is no
git clone and no separate updater — pip owns the version.

## What's in the wheel

The repo-root `pyproject.toml` builds one distribution, `tt-studio`, with
hatchling:

- `tt_setup/` — the launcher, exactly what `python run.py` runs.
- `tt_setup/_bundle/` — the app tree, added by the build hook in
  `hatch_build.py`: `app/` (compose files, build contexts, the bind-mounted
  backend source), `inference-api/`, `docker-control-service/`,
  `ci/deploy_healthcheck.py` and `.env.default`.

The bundle is exactly the git-tracked files under those paths (`git ls-files`).
Hatch's usual `.gitignore` filtering can't be used: the root `.gitignore`
ignores `*.json` and `*.txt`, which would drop `package.json`, the
`requirements.txt` files and the model catalog. The publish workflow checks the
wheel against `git ls-files` before uploading.

The `tt-studio` console script is `tt_setup.install_mode:main`.

## How a pip install runs

Docker Compose bind-mounts parts of the app tree (`./backend`, the litellm
config), and the launcher writes `.env`, `logs/`, `.artifacts/`, the model
catalog and the persistent volume beside it. None of that can live in
site-packages, which may be read-only and is replaced on every upgrade. So on
each launch `tt-studio`:

1. Resolves the runtime root: `$TT_STUDIO_HOME`, else `~/.tt-studio`.
2. If the root isn't on the installed version yet, copies the bundle into it
   and writes `.tt-studio-install.json` (version + file list). On an upgrade,
   bundled files are overwritten, files the old version shipped but the new one
   doesn't are deleted, and everything else — `.env`, logs, downloaded models,
   venvs, `db.sqlite3` — is kept. The same version is a no-op.
3. `chdir`s into the root and runs the normal launcher with
   `TT_STUDIO_ROOT` = that root.

It refuses to stage into a folder it didn't create (a git checkout, or a
non-empty folder without the marker) and says to pick another
`TT_STUDIO_HOME`.

`python run.py` from a clone is unchanged: there is no `tt_setup/_bundle/` in
the repo, so `TT_STUDIO_ROOT` is still the working directory.

### Pip-mode differences

| Feature | Clone (`python run.py`) | pip (`tt-studio`) |
|---|---|---|
| Version / frontend label | `git describe` | package version (`v2.12.0`) |
| Image tag | release tag, else `sha-<12>` | `vX.Y.Z`; dev builds get a never-published tag, so images are built locally |
| Update check | HEAD vs origin (release branches must be in sync) | installed version vs PyPI — a note, never blocks |
| `--dev`, `--switch`, `--check-headers`, `--add-headers`, `--*-rc-branch` | available | refused with a hint (they need a git clone) |
| `--install-shortcut` | adds the rc shell function | no-op: `tt-studio` is already on PATH |
| `--uninstall` | purge + remove the shortcut | purge + delete `~/.tt-studio`, then `pipx uninstall tt-studio` |
| Hints in messages | `python run.py …` | `tt-studio …` |
| `--version` | `git describe` | package version |

## Versioning

The version is single-sourced from the git tag by hatch-vcs — there is no
version string to bump:

- Building at tag `v2.12.0` → `2.12.0`.
- `v2.12.0-rc1` → `2.12.0rc1` (a pre-release; pip ignores it unless asked).
  Use that hyphenated spelling for rc tags: the images are pushed under the tag
  name, and a pip install maps `2.12.0rc1` back to the `v2.12.0-rc1` image tag.
  The publish workflow only accepts `vX.Y.Z` and `vX.Y.Z-rcN`.
- Any other commit → `X.Y.Z.devN+g<sha>`. PyPI rejects local versions (`+…`),
  so an untagged build can't be published by accident. The base is the nearest
  tag in the branch's history: release tags live on `main`, so a build from
  `dev` counts from an old tag (e.g. `1.0.1.devN`). That only affects dev
  wheels — they never pull images anyway — and a release tag always builds as
  its exact version.
- No git metadata at all (e.g. a GitHub "Download ZIP") →
  `0.0.0+dev.test.build`.

## Publishing (`.github/workflows/publish-pypi.yml`)

| Trigger | Result |
|---|---|
| `vX.Y.Z` tag push (the release CLI pushes it in `--merge-rc-branch`) | build, check, smoke test → **PyPI** |
| `vX.Y.Z-rcN` tag push | same → **TestPyPI** |
| Manual dispatch, `target: testpypi` | `.devN` build → **TestPyPI** (rehearsal) |
| Manual dispatch, `target: none` / PRs touching packaging | build, check, smoke test only |

The build job builds the sdist and wheel, runs `twine check --strict`, runs
`dev-tools/check_pypi_dist.py` (bundle == `git ls-files`; wheel version ==
tag), then installs the wheel into a clean venv and runs `tt-studio --version`
and `--help` with a throwaway `TT_STUDIO_HOME`. Upload uses PyPI **trusted
publishing** (OIDC) — no API token is stored anywhere.

## Going live (one-time setup)

1. **PyPI project and trusted publisher.** Sign in to pypi.org with the
   account (ideally a Tenstorrent PyPI organization) that should own the
   project. Under *Your account → Publishing → Add a new pending publisher*,
   enter:
   - PyPI project name: `tt-studio`
   - Owner: `tenstorrent` · Repository: `tt-studio`
   - Workflow name: `publish-pypi.yml` · Environment: `pypi`

   A pending publisher reserves the name and creates the project on the first
   upload — no manual upload is needed.
2. **TestPyPI** (for rehearsals and rc tags): do the same on test.pypi.org
   (separate account) with environment `testpypi`.
3. **GitHub environments.** In the repo's *Settings → Environments*, create
   `pypi` and `testpypi`. For `pypi`, add *Required reviewers* (release
   maintainers) and limit *Deployment branches and tags* to tags matching
   `v*`, so a publish needs a human approval.
4. **Rehearse on TestPyPI (optional).** *Run workflow* only appears for
   workflows on the default branch (`main`), so before the first release
   reaches `main`, upload a dev build by hand with a TestPyPI API token:

   ```bash
   SETUPTOOLS_SCM_PRETEND_VERSION=2.12.0.dev1 python -m build   # any unused .devN
   twine upload --repository testpypi dist/*
   ```

   Once the workflow is on `main`, use *Actions → Publish PyPI package → Run
   workflow* with `target: testpypi` instead (that also exercises trusted
   publishing). Don't push an rc tag just to rehearse: every `v*` tag also
   triggers Publish images, which moves the `latest` image tag. Then, on a
   clean machine:

   ```bash
   pipx install --index-url https://test.pypi.org/simple/ \
     --pip-args="--extra-index-url https://pypi.org/simple/" tt-studio
   tt-studio --version
   tt-studio
   ```

   (The extra index lets pip fetch rich, typer, etc. from real PyPI.)
5. **Release.** Cut the release as usual (`--make-rc-branch` →
   `--merge-rc-branch`). The `vX.Y.Z` tag push publishes images (Publish images)
   and the package (Publish PyPI package) in parallel; approve the `pypi`
   deployment when the run asks. Then `pipx install tt-studio` works.

If the first package is published before that release's images finish
building, a user who installs in that window gets a local image build instead
of a pull — slower, but it works.

## Testing locally

```bash
python -m pip install build
python -m build --wheel                      # dist/tt_studio-<version>-py3-none-any.whl
pipx install --force dist/tt_studio-*.whl    # or a fresh venv + pip install
TT_STUDIO_HOME=/tmp/tts-home tt-studio --version
```

Stop any stack started from a clone first (`python run.py --stop`): both bind
the same ports. Unit tests: `tests/test_install_mode.py`.
