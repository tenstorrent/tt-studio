# TT Metalium Falcon 7B Inference API

## Docker build

```bash
docker build -t tt-metal-llama2-70b:v0.0.1 .
# build with GHCR repo tag
docker build -t ghcr.io/tenstorrent/tt-studio/tt-metal-llama2-70b:v0.0.1 .
```


## Docker run


export LLAMA_CKPT_DIR=/home/user/cache_root/repacked-llama-2-70b-chat
export LLAMA_TOKENIZER_PATH=/home/user/cache_root/repacked-llama-2-70b-chat/tokenizer.model
export LLAMA_CACHE_PATH=/home/user/cache_root/tt_metal_cache

```bash
docker run \
  --user user \
  --rm \
  --cap-add ALL \
  --detach \
  --device /dev/tenstorrent:/dev/tenstorrent \
  --env JWT_SECRET=test-secret-456 \
  --env CACHE_ROOT=/home/user/cache_root \
  --env HF_HOME=/home/user/cache_root/huggingface \
  --env MODEL_WEIGHTS_ID=id_repacked-llama-2-70b-chat \
  --env MODEL_WEIGHTS_PATH=/home/user/cache_root/repacked-llama-2-70b-chat \
  --env SERVICE_PORT=7000 \
  --env LLAMA_CKPT_DIR=/home/user/cache_root/repacked-llama-2-70b-chat \
  --env LLAMA_TOKENIZER_PATH=/home/user/cache_root/repacked-llama-2-70b-chat/tokenizer.model \
  --env LLAMA_CACHE_PATH=/home/user/cache_root/tt_metal_cache \
  --volume /dev/hugepages-1G:/dev/hugepages-1G:rw \
  --volume /home/tt-admin/projects/project-falcon/api-services/inference-api/tt-metal-llama2-70b/local_cache_root:/home/user/cache_root:rw \
  --volume ${PWD}/src:/home/user/tt-metal-llama2-70b/src:rw \
  --shm-size 32G \
  --publish 7000:7000 \
  ghcr.io/tenstorrent/tt-studio/tt-metal-llama2-70b:v0.0.1 sleep infinity

```