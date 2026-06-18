---
name: feature-branch-pr
description: >-
  Make a change in TT-Studio the team way: branch off `dev` with a
  `<username>/<feature>` branch, keep the diff minimal and in-scope, verify the
  running app via its health endpoints before pushing, leave every other branch
  untouched, and open a PR against `dev` with a human, professional title and
  description. Use whenever the user asks to start a feature/fix/branch, make a
  change and open a pull request, or "do this properly on a new branch" in this
  repo. Enforces no AI-tool attribution in commits, PR text, or review comments.
---

# TT-Studio Feature Branch + PR Workflow

Follow this when asked to make a change and/or open a PR in `tt-studio`. The
goal is a small, verified, professional change that touches nothing it
shouldn't.

## Guardrails (always true)

- **Base everything on `dev`.** Features branch off `dev` and PRs target `dev`.
  `main` is production/tagged code only — never branch a feature off it or open
  a feature PR against it.
- **Never commit on `dev` or `main` directly**, and never `git push --force`
  (or `--force-with-lease`) to a shared branch.
- **Leave other branches alone.** No checkout-and-edit of unrelated branches, no
  rebasing or deleting branches you didn't create for this task.
- **No AI attribution anywhere.** Commit messages, PR titles/descriptions, and
  review comments must read as a human wrote them. Do **not** add
  `Co-Authored-By` trailers for AI tools and do **not** mention "Claude",
  "Claude Code", "Cursor", "AI assistant", or similar.

## Workflow checklist

Copy this and tick as you go:

```
- [ ] 1. Identify the username
- [ ] 2. Branch off dev
- [ ] 3. Make the minimal change
- [ ] 4. Verify (endpoints / tests)
- [ ] 5. Clean up instrumentation
- [ ] 6. Stage only intended files
- [ ] 7. Commit (human message)
- [ ] 8. Push + open PR against dev
- [ ] 9. Return to the original branch
```

### 1. Identify the username

Derive the branch prefix from git config:

```bash
git config user.name; git config user.email
```

Use the lowercased first name / email local-part (e.g. `jashansingh@...` →
`jashan`). If it's ambiguous, ask the user which prefix to use. This repo's
convention is `<username>/<feature>` (e.g. `jashan/ttft-fix`).

### 2. Branch off dev

Always start from the latest `dev`, and remember where you came from:

```bash
ORIG=$(git branch --show-current)        # so you can return in step 9
git fetch origin
git checkout -b <username>/<short-kebab-feature> origin/dev
```

Pick a short, descriptive kebab-case feature name (`reset-view-fix`,
`p100-support`). Confirm `git status` is clean before editing.

### 3. Make the minimal change

- Touch only the files required for the stated task. No drive-by refactors,
  no reformatting, no unrelated renames, no dependency bumps "while we're here."
- New code files (`.py` / `.ts` / `.tsx` / `.js`) **must** carry the SPDX
  headers required by `.cursor/rules/general.mdc`:
  ```
  # SPDX-License-Identifier: Apache-2.0
  # SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
  ```
- Do not stage untracked files/dirs that aren't part of your change (e.g.
  `fastapi_logs/`, local `.env`, editor scratch).

### 4. Verify before pushing

Verification is mandatory before any push. Pick what fits the change:

**Running app (code changes).** Bring the stack up and confirm services are
healthy:

```bash
python run.py --dev
```

| Service | Health check |
|---|---|
| Backend (Django) | `curl -f http://localhost:8000/up/` → 200 |
| Backend model API | `curl -f http://localhost:8000/models/health/` |
| Inference server (FastAPI) | `curl -f http://localhost:8001/health` → `{"status":"ok",...}` |
| Frontend (Vite) | `curl -f http://localhost:3000/` → HTML |

Then exercise the specific endpoint/flow your change affects and confirm the new
behavior actually works (don't just trust that it compiles).

**Tests (backend logic).** Run the relevant suite, e.g.:

```bash
cd app/backend && pytest model_control/test_model_api.py -v
```

**Docs / config-only changes.** App endpoint checks are N/A — instead state that
explicitly and validate the artifacts you changed (frontmatter parses, links
resolve, content is correct).

Do not proceed to commit/push until verification passes. If it can't be verified
(e.g. needs hardware), say so explicitly rather than implying it was checked.

### 5. Clean up instrumentation

Remove anything added only to validate: debug prints, temporary logging, scratch
test files, commented-out experiments. The committed diff should contain only
the intended change.

### 6. Stage only intended files

Never `git add -A` blindly. Stage explicit paths, then audit:

```bash
git add <path> <path>
git status
git diff --cached
```

Confirm the staged set is exactly your change — nothing unrelated, no stray
untracked dirs.

### 7. Commit with a human message

Imperative, specific, professional. Describe what changed and why, as a
teammate would. No AI attribution, no `Co-Authored-By` AI trailers.

```
git commit -m "Hide board reset button while a model is deployed"
```

### 8. Push and open the PR against dev

```bash
git push -u origin <username>/<short-kebab-feature>
gh pr create --base dev \
  --title "<human, professional title>" \
  --body "<what changed, why, and how it was verified>"
```

PR description guidance: summarize the problem, the change, and the
verification (endpoints hit / tests run). Plain, human prose — no AI mention.
The repo squash-merges into `dev`; **leave the merge to a human reviewer unless
the user explicitly tells you to merge.**

### 9. Return to the original branch

Leave the tree as you found it:

```bash
git checkout "$ORIG"
```

## Anti-patterns

- **Don't** branch off `main` or off whatever branch happens to be checked out —
  always `origin/dev`.
- **Don't** bundle unrelated cleanups into the PR. Minimal and in-scope.
- **Don't** push without verifying, or claim verification you didn't run.
- **Don't** force-push, rebase shared branches, or modify branches you didn't
  create.
- **Don't** mention Claude / Claude Code / AI tooling, or add AI co-author
  trailers, in commits, PR text, or review comments.
