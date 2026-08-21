---
name: draft-release-notes
description: >-
  Draft TT-Studio GitHub release notes in the house style: study the last one or
  two published releases for structure and voice, diff the current release
  branch against the previous release tag/commit, then group the changes into 🚀
  New Features / 🐛 Bug Fixes / 🔧 Technical Improvements with bold feature names
  and short descriptions. Use whenever someone asks to "draft a release note",
  "write release notes for vX.Y.Z", or "make release notes from the rc-vX.Y.Z
  branch". Delivers the final result as a copyable markdown code block.
---

# TT-Studio Release Notes Drafting

Follow this when asked to draft release notes for a new TT-Studio version. The
goal is notes that read exactly like the previous few releases — same sections,
same voice, same level of detail — built from the actual changes on the release
branch.

## Inputs to confirm

- **New version** (e.g. `v2.9.0`) and the **release branch** (e.g. `rc-v2.9.0`).
- **Previous version** it ships after (e.g. `v2.8.0`). If not given, it's the
  most recent published GitHub release.

If the user names a branch, use it. Don't guess a version — ask if unclear.

The release PR into `main` is titled `Rc vX.Y.Z` (the **Lint PR title** check is
skipped for `rc-*` head branches) or `release: vX.Y.Z` — see CONTRIBUTING →
Release Process. Step 2 relies on that `Rc vX.Y.Z` merge-commit title as the
cutoff.

## Step 1 — Study the previous releases (match the style, don't invent it)

Read the **most recent two or three** published release descriptions so the new
one matches their structure and voice:

```
# needs no auth:
WebFetch https://github.com/tenstorrent/tt-studio/releases
```

The established house style is:

- A header line: `## :rocket: TT Studio <version> is out!`
- A lead-in: `A few highlights since <previous version>:`
- Three sections, in this order, each only if it has content:
  - `### 🚀 New Features` — bold feature name + one-line description
  - `### 🐛 Bug Fixes` — one line each, past tense ("Fixed…", "Resolved…")
  - `### 🔧 Technical Improvements` — internal/infra/CI/refactor/dep bumps
- A closing `Full changelog → <link>` line.

Bold-name-plus-description is the signature of the New Features section — keep
it. Bug Fixes and Technical Improvements are plain one-liners.

## Step 2 — Gather the actual changes

Fetch the release branch and list every commit since the previous release. Each
release's RC merge commit is titled like `Rc vX.Y.Z (#NNNN)` — the previous
release's merge commit is the cutoff; everything above it is new.

```bash
git fetch origin <release-branch>
git log origin/<release-branch> --oneline -60
```

Find the previous release's `Rc v<prev> (#NNNN)` commit in the list; everything
above it belongs in these notes. Commit subjects are usually descriptive enough
(they're squash-merged PR titles). If a subject is cryptic, inspect it with
`git show --stat <sha>` rather than guessing.

## Step 3 — Categorize

Sort each change into one of the three sections:

- **🚀 New Features** — user-facing capabilities and additions (new models,
  new UI, new commands/flags, new workflows). Utilize next heading for model-related
  updates if this gets too long.
- **🤖 Model Support (Optional)** — if there are too many model-related changes, 
  then things like the addition of new models, progress stuff, deployment improvements, etc go here.
- **🐛 Bug Fixes** — anything fixing broken behavior. Past tense.
- **🔧 Technical Improvements** — refactors, dependency/artifact bumps, CI,
  internal plumbing, dev-experience changes not visible to end users.

Judgment calls to make deliberately (and mention to the user afterward):

- Internal output-handling or plumbing changes go in Technical Improvements,
  not New Features, even when they sound feature-ish.
- Fold several closely related commits into one bullet (e.g. multiple CI
  additions → one "Added CI: …" bullet; several workflow-canvas commits → one
  "Workflow Canvas Upgrades" bullet with the pieces listed).
- CI-only / internal changes can be bundled or dropped from public notes — offer
  the user both.

## Step 4 — Changelog link

- If the release PR number is known, link it: `#<PR>`.
- Otherwise use a compare link: `https://github.com/tenstorrent/tt-studio/compare/<prev>...<new>` (resolves once the RC merges and is tagged).

Tell the user which one you used and offer to swap in the PR number.

## Step 5 — Deliver as a markdown code block

Always hand back the final release note **inside a fenced markdown code block**
so it's copy-pasteable verbatim into GitHub. Do not render it as live markdown.

Then, below the code block, add a short plain-text note of the judgment calls
you made (what you grouped, what you moved between sections, which changelog
link you chose) and any options you want the user to weigh in on.

## Template

````
```markdown
## :rocket: TT Studio <version> is out!

A few highlights since <previous version>:

### 🚀 New Features
- **<Feature Name>**: <one-line description>
- ...

### 🐛 Bug Fixes
- Fixed <…>
- ...

### 🔧 Technical Improvements
- <…>
- ...

**Full changelog → <link>**
```
````
