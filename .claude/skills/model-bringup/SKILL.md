---
name: model-bringup
description: >-
  Bring up a model that tt-inference-server lists as supported but that
  TT-Studio can't deploy today — add it to the catalog, deploy it on real
  hardware, triage failures layer by layer (tt-studio → tt-inference-server →
  tt-metal), verify fixes by hot-patching the running container, ship a
  patched GHCR image when upstream fixes can't wait, and open minimal PRs in
  every repo at fault. Use when asked to "add model X for <board>", "bring up
  <model> from the inference server", or when a model_support doc URL from
  tt-inference-server is shared. Ends with a tt-studio PR opened via the
  feature-branch-pr skill.
---

# TT-Studio Model Bring-up

Battle-tested playbook for taking a model from "listed in tt-inference-server"
to "generating output through the TT-Studio UI", including the cross-repo
triage when it doesn't work. Motif-Image-6B-Preview on p300x2 (tt-studio#1234,
tt-metal#53197, tt-inference-server#4955/#4956) and mochi-1-preview are the
reference runs of this playbook.

## Ground rules

- Work in a **git worktree off `origin/dev`** (`git worktree add
  .claude/worktrees/<name> -b <username>/<feature> origin/dev`). Never edit the
  main checkout's branch — it may be another session's live work.
- All git/PR mechanics follow the **feature-branch-pr** skill: branch
  `<username>/<feature>` off dev, minimal in-scope diff, human commit messages,
  PR targets `dev`, **no AI attribution anywhere** (no Co-Authored-By trailers,
  no mention of AI tools in commits, PR text, or issues).
- Ask the user before stopping someone's running deployment or changing shared
  state (tokens, `.env`, board resets).

## 1. Recon before touching anything

1. **Upstream truth**: read the model_support doc
   (`tt-inference-server/docs/model_support/<type>/<Model>_<device>.md`) —
   HF repo, docker image + tag, impl, inference engine, tt-metal commit.
   Treat its "Complete 🟢" status as a claim to verify, not a fact: the Motif
   doc's own pinned image could not run the model at all.
2. **Artifact spec** (the deploy-time source of truth for prod models):
   `.artifacts/tt-inference-server/workflows/model_specs/<env>/*.yaml`.
   If the model + device entry is already in the pinned artifact version, no
   artifact bump and no `requires_dev_catalog`/`inference_artifact_ref` are
   needed. Root `model_spec.json` / `release_model_spec.json` are generated
   exports — never edit them; `.artifacts/` edits are ephemeral anyway.
3. **tt-studio catalog**: check
   `app/backend/shared_config/models_from_inference_server.json` for the model
   and for a same-type sibling to copy field-for-field (e.g. FLUX.1-dev for an
   image model). Field mapping rules live in
   `app/backend/shared_config/sync_models_from_inference_server.py`
   (`map_model_type`, `map_service_route`, `DEVICE_TYPE_TO_CONFIG`).
4. **Hardware reality**: `tt-smi -ls`, `GET :8000/docker/chip-status/`.
   Know the board semantics: a P300x2 "board" is ALL 4 chips (2 p300c cards);
   one multi-chip deployment occupies the whole board, and another multi-chip
   model cannot deploy until it's stopped.
5. **What's running**: `docker ps`, `GET :8000/docker/deployments/`. If chips
   are occupied, ask the user before stopping anything, and record the
   occupant's `model_id` so it can be redeployed.

## 2. Add the catalog entry

Append to `models_from_inference_server.json` exactly what a resync from the
artifact would emit (copy a sibling entry; `IMAGE` → `IMAGE_GENERATION` +
`/v1/images/generations`, `VIDEO` → `/v1/videos/generations`, etc.). Bump
`total_models`. Rules:

- Model **in** the pinned prod artifact → plain entry, no `hand_owned` (a
  future resync converges).
