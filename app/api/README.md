# API Backend

$api_host: on the host this will be `0.0.0.0:8000`, on the Docker bridge network (within containers), this is `

### GET $api_host/docker/get_containers

- **Description**: Retrieve a list of model implementations available for deployment.
- **Parameters**: None
- **Example request**:
```
curl http://0.0.0.0:8000/docker/get_containers/
```

- **Response**:
format: JSON
```json
{
    "model_id": "model_name"
}
```

example response:
```json
{
    "0": "echo", 
    "1": "Falcon-7B-Instruct"
}
```

### GET $api_host/docker/status

- **Description**: Retrieve a list of running containers and status info, the container_id is the primary key.
- **Parameters**: None
- **Example request**:
```
curl http://0.0.0.0:8000/docker/status/
```

- **Response**:
example JSON response:
```json
{
    "1d1a274a712639ae3a1b3958ecbe13f81db8923a6f8b199373e431c35cd0e1e1": {
        "name": "dummy_echo_model_p8013",
        "status": "running",
        "health": "starting",
        "create": "2024-05-17T16:52:42.179909055Z",
        "image_id": "sha256:9258b9f0ae0d5f597152bb3d57fa15bfac102170206418903d974480f1a74352",
        "image_name": "dummy_echo_model:v0.0.1",
        "port_bindings": {
            "7000/tcp": [
                {
                    "HostIp": "0.0.0.0",
                    "HostPort": "8013"
                }
            ]
        },
        "networks": {
            "llm_studio_network": {
                "DNSNames": [
                    "dummy_echo_model_p8013",
                    "1d1a274a7126"
                ]
            }
        }
    }
}

```

### POST $api_host/docker/deploy

- **Description**: Retrieve a list of model implementations available for deployment.
- **Parameters**:  
model_id [required][str]: the model id, e.g. "0" for echo model for testing.  
weights_path [optional][str]: the path to the model weights.  
- **Example request**:
```
curl -X POST -H "Content-Type: application/json" -d '{"model_id":"0", "weights_path": ""}' http://0.0.0.0:8000/docker/deploy/
```
- **Response**:
format: JSON
```json
{
    "status": "success",
    "container_id": "1d1a274a712639ae3a1b3958ecbe13f81db8923a6f8b199373e431c35cd0e1e1",
    "container_name": "dummy_echo_model_p8013",
    "service_route": "/inference/dummy_echo",
    "port_bindings": {
        "7000/tcp": 8013
    }
}
```

### POST $api_host/docker/stop

- **Description**: Stop a running container by container_id, the id can be found from `status` API call.
- **Parameters**: container_id [str]: the docker container uuid.
- **Example request**:

```
curl -X POST -H "Content-Type: application/json" -d '{"container_id":"1d1a274a712639ae3a1b3958ecbe13f81db8923a6f8b199373e431c35cd0e1e1"}' http://0.0.0.0:8000/docker/stop/
```

- **Response**:
format: JSON
```json
{
    "status": "success"
}
```
### POST $api_host/docker/redeploy



## Trouble shooting

### Ensure the trailing slash or enable follow redirects

When making requests with curl, always include the trailing slash if your Django URL patterns expect it. Django will redirect requests without a trailing slash to the same URL with a trailing slash if APPEND_SLASH is set to True (which is the default setting).

Curl does not by default follow redirects, the response will be empty. In the Django API server logs you will see a 301 code for permanent redirecting, but no 200 code afterwards.

```bash
# added trailing slash
curl http://0.0.0.0:8000/docker/get_containers/
# or follow redirects
curl -L http://0.0.0.0:8000/docker/get_containers
```

When using POST requests you cannot follow redirects, so only correctly adding the trailing slash works. You will see this error in this case:
```log
RuntimeError: You called this URL via POST, but the URL doesn't end in a slash and you have APPEND_SLASH set. Django can't redirect to the slash URL while maintaining POST data. Change your form to point to 0.0.0.0:8000/docker/deploy/ (note the trailing slash), or set APPEND_SLASH=False in your Django settings.
```

## Support for custom weights

```bash
sudo cp -r path/to/my_weights tt-studio/tt_studio_persistent_volume/volume_${MODEL_ID}/model_weights/my_weights
sudo chown -R user:1000 volume_${MODEL_ID}
```

The environment variables MODEL_WEIGHTS_ID and MODEL_WEIGHTS_PATH are then set accordingly by the backend when Custom Weights -> `my_weights` are selected for deployment. The containerized model implementation will use MODEL_WEIGHTS_ID for tracking and MODEL_WEIGHTS_PATH for loading the weights. This is typically done using the inference_config object to enhance programability.

# Docker build

```bash
docker build -t ghcr.io/tenstorrent/tt-studio/api:v0.0.0 .
```

## Docker run

Using docker-compose.yml is recommended for development, but `docker run` can be useful sometimes, here is an example:
```bash
cd app
source .env
docker run \
  --user user \
  --rm \
  --cap-add ALL \
  --detach \
  --env JWT_SECRET=test-secret-123 \
  --env CACHE_ROOT=/home/user/cache_root \
  --env HF_HOME=/home/user/cache_root/huggingface \
  --volume ${HOST_PERSISTENT_STORAGE_VOLUME}:${INTERNAL_PERSISTENT_STORAGE_VOLUME} \
  --volume /dev/hugepages-1G:/dev/hugepages-1G:rw \
  --volume <your-path>/tt-studio/models/tt-metal-falcon-7b/src:/home/user/tt-metal-falcon-7b/src:rw \
  --shm-size 32G \
  --device /dev/tenstorrent/0:/dev/tenstorrent/0 \
  --publish 8001:7000 \
  --network llm_studio_network \
  --name tt-metal-falcon-7b_p8001 \
  --hostname tt-metal-falcon-7b_p8001 \
  ghcr.io/tenstorrent/tt-studio/tt-metal-falcon-7b:v0.0.13 sleep infinity
```

## Development Notes

Gunicorn is used for production but does not allow for easily adding breakpoints because it is multithreaded, use the development server for PDB breakpoint debugging.
```bash
./manage.py runserver 0.0.0.0:8000
# run with --noreload to stop auto reload
```

# Testing

```bash
# dev dependencies
pip install pytest black pyjwt==2.7.0
pytest --log-cli-level=INFO docker_control/test_docker_utils.py
pytest --log-cli-level=INFO docker_control/test_echo_model_deploy.py

```

## Ubuntu user file permissions

The `user` user within the model containers is UID=1000, GID=1000:
```log
$ id
uid=1000(user) gid=1000(user) groups=1000(user)
```
These are specified in `api/docker_control/model_config.py` `model_implmentations`.

The permissions for mounted directories must be set correctly, and are done so explicly during post_init of the ModelImpl instances. This means any misconfigured volume mounting will throw an error at initialization, not during runtime.
```python
# api/docker_control/model_config.py
    def get_volume_mounts(self):
        ...
        volume_path = Path(backend_config.persistent_storage_volume).joinpath(self.image_volume)
        volume_path.mkdir(parents=True, exist_ok=True)
        os.chown(volume_path, uid=self.user_uid, gid=self.user_gid)
        ...
```