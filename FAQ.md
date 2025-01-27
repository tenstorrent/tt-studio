# Frequently Asked Questions

## Table of Contents

1. [Frontend Does Not Load](#frontend-does-not-load)
2. [Module Not Found Error](#module-not-found-error)

---

## Frontend Does Not Load

If the frontend app does not load despite running `docker compose up --build`, the issue is likely due to Docker using cached layers and skipping critical steps like installing dependencies.

**Solution**:

```bash
# Rebuild Docker containers without cache
docker compose build --no-cache
docker compose up
```

**What this does**:

- Docker skips rebuilding layers it thinks are unchanged (e.g., `node_modules`).
- `--no-cache` forces Docker to re-run all steps, including `npm install`.

---

## Module Not Found Error

This error (`Cannot find module [X]`) typically occurs due to **missing, corrupted, or platform-mismatched dependencies**.

### Quick Fix:

1. **Delete corrupted dependencies**:
   ```bash
   rm -rf node_modules package-lock.json
   ```
2. **Clear npm cache** (optional but recommended):
   ```bash
   # go into the frontend folder
   cd frontend
   npm cache clean --force
   ```
3. **Reinstall dependencies**:
   ```bash
   cd frontend
   npm install
   ```
4. **Rebuild Docker with fresh dependencies**:
   ```bash
   docker compose down
   docker compose build --no-cache
   docker compose up
   ```

### What this does:

- `node_modules` and `package-lock.json` often get corrupted due to npm bugs or OS-specific issues (e.g., Apple Silicon) or when new packages are introduced either via a bug fix or a new feature.
- Rebuilding with `--no-cache` ensures Docker doesn’t reuse stale layers.
