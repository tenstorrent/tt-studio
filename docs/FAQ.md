# Frequently Asked Questions

## Table of Contents 
1. [Frontend Does Not Load](#frontend-does-not-load)
2. [Module not found](#module-not-found-error)

## Frontend Does Not Load 

If the frontend app has not loaded despite running `docker compose up --build`, there is likely an issue with docker using cached files. Check if the `node_modules` directory has been created in `tt-studio/app/frontend`. If this directory is missing, this usually means that `npm (Node Package Manager)` did not successfully run and docker has skipped running this since it used layer caching. To resolve run the following: 

```bash
docker compose build --no-cache
docker compose up
```

## Module not found error

This error often occurs due to missing or corrupted dependencies. Here's a quick fix:

1. Delete `node_modules` and `package-lock.json`:


```shellscript
rm -rf node_modules package-lock.json
```

2. Reinstall dependencies:


```shellscript
cd frontend
npm i
```

3. Re-run App using docker:


```shellscript
docker compose down
docker compose up --build
```
