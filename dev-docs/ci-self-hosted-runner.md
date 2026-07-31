



# CI on Tenstorrent hardware — self-hosted GitHub runners

This guide explains how to run `[ci/deploy_healthcheck.py](../ci/deploy_healthcheck.py)` through GitHub Actions on real Tenstorrent hardware, so anyone on the team can schedule a deploy healthcheck against their branch and see results in the **Actions** tab — instead of running it by hand and saving logs on disk.

GitHub-hosted runners are cloud VMs with no `/dev/tenstorrent`. To touch the accelerator, CI must run on a **self-hosted runner**: one of our own machines, registered with GitHub. The runner holds an *outbound* connection to GitHub and pulls jobs — **no inbound ports, no exposing the box to the internet.**

The workflow that uses these runners is `[.github/workflows/deploy-healthcheck.yml](../.github/workflows/deploy-healthcheck.yml)`.

---

## Register your machine — step by step (≈10 min, once per box)

Follow this to add your Tenstorrent machine to the shared `pool`.

### Step 1 — Create a dedicated CI user (recommended)

Run the runner under its **own Linux user** (e.g. `studio-ci`), not your personal account. Create it and add it to the `docker` group (the sudo-free `run.py` needs Docker):

```bash
sudo useradd -m -s /bin/bash studio-ci     # dedicated, isolated user
sudo usermod -aG docker studio-ci          # Docker access without sudo
```

No SSH login or sudo is needed for `studio-ci` — you drive it from your admin account with `sudo -iu studio-ci`. Steps 4–5 run **as `studio-ci`**; Step 6 (the service install) runs from your **admin** account and points the service at it.

> **CI-only box?** If this machine isn't also used for interactive dev, you can skip this step and just run everything as your normal user — then use plain `sudo ./svc.sh install` (no username) in Step 6.

### Step 2 — Prerequisites (verify as the user that will run CI)


| Requirement                       | Check                                                                                                                                   | Fix                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Docker without sudo               | `sudo -u studio-ci docker info` succeeds                                                                                                | ensure the user is in the `docker` group (Step 1)                  |
| Tenstorrent hardware present      | `ls /dev/tenstorrent` lists devices                                                                                                     | (hardware/driver setup)                                            |
| `git` + `python3`                 | `git --version`, `python3 --version`                                                                                                    | install them                                                       |
| **TT-Studio actually boots here** | as `studio-ci`, from a clone: `python run.py --accept-terms` → `curl -f http://localhost:8000/up/` returns 200 → `python run.py --stop` | fix any boot error before registering — CI runs this exact command |


You do **not** need a local `.env`: `HF_TOKEN` / `TAVILY_API_KEY` are configured as **repo secrets** and injected into the job automatically.

### Step 3 — Get a registration token (from a repo admin)

Registering a runner needs admin, so ask an admin to open **Settings → Actions → Runners → New self-hosted runner → Linux / x64** and send you the **registration token**. It **expires in ~1 hour** — use it promptly. (If you have admin, grab it from that page yourself.)

### Step 4 — Download the runner agent (as the CI user)

The agent is a public release — no admin needed for this part:

```bash
sudo -iu studio-ci                          # become the CI user
mkdir -p ~/actions-runner && cd ~/actions-runner
# grab the latest linux-x64 asset from https://github.com/actions/runner/releases
curl -o actions-runner-linux-x64.tar.gz -L \
  https://github.com/actions/runner/releases/download/vX.Y.Z/actions-runner-linux-x64-X.Y.Z.tar.gz
tar xzf actions-runner-linux-x64.tar.gz
```

(The runner self-updates after registration, so the exact version isn't critical.)

### Step 5 — Register with the pool label (still as the CI user)

```bash
./config.sh \
  --url https://github.com/tenstorrent/tt-studio \
  --token <TOKEN_FROM_ADMIN> \
  --name "$(hostname)" \
  --labels "pool,$(hostname)" \
  --unattended
exit                                        # leave the studio-ci shell
```

- `**pool**` is what joins the shared pool — the workflow targets `runs-on: [self-hosted, pool]`, so GitHub can send any dispatched run to any idle `pool` box.
- `**$(hostname)**` lets a dispatcher pin a run to *your specific box* (via the `runner_label` input). Add a **device label** too if useful (`n150`, `n300`, `p300x2`) so runs can target hardware big enough for a given model.

### Step 6 — Install as a service, running as the CI user (from your admin account)

```bash
cd /home/studio-ci/actions-runner
sudo ./svc.sh install studio-ci   # service runs AS studio-ci (omit the name if not using a dedicated user)
sudo ./svc.sh start
sudo ./svc.sh status              # expect "active (running)"
```

Do **not** use `./run.sh` in a terminal — it dies when your SSH session closes.

### Step 7 — Verify

Confirm your machine shows **Idle** with the `pool` label in **Settings → Actions → Runners** (ask an admin if you can't see that page). Done — the next dispatched run can land on your box.

### Operational rules on a shared box (important)

- **One runner per board.** That's what lets GitHub avoid double-booking a device (a busy runner isn't "idle", so it's skipped). Don't register two runners on one box.
- **Don't run your own TT-Studio stack while CI might run.** The `:8001` (inference-api) and `:8002` (docker-control) host services are single-instance; if your personal stack is up, a CI job on your box **fails fast** with a clear message (it can't stop another user's services). The dedicated CI user from **Step 1** is what prevents this collision; otherwise `python run.py --stop` your own stack before dispatching.

---

## Offline machines — what GitHub does

- A running runner shows **Idle** (green) / **Active**; a powered-off or stopped one shows **Offline** (grey) in Settings → Actions → Runners. That page is the team's live source of truth for the pool.
- **Job dispatch only considers online, idle runners** carrying the label. Other machines being off is a non-issue — they're skipped.
- **If zero matching runners are online**, GitHub does **not** fail fast: the job sits **queued for ~24h** before timing out. It won't proactively tell you the pool is empty.

The workflow does **not** currently preflight runner availability, so if no `pool` runner is online a dispatched job just **queues** (up to ~24h) rather than failing fast. It *does* fail fast on a different problem — a `pool` runner whose `:8001`/`:8002` host services are held by another user (a personal stack left running) — with a clear "ask them to `python run.py --stop`" message.

**Team norm:** glance at the Runners tab (green = available) before you **Run workflow**.

---

## Running a check

1. Confirm a green runner in Settings → Actions → Runners.
2. Actions tab → **Deploy Healthcheck** → **Run workflow**.
3. Pick the **branch** to test, the **model(s)**, a **timeout**, and the **runner label**.
4. Watch live logs; when done, the run page shows a pass/fail ✓, a summary table, and a downloadable `ci-runs-<id>` artifact (the `.log` + `.json` report).

The workflow is manual-dispatch only today; a nightly `schedule:` trigger can be added later if unattended sweeps are wanted.

---

## Operational caveats on a pool of personal machines

- **Device contention** — one runner per device + the `concurrency:` group in the workflow keep two runs off the same chip.
- **Orphaned containers** — personal boxes get rebooted mid-run; the workflow's `if: always()` step runs `python3 run.py --stop` to free the board so a failed run doesn't wedge the next one.
- **Heterogeneous hardware / TT-Metal versions** — use device labels so a run lands on compatible hardware.

