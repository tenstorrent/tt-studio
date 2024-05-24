# TT-Studio

Deploy LLM inference servers locally as fast as possible using Tenstorrent hardware.

## Quick start

### 1. Download and run
```bash
git clone https://github.com/tenstorrent/tt-studio.git
cd tt-studio
. startup.sh
```

## Running on machine with Tenstorrent hardware

You can check for connected Tenstorrent hardware via:
```bash
ls -l /dev/tenstorrent
```

__NOTE:__ For running ML models on Tenstorrent hardware you must uncomment the following lines in `app/docker-compose.yml`:
```
    # uncomment devices to use Tenstorrent hardware
    # devices:
    #   # mount all tenstorrent devices to backend container
    #   - /dev/tenstorrent:/dev/tenstorrent
```

## Running on remote machine

To correct forward traffic to/from the remote server so that you can use the frontend GUI on your local browser:
```bash
# port forward frontend and backend ports to
ssh -L 3000:localhost:3000 <username>@<remote_server>
ssh -L 8000:localhost:8000 <username>@<remote_server>
```

## Run local for development

To develop locally without running ML models you can keep commented out the following lines in `app/docker-compose.yml`:
```
    # uncomment devices to use Tenstorrent hardware
    # devices:
    #   # mount all tenstorrent devices to backend container
    #   - /dev/tenstorrent:/dev/tenstorrent
```

For local development use the echo model that implementats flask inference API server but merely repeats the prompt.

# Documentation

## Frontend

See frontend usage and development docs: [app/frontend/README.md](app/frontend/README.md)

## Backend API

The backend API is a Django Rest Framework (DRF) app that implements an API to manage the model implementations containers.

See API docs usage and development docs: [app/api/README.md](app/api/README.md)

## Model Implementations

See model docs usage and development docs: [models/README.md](models/README.md)

