# TT-Studio Application

Manage your LLM inference server containers.

## Deployment

The backend app uses docker-compose.yml to configure the connection with the host, this included the persistent storage volume, ports, etc

```bash
docker compose up
```

The `startup.sh` script automates the management of the environment variables and docker networks that must be configured outside of docker compose.

### Environment variables

Environment variables are defined in `.env`, `.env.default` is a template you can use

```bash
cp .env.default .env
# edit JWT_SECRET
vim .env
````

Note: the backend runs inside a container, because of this it does not have access to the host file system directly to programmatically determine it's relative path.

## Clean up

To remove all containers

```bash
# this stops all containers
docker stop $(docker ps -q)
# this deletes all stopped containers
docker container prune
```

## Development

Run the backend and frontend server interactively: \
**Note:** It is recommended that you use the `startup.sh` script to run `tt-studio` and opt 'yes' when prompted whether to run in development mode.

```bash
docker compose -f <TT_STUDIO_ROOT>/app/docker-compose.yml -f <TT_STUDIO_ROOT>/app/docker-compose.dev-mode.yml up
```

If running on TT hardware
```bash
docker compose -f <TT_STUDIO_ROOT>/app/docker-compose.yml -f <TT_STUDIO_ROOT>/app/docker-compose.dev-mode.yml -f <TT_STUDIO_ROOT>/app/docker-compose.tt-hardware.yml up
```

To force rebuilding the Docker images:

```bash
docker compose -f <TT_STUDIO_ROOT>/app/docker-compose.yml -f <TT_STUDIO_ROOT>/app/docker-compose.dev-mode.yml -f <TT_STUDIO_ROOT>/app/docker-compose.tt-hardware.yml up --build
```

The local files in `./backend` are mounted to `/backend` within the container for development. You can add breakpoints in the code, it will rebuild and deploy the Django server automatically.

```bash
./manage.py runserver 0.0.0.0:8000
```

# Models:

# Llama Model Setup and Inference Guide

For detailed instructions on setting up and running Llama models, including Llama 3.1 70B in TT Studio, refer to [this guide](../HowToRunLlama3.1-70b.md)