- Model **not** in any prod snapshot, or entry carrying local overrides that a
  resync must not clobber → `"hand_owned": true` (see `HAND_OWNED_KEYS` in the
  sync script).
- Image models: `param_count: null`, `env_vars: {}` unless the artifact spec
  sets some (watch for `TT_DIT_CACHE_DIR`).

Run the guards (inside the backend container; they need Django + the
`shared_config` dir on `PYTHONPATH`):

```bash
docker exec -w /backend -e PYTHONPATH=/backend/shared_config \
  tt_studio_backend_api_dev pytest shared_config/test_sync_models.py shared_config/test_model_config.py -q
```

Pre-existing `ImplSelectorTests` DB-setup errors in this docker-exec context
are a known environment artifact — compare against a clean tree before blaming
your change.

## 3. Deploy through the real TT-Studio path

Test with the change applied to the checkout the dev stack mounts (apply the
same edit there temporarily if your worktree isn't the mounted one; revert
after). uvicorn `--reload` only watches `.py` files — after a JSON-only catalog
edit, `touch app/backend/shared_config/model_config.py` to force a reload.

```bash
# catalog pickup
curl -s :8000/docker/get_containers/ | grep <model-name>
# deploy (weights_id must be "" — null is rejected)
curl -X POST :8000/docker/deploy/ -d '{"model_id": "<id>", "weights_id": ""}'
# progress / logs
curl :8000/docker/deploy/progress/<job_id>/     # and deploy/logs/<job_id>/
```

Then watch the model container: run.py streams it to
`.artifacts/tt-inference-server/workflow_logs/docker_server/*.log`, and
`docker logs <container>` works too. **Scope watchers with `--since <ts>`** —
docker logs survive restarts and stale error lines will false-positive your
grep. Watch for both success ("Model warmup completed") and the failure
signatures below; the backend's log classifier often misattributes failures
(e.g. "HF_TOKEN authentication failed" for a container that died at import),
so always read the real log.

Success criteria — all three, not just health:
1. `GET :8000/models/health/?deploy_id=<id>` → `{"message":"Healthy"}`
   (the bare endpoint 400s: `deploy_id` is required).
2. Real inference through the backend route (e.g.
   `POST :8000/models/image-generation/ {"deploy_id": ..., "prompt": ...}`;
   direct `:7000/v1/...` needs the JWT). Validate the output artifact (`file`,
   open the image) — don't trust a 200.
3. Repeat after a clean redeploy if you hot-patched anything (see §5).

## 4. Triage ladder — attribute the failure to the right repo

Work down the stack; each signature below was hit in a real bring-up:

