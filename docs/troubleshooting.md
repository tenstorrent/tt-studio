# Troubleshooting Guide

This guide covers common issues you might encounter when working with TT-Studio and their solutions.

## Table of Contents
1. [Hardware Issues](#hardware-issues)
2. [Docker and Deployment Issues](#docker-and-deployment-issues)
3. [Frontend Issues](#frontend-issues)
4. [Backend Issues](#backend-issues)

---

## Hardware Issues

### TT Hardware Detection Problems

If you see a "TT Board (Error)" message:

1. Check if `/dev/tenstorrent` is available and readable:
   ```bash
   ls -la /dev/tenstorrent
   ```

2. Verify the hardware is detected by running:
   ```bash
   tt-smi -s
   ```

3. Reset the board if necessary:
   ```bash
   tt-smi --softreset
   ```

4. Restart TT-Studio:
   ```bash
   python run.py --cleanup
   python run.py
   ```

5. Verify container access to hardware:
   ```bash
   docker exec -it tt_studio_backend_api ls -la /dev/tenstorrent
   ```

---

## Docker and Deployment Issues

### Port 8001 already in use

If port 8001 is already in use, clean up existing Docker services and restart:

```bash
python run.py --cleanup
```

Then try starting TT-Studio again.

### Docker Network Issues

If you encounter network problems between containers:

```bash
docker network prune
```

Then restart TT-Studio.

### FastAPI Server Fails to Start

Check the logs in `fastapi.log` for specific errors. Common causes include:
- Insufficient permissions
- Missing environment variables
- Hardware access issues

---

## Frontend Issues

### Frontend Does Not Load

If the frontend app doesn't load despite running `docker compose up --build`, there's likely an issue with Docker using cached files:

1. Check if the `node_modules` directory exists in `tt-studio/app/frontend`
2. If this directory is missing, it means npm didn't successfully run
3. Rebuild without cache:

```bash
docker compose build --no-cache
docker compose up
```

### Module Not Found Error

This error often occurs due to missing or corrupted dependencies:

1. Delete `node_modules` and `package-lock.json`:
   ```bash
   rm -rf node_modules package-lock.json
   ```

2. Reinstall dependencies:
   ```bash
   cd frontend
   npm i
   ```

3. Re-run app using Docker:
   ```bash
   docker compose down
   docker compose up --build
   ```

---

## Backend Issues

### API Authentication Errors

If you experience authentication errors:

1. Check that your JWT_SECRET is properly set in the environment variables
2. Verify that the DJANGO_SECRET_KEY is correctly configured
3. Ensure your HF_TOKEN (Hugging Face token) is valid and has the necessary permissions

### Database Migration Issues

If you encounter database errors:

```bash
python run.py --cleanup
python run.py
```

This will recreate the database and apply migrations.

---

For additional issues not covered here, please check our [FAQ](FAQ.md) or file an issue on our GitHub repository. 