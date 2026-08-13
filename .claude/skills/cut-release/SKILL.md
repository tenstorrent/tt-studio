---
name: cut-release
description: Orchestrate a TT-Studio release end-to-end with the maintainer release flags — cut an rc-vX.Y.Z branch from main (`python run.py --make-rc-branch`), cherry-pick dev hotfixes into it (`--update-rc-branch`), and ship it (`--merge-rc-branch` merges to main, pushes the vX.Y.Z tag that publishes the GHCR images, and creates the GitHub release) — delegating note-writing to the draft-release-notes skill. Use when someone asks to "cut a release", "make an RC", "update the RC", "ship vX.Y.Z", or "merge the RC branch".
---

# Cut a TT-Studio release

The release model (CONTRIBUTING → Release Process): an `rc-vX.Y.Z` branch is cut
from `main`, validated changes are cherry-picked from `dev`, the `Rc vX.Y.Z` PR is
squash-merged back into `main` after ≥2 approvals, and the merge commit is tagged
`vX.Y.Z` — the tag push is what builds and publishes the GHCR images. Git tags are
the only version source of truth.

The three `python run.py` flags automate the mechanical parts. All of them are
interactive, verify state before acting, and stop with a fix-it panel when
something is off — prefer them over hand-rolled git/gh sequences.

## 0. Preflight

- These flags need the GitHub CLI: `gh auth status` must pass with push access.
- The checkout must be clean (`git status`); the flags refuse dirty worktrees.
- Figure out which stage the user is at and jump to it:
  - no RC branch yet → **Cut**
  - RC exists, fixes landed on dev → **Stabilize**
  - RC approved and green → **Ship**

## 1. Cut

```bash
python run.py --make-rc-branch          # asks: bump major / minor / patch
python run.py --make-rc-branch minor    # or say it up front (also accepts vX.Y.Z)
```

Detects the latest release across tags, `rc-v*` branches, and `Rc vX.Y.Z (#N)`
merge commits on main (they have drifted historically), cuts `rc-vX.Y.Z` from
`origin/main`, pushes it, and opens the `Rc vX.Y.Z` PR against `main` with the
release test-plan checklist. Relay the PR URL to the user.

## 2. Notes

Draft the release notes with the **draft-release-notes** skill (it owns the house
style — do not restate its rules here). After the user approves the draft, put it
at the top of the RC PR description, keeping the test-plan checklist below:

```bash
gh pr edit rc-vX.Y.Z --body-file <notes+testplan.md>
```

## 3. Stabilize

As hotfixes land on `dev` during RC testing:

```bash
python run.py --update-rc-branch
```

Lists dev commits whose patches aren't on the RC yet (patch-id aware, so already
cherry-picked ones don't reappear), lets the user pick, cherry-picks oldest-first,
and pushes. A conflict rolls back the failing pick and prints manual-resolution
steps. Re-run draft-release-notes if the changeset moved meaningfully.

## 4. Ship

Once the PR has **≥2 approvals** and green checks:

```bash
python run.py --merge-rc-branch
```

It verifies approvals/checks via `gh`, asks one explicit confirmation, then:
squash-merges as `Rc vX.Y.Z`, tags the merge commit `vX.Y.Z`, pushes the tag
(→ Publish images workflow → `ghcr.io/tenstorrent/tt-studio/*`), and creates the
GitHub release seeded with GitHub's generated notes (categorized via
`.github/release.yml`). Afterwards, upgrade the release body to the curated notes:

```bash
gh release edit vX.Y.Z --notes-file <curated-notes.md>
```

Watch the Publish images run:
https://github.com/tenstorrent/tt-studio/actions/workflows/publish-images.yml

## Gotchas

- **Duplicate image build**: the tag push and the release-published event each
  trigger Publish images; the runs are serialized and idempotent. Expected — don't
  cancel or "fix" it.
- **Tags must be pushed from a maintainer machine** (the flag does this). A tag
  pushed by a workflow with the default `GITHUB_TOKEN` would NOT trigger
  publishing.
- **`rc-*` branches keep `IS_QB2` off** in `.env.default`; only the QB2 launch
  branch ships it on. `--make-rc-branch` warns if it's set.
- If main's tip moved between merge and tag (something else landed), the flag
  refuses to tag and prints the manual `git tag` command for the actual merge
  commit — follow that rather than re-running.