| Signature | Layer at fault | Meaning / fix |
|---|---|---|
| Catalog/deploy 4xx, wrong route, model missing from UI | **tt-studio** | Fix in your branch; part of the same PR |
| `ValueError: '<Model>' is not a valid ModelNames` at server import | **tt-inference-server** (stale image pin) | The spec pins an image whose server predates the model / its exact-case enum name. Find a newer tag: `GET ghcr.io/v2/tenstorrent/<image>/tags/list` (anonymous token flow) |
| Missing `(ModelRunners.X, DeviceTypes.Y)` entry in the image's `config/constants.py` | **tt-inference-server** | The image has no device config for this board — needs newer image or upstream addition |
| `KeyError: 'num_links'` (or missing mesh preset) in `models/tt_dit/pipelines/<model>/pipeline_*.py` | **tt-metal** | The pipeline `_PRESETS` lacks this mesh shape. Derive one from an existing preset (e.g. the T3K layout with tensor-parallel scaled to the chip count) — it must be hardware-verified before PRing |
| `TT_FATAL: Creating trace buffers of size N ... only M is allocated` | **tt-inference-server** (runner) | Raise `trace_region_size` in the runner's `get_pipeline_device_params`; tt-metal's own pipeline tests show a known-good value |
| `GatedRepoError` / HF 403 inside the container | **environment** | The deploy token lacks access to a gated repo (models may pull *other* repos, e.g. Motif uses SD3.5-large's VAE). Verify with `curl -H "Authorization: Bearer $TOK" https://huggingface.co/<repo>/resolve/main/config.json` |
| Token updated via Settings UI but container still gets the old one | **tt-studio** (known bug #1235) | `user_config.env` in the persistent volume is root-owned; the host inference-api can't read it and silently falls back to `.env`. Workaround: `sudo chown <host-user>` the file |

Interrogate the *image*, not the repo checkout — the container's code is what
runs: `docker run --rm --entrypoint python3 <image> -c "..."` to dump enums,
presets, device configs from candidate tags.

## 5. Verify fixes by hot-patching the running container

Fast iteration loop, no rebuilds:

- Patch files in-place with `docker exec -i <c> python3 - <<'EOF' ...` (heredoc
  needs `-i`; verify with grep before restarting).
- `docker restart <c>` **keeps** the container filesystem and your patches —
  model containers are `--rm`, so a *stop* destroys them (and the patches).
- Iterate one failure at a time until warmup completes and generation works.

## 6. Patched GHCR image (when upstream fixes can't wait)

Never rebuild media images from source (tt-metal compile = hours). Layer:

```dockerfile
FROM ghcr.io/tenstorrent/<stock-image>:<tag>
COPY --chown=container_app_user:container_app_user <patched-file> <same-path-in-image>
```

- **The layered file must be the image's own copy with the minimal patch
  applied** (`docker cp` it out of the patched container) — never a copy from
  the repo's main, which references symbols the image doesn't have.
- Tag as `ghcr.io/tenstorrent/tt-studio/<image>:<stock-tag>-<model>-<fix>`.
- Redeploy from the clean built image and re-verify end-to-end (§3) — the
  hot-patched container proving it and the baked image proving it are
  different facts.
- **The user must run the `docker push`** (agent pushes to GHCR are blocked);
  hand over the exact command and note it as a pending item in the PR.

## 7. Pin the image in tt-studio

For prod (non-dev-catalog) media models, the catalog `docker_image` field is
**display-only** — the deploy image comes from the artifact spec. The pin that
actually works is `override_docker_image` in
`app/backend/docker_control/docker_utils.py` (see the Wan2.2 and Motif blocks
for the pattern). Add the pin with a comment explaining exactly why and when it
can be dropped, and set the catalog `docker_image` to the same tag for UI
honesty.

## 8. Upstream PRs

- **tt-inference-server**: base `main` (`dev` is dead). One concern per PR,
  minimal diff — prefer a true one-liner with the rationale in the commit
  message and PR body (problem, exact error, fix, hardware verification,
  reproduce steps). Cross-link related PRs.
- **tt-metal**: huge repo — use a sparse partial clone:
  `git clone --filter=blob:none --no-checkout --depth 1 <url> && git
  sparse-checkout set <dir> && git checkout main`. Same minimal-diff rules.
  A derived mesh preset/parallel config is model bring-up work: only PR it
  with hardware verification evidence, never speculatively.
- CI note: an infra-killed job ("runner has received a shutdown signal",
  exit 143) is a flake — check no test actually pins your value, then re-push.

## 9. tt-studio PR and cleanup

1. From the worktree, follow **feature-branch-pr** end-to-end: health checks
   (`/up/`, `/models/health/?deploy_id=`, `:8001/health`, `:3000/`), stage only
   intended files, human commit message, PR → `dev`. The PR body should carry
   the triage summary, upstream PR links, verification evidence, and any
   pending items (GHCR push).
2. Revert every temporary edit to the mounted/live checkout; `git status` there
   must match how you found it (or tell the user exactly what was left and why).
3. Restore or leave stopped any deployment you displaced — per what the user
   chose in §1.
4. File issues for real bugs found along the way that are out of scope to fix.
