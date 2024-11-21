# Frequently Asked Questions
## Table of Contents 
1. [Frontend Does Not Load](#Frontend-Does-Not-Load)

## Frontend Does Not Load 

If the frontend app has not loaded despite running `docker compose up --build`, there is likely an issue with docker using cached files. Check if the `node_modules` directory has been created in `tt-studio/app/frontend`. If this directory is missing, this usually means that `npm (Node Package Manager)` did not successfully run and docker has skipped running this since it used layer cacheing. To resolve run the following: 

```bash
docker compose build --no-cache
docker compose up
```