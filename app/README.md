# tt-studio backend app


## Deployment 

The backend app uses docker-compose.yml to configure the connection with the host, this included the persistent storage volume, ports, etc
```bash
docker compose up
```

The `startup.sh` script automates the management of the environment variables and docker networks that must be conifgured outside of docker compose.

### Environment variables

Environment variables are defined in `.env`, `.env.default` is a template you can use
```bash
cp .env.default .env
# edit JWT_SECRET
vim .env
```
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

Run the backend server interactively:
```bash
docker compose run --service-ports tt_studio_backend bash
```

The local files in `./api` are mounted to `/api` within the container for development. You can add breakpoints in the code, it will rebuild and deploy the Django server automatically.

```bash
./manage.py runserver 0.0.0.0:8000
```



