# chroma

Placeholder for the Chroma vector database service.

The Chroma service runs from the external image `chromadb/chroma:0.5.3` and persists data under `${HOST_PERSISTENT_STORAGE_VOLUME}/chroma`. Its docker-compose block currently lives in `app/docker-compose.yml`; Phase 2 of the code refactor will extract it into `app/chroma/docker-compose.yml` and the root compose will pull it in via `include:`.
