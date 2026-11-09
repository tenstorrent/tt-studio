---
description: Reviews the documentation a pull request changes with the doc-skills checks (Vale, TW review, AI patterns) and opens a review pull request into the contributor's branch
engine:
  id: copilot
model: claude-sonnet-5.5
# Cost cap: stop the agent job once the workflow has used this many AI credits in 24 hours (same value as the tt-metal reference).
max-daily-ai-credits: 10000
on:
  pull_request:
    types: [opened, synchronize, reopened]
    # Advisory mode: skip pull requests that touch no documentation, so no model run is spent on them.
    # Remove this filter before docs-review becomes a required check, which would stay pending otherwise.
    paths:
      - "**/*.md"
      - "**/*.rst"
      - "**/*.adoc"
      - "docs/**"
concurrency:
  group: docs-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
permissions:
  contents: read
  pull-requests: read
  copilot-requests: write
checkout:
  - fetch-depth: 0
  - repository: tenstorrent/doc-skills
    path: .doc-skills
    github-token: ${{ secrets.DOC_SKILLS_TOKEN }}
network: defaults
tools:
  bash: [":*"]
  github:
    toolsets: [pull_requests, repos]
pre-agent-steps:
  - name: Install Vale
    run: |
      curl -sfL https://github.com/errata-ai/vale/releases/download/v3.24.0/vale_3.24.0_Linux_64-bit.tar.gz \
        | tar -xz -C "$RUNNER_TEMP" vale
      echo "$RUNNER_TEMP" >> "$GITHUB_PATH"
  - name: Collect the pull request and its review scope
    env:
      GH_TOKEN: ${{ github.token }}
      PR_NUMBER: ${{ github.event.pull_request.number }}
      BASE_REF: ${{ github.base_ref }}
      HEAD_SHA: ${{ github.event.pull_request.head.sha }}
      REPO: ${{ github.repository }}
    run: |
      set -euo pipefail
      git checkout -q --detach "$HEAD_SHA"
      mkdir -p /tmp/gh-aw/agent
      gh pr view "$PR_NUMBER" --repo "$REPO" \
        --json number,headRefName,headRefOid,baseRefName > /tmp/gh-aw/agent/pr-meta.json
      python3 .doc-skills/scripts/docs_review.py scope \
        --base "origin/$BASE_REF" --head "$HEAD_SHA" --output /tmp/gh-aw/agent/scope.json
safe-outputs:
  create-pull-request:
    # The review pull request goes into the source pull request's branch, which the agent names at run time.
    allowed-base-branches:
      - "**"
    title-prefix: "[docs-review] "
    # Documentation only. README.md and CONTRIBUTING.md are documentation here; CODEOWNERS,
    # AGENTS.md, SECURITY.md and the other default protected files stay protected.
    allowed-files:
      - "**/*.md"
      - "**/*.rst"
      - "**/*.adoc"
      - "docs/**"
    protected-files:
      exclude:
        - README.md
        - CONTRIBUTING.md
    max: 1
  add-comment:
    hide-older-comments: true
    max: 1
  mentions: false
timeout-minutes: 30
---

# Docs review

Review the documentation changed by pull request #${{ github.event.pull_request.number }} in
${{ github.repository }} and deliver the fixes as a review pull request into the source
pull request's branch.

Follow `.doc-skills/.agents/skills/docs-review/SKILL.md`, in particular its section
"Running in an agentic workflow". The doc-skills repository is checked out at `.doc-skills`,
so use these paths:

- `python3 .doc-skills/scripts/docs_review.py ...` and `.doc-skills/scripts/ai_pattern_scan.py`
- `.doc-skills/vale-check.sh --style tenstorrent <absolute path to the file or folder>`
- the other skills under `.doc-skills/.agents/skills/`

Facts for this run:

- `/tmp/gh-aw/agent/pr-meta.json` holds the source pull request number and its branch (`headRefName`).
- `/tmp/gh-aw/agent/scope.json` holds the lines to review. If `in_scope` is false, call `noop`
  with a one-line reason and stop.
- Write your findings to `findings.json` in the working directory.
- You have no git credentials. Never run `git push`, `gh pr create`, or `gh pr comment`.
  Commit locally on the branch `docs-review/<PR number>`, then call the `create_pull_request`
  tool (branch `docs-review/<PR number>`, base = `headRefName`) and the `add_comment` tool.

Edit only the in-scope documentation lines. If nothing needs to change, open no pull request
and call `noop`.
