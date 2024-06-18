# TT Metalium Falcon 7B Inference API

## Docker build

```bash
# tt-metal wheel build
docker build -t tt-metal-llama2-70b-whl:v0.0.6 . -f llama2.whl.Dockerfile
# tt-metal source build
docker build -t tt-metal-llama2-70b-src:v0.0.3 . -f llama2.src.Dockerfile
# build with GHCR repo tag
docker build -t ghcr.io/tenstorrent/tt-studio/tt-metal-llama2-70b:v0.0.5 .
```

## Docker run - source dist

```bash
# set TT_STUDIO_ROOT on your host machine, this is also in the .env file if you want to use that
# export TT_STUDIO_ROOT=/home/tt-admin/projects/tt-studio
source app/.env
docker run \
  --rm \
  --cap-add ALL \
  --device /dev/tenstorrent:/dev/tenstorrent \
  --env JWT_SECRET=test-secret-456 \
  --env CACHE_ROOT=/home/user/cache_root \
  --env HF_HOME=/home/user/cache_root/huggingface \
  --env MODEL_WEIGHTS_ID=id_repacked-llama-2-70b-chat \
  --env MODEL_WEIGHTS_PATH=/home/user/cache_root/model_weights/id_repacked-llama-2-70b-chat \
  --env WH_ARCH_YAML=wormhole_b0_80_arch_eth_dispatch.yaml \
  --env TT_METAL_ASYNC_DEVICE_QUEUE=1 \
  --env SERVICE_PORT=7000 \
  --volume /dev/hugepages-1G:/dev/hugepages-1G:rw \
  --volume ${TT_STUDIO_ROOT?ERROR env var TT_STUDIO_ROOT must be set}/tt_studio_persistent_volume/volume_id_tt-metal-llama2-70bv0.0.2:/home/user/cache_root:rw \
  --shm-size 32G \
  --publish 7000:7000 \
  tt-metal-llama2-70b-src:v0.0.3 sleep infinity
  # --volume ${TT_STUDIO_ROOT}/models/tt-metal-llama2-70b:/home/user/tt-metal-llama2-70b:rw \
```
## Docker run - wheel dist

NOTE: this does not work yet
```bash
source app/.env
docker run \
  --rm \
  --cap-add ALL \
  --device /dev/tenstorrent:/dev/tenstorrent \
  --env JWT_SECRET=test-secret-456 \
  --env CACHE_ROOT=/home/user/cache_root \
  --env HF_HOME=/home/user/cache_root/huggingface \
  --env MODEL_WEIGHTS_ID=id_repacked-llama-2-70b-chat \
  --env MODEL_WEIGHTS_PATH=/home/user/cache_root/model_weights/id_repacked-llama-2-70b-chat \
  --env WH_ARCH_YAML=wormhole_b0_80_arch_eth_dispatch.yaml \
  --env TT_METAL_ASYNC_DEVICE_QUEUE=1 \
  --env SERVICE_PORT=7000 \
  --volume /dev/hugepages-1G:/dev/hugepages-1G:rw \
  --volume ${TT_STUDIO_ROOT?ERROR env var TT_STUDIO_ROOT must be set}/tt_studio_persistent_volume/volume_id_tt-metal-llama2-70bv0.0.2:/home/user/cache_root:rw \
  --shm-size 32G \
  --publish 7000:7000 \
  tt-metal-llama2-70b-whl:v0.0.6 sleep infinity
```

you can alternatively run the container and override the `CMD`: 
```
...
  tt-metal-llama2-70b:v0.0.3 sleep infinity
```
Then use `docker exec -it <container-id> bash` to enter the container with an interactive shell to test and debug.

## Run tests

```bash
cd ~/tt-metal-llama2-70b
# run tests with mocked out model
python src/test_llama2_70b_backend_mock.py
# run backend synchronously for debugging
python src/test_llama2_70b_backend.py

```

## run tt-metal demo in container

```bash
export LLAMA_CKPT_DIR=/home/user/cache_root/model_weights/id_repacked-llama-2-70b-chat
export LLAMA_TOKENIZER_PATH=/home/user/cache_root/model_weights/id_repacked-llama-2-70b-chat/tokenizer.model
export LLAMA_CACHE_PATH=/home/user/cache_root/tt_metal_cache/id_repacked-llama-2-70b-chat
# perf
export TT_METAL_ASYNC_DEVICE_QUEUE=1
export WH_ARCH_YAML=wormhole_b0_80_arch_eth_dispatch.yaml
```

## CPU Governor performance setting

Required to get maximum model performance. A ~5% reduction in perf without it on current (June 10th) implementation. This needs to be run on the host, outside of Docker conainer:
```bash
sudo apt-get update
sudo apt-get install -y cpufrequtils
sudo cpufreq-set -r -g performance
# verify setting
cpufreq-info
# make persistent across reboots
# Create or edit the file /etc/default/cpufrequtils and add the following line:
vim /etc/default/cpufrequtils
GOVERNOR="performance"
```

## Test tt-metal perf

```bash
# in container
export LLAMA_CKPT_DIR=/home/user/cache_root/model_weights/id_repacked-llama-2-70b-chat
export LLAMA_TOKENIZER_PATH=/home/user/cache_root/model_weights/id_repacked-llama-2-70b-chat/tokenizer.model
export LLAMA_CACHE_PATH=/home/user/cache_root/tt_metal_cache/id_repacked-llama-2-70b-chat
export WH_ARCH_YAML=wormhole_b0_80_arch_eth_dispatch.yaml
export TT_METAL_ASYNC_DEVICE_QUEUE=1
cd /tt-metal
pytest -svv models/experimental/llama2_70b/demo/demo.py::test_LlamaModel_demo[wormhole_b0-True-sampling-tt-70b-T3000-80L-decode_only]

export PYTHONPATH=/tt-metal
cd /home/user/tt-metal-llama2-70b/src
pytest -svv tt_metal_impl/demo/demo.py::test_LlamaModel_demo[sampling-tt-70b-T3000-80L-decode_only]
```