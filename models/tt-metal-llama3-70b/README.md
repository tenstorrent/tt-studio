# TT Metalium Llama 3 70B Inference API

## Quick run

If first run setup has already been completed, start here.

### Docker run - llama3 - demo scripts

These demos show direct usage of the model implementation for performance.

Run container overriding the entrypoint `CMD` with an interactive bash shell:
```bash
cd tt-studio
# set TT_STUDIO_ROOT on your host machine to be where you've cloned tt-studio
export TT_STUDIO_ROOT=$PWD
docker run \
  --rm \
  -it \
  --cap-add ALL \
  --device /dev/tenstorrent:/dev/tenstorrent \
  --env JWT_SECRET=test-secret-456 \
  --env CACHE_ROOT=/home/user/cache_root \
  --env HF_HOME=/home/user/cache_root/huggingface \
  --env MODEL_WEIGHTS_ID=id_repacked-llama-3-70b-instruct \
  --env MODEL_WEIGHTS_PATH=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct \
  --env LLAMA_VERSION=llama3 \
  --env TT_METAL_ASYNC_DEVICE_QUEUE=1 \
  --env WH_ARCH_YAML=wormhole_b0_80_arch_eth_dispatch.yaml \
  --env SERVICE_PORT=7000 \
  --volume /dev/hugepages-1G:/dev/hugepages-1G:rw \
  --volume ${TT_STUDIO_ROOT?ERROR env var TT_STUDIO_ROOT must be set}/tt_studio_persistent_volume/volume_id_tt-metal-llama3-70bv0.0.1:/home/user/cache_root:rw \
  --shm-size 32G \
  --publish 7000:7000 \
  tt-metal-llama3-70b-src-full-inference:v0.0.1-tt-metal-a053bc bash
```

Within the container shell:
```bash
# need to set path environment variables for demo scripts
export LLAMA3_CKPT_DIR=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct
export LLAMA3_TOKENIZER_PATH=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct/tokenizer.model
export LLAMA3_CACHE_PATH=/home/user/cache_root/tt_metal_cache/repacked-llama-3-70b-instruct
# run demo with pytest for llama3
pytest -svv tt_metal_impl/demo/demo.py::test_LlamaModel_demo[check_disabled-greedy-tt-70b-T3000-80L-decode_only-chat_completion-llama3]
# run demo with pytest for llama3, with sampling for token selection
pytest -svv tt_metal_impl/demo/demo.py::test_LlamaModel_demo[check_disabled-sampling-tt-70b-T3000-80L-decode_only-chat_completion-llama3]

# this script will run through 800 samples of alpaca eval (25 batches of 32 users).
# outputs are appended to demo_user_output_{timestamp}.txt
python tt_metal_impl/demo/demo_llama3_alpaca_eval.py
```

You can view the alpaca eval responses by copying the output file to the host, for example:
```bash
docker cp 3be74f228f5c:/home/user/tt-metal-llama3-70b/src/demo_user_output_2024-07-03_13-18-25.txt
```

### Docker run - llama3 - inference API server

Run the container directly without overriding the entrypoint CMD to start the inference API server. It will take ~3-5 minutes to start up.
Note: there is some overhead to running the inference server with it's unoptimized implementation, this will reduce performance compared to direct calls the model forward method as in the demo scripts above.

```bash
cd tt-studio
# set TT_STUDIO_ROOT on your host machine to be where you've cloned tt-studio
export TT_STUDIO_ROOT=$PWD
docker run \
  --rm \
  --detach \
  --cap-add ALL \
  --device /dev/tenstorrent:/dev/tenstorrent \
  --env JWT_SECRET=test-secret-456 \
  --env CACHE_ROOT=/home/user/cache_root \
  --env HF_HOME=/home/user/cache_root/huggingface \
  --env MODEL_WEIGHTS_ID=id_repacked-llama-3-70b-instruct \
  --env MODEL_WEIGHTS_PATH=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct \
  --env LLAMA_VERSION=llama3 \
  --env TT_METAL_ASYNC_DEVICE_QUEUE=1 \
  --env WH_ARCH_YAML=wormhole_b0_80_arch_eth_dispatch.yaml \
  --env SERVICE_PORT=7000 \
  --volume /dev/hugepages-1G:/dev/hugepages-1G:rw \
  --volume ${TT_STUDIO_ROOT?ERROR env var TT_STUDIO_ROOT must be set}/tt_studio_persistent_volume/volume_id_tt-metal-llama3-70bv0.0.1:/home/user/cache_root:rw \
  --shm-size 32G \
  --publish 7000:7000 \
  tt-metal-llama3-70b-src-full-inference:v0.0.1-tt-metal-a053bc
```

The inference API server after start up (3-5 minutes) is available to server requests.
See the test scripts for examples on how to send those requests.

The requests can be sent from anywhere that can send HTTP requests to the published port mapped to internal SERVICE_PORT (7000 above). 

### JWT_TOKEN Authorization

To authenticate requests use the header `Authorization`. The JWT token can be computed using the script `jwt_util.py`. This is an example:
```bash
export JWT_ENCODED=$(python src/tt_metal_impl/scripts/jwt_util.py --secret ${JWT_SECRET} encode '{"team_id": "tenstorrent", "token_id":"debug-test"}')
export AUTHORIZATION="Bearer ${JWT_ENCODED}"
```

The only dependency for this script is pyjwt:
```bash
pip install pyjwt==2.7.0
```

For example, without using the script above:
```python
import json
import jwt
jwt_secret = "test-secret-456"
json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
encoded_jwt = jwt.encode(json_payload, jwt_secret, algorithm="HS256")
print(encoded_jwt)
```

### Send requests using alpaca eval prompts

The `test_inference_api_alpaca_eval.py` script will run through 800 samples of alpaca eval (25 batches of 32 users).
The results are appended per batch to `responses_{datetime}.json`.

```bash
cd /home/tt-admin/projects/tt-studio/models/tt-metal-llama3-70b
# see above for JWT_TOKEN Authorization
export AUTHORIZATION="Bearer ${JWT_ENCODED}"
export CACHE_ROOT="test"  # just for testing on the host or external to container
# the huggingface datasets library is need to access alpaca eval
python3 -m venv .venv
source .venv/bin/activate
pip install datasets
# run script
python src/test_inference_api_alpaca_eval.py
```

### Docker run - llama2 

Llama2 is also supported if the weights are available. Use `LLAMA_VERSION=llama3` or `LLAMA_VERSION=llama2` to toggle between llama3 and llama2. Other environment variables must be set correctly for llama2 as below for example.

```bash
cd tt-studio
# set TT_STUDIO_ROOT on your host machine to be where you've cloned tt-studio
export TT_STUDIO_ROOT=$PWD
docker run \
  --rm \
  --detach \
  --cap-add ALL \
  --device /dev/tenstorrent:/dev/tenstorrent \
  --env JWT_SECRET=test-secret-456 \
  --env CACHE_ROOT=/home/user/cache_root \
  --env HF_HOME=/home/user/cache_root/huggingface \
  --env MODEL_WEIGHTS_ID=id_repacked-llama-2-70b-chat \
  --env MODEL_WEIGHTS_PATH=/home/user/cache_root/model_weights/repacked-llama-2-70b-chat \
  --env LLAMA_VERSION=llama2 \
  --env TT_METAL_ASYNC_DEVICE_QUEUE=1 \
  --env WH_ARCH_YAML=wormhole_b0_80_arch_eth_dispatch.yaml \
  --env SERVICE_PORT=7000 \
  --volume /dev/hugepages-1G:/dev/hugepages-1G:rw \
  --volume ${TT_STUDIO_ROOT?ERROR env var TT_STUDIO_ROOT must be set}/tt_studio_persistent_volume/volume_id_tt-metal-llama2-70bv0.0.2:/home/user/cache_root:rw \
  --shm-size 32G \
  --publish 7000:7000 \
  tt-metal-llama2-70b-src-full-inference:v0.0.1-tt-metal-a053bc

export LLAMA2_CKPT_DIR=/home/user/cache_root/model_weights/repacked-llama-2-70b-instruct
export LLAMA2_TOKENIZER_PATH=/home/user/cache_root/model_weights/repacked-llama-2-70b-chat/tokenizer.model
export LLAMA2_CACHE_PATH=/home/user/cache_root/tt_metal_cache/repacked-llama-2-70b-chat

```

## Tenstorrent device soft resets

On host, use tt-smi (https://github.com/tenstorrent/tt-smi) to reset the n300 devices: 
```bash
# source
source ~/.venv/bin/activate
tt-smi -r 0,1,2,3
```

This soft reset is required for example when the device is not closed correctly during termination.
When this occurs the device may not be able to connect and train the ethernet links. If this occurs try soft resetting the device.

# First run setup

## Installation setup

### 1. Docker install

see Ubuntu apt guide: https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository

and postinstall guide, to allow $USER to run docker without sudo: https://docs.docker.com/engine/install/linux-postinstall/

### 2. CPU performance setting

```bash
sudo apt-get update && sudo apt-get install -y linux-tools-generic
# enable perf mode
sudo cpupower frequency-set -g performance
# disable perf mode
sudo cpupower frequency-set -g ondemand
```

### 3. Docker image build

The docker image uses tt-metal commit [a053bc8c9cc380804db730ed7ed084d104abb6a0](https://github.com/tenstorrent/tt-metal/tree/a053bc8c9cc380804db730ed7ed084d104abb6a0)
```bash
## llama3 and llama2 container
docker build -t tt-metal-llama3-70b-src-full-inference:v0.0.1-tt-metal-a053bc . -f llama3.src.full.inference.a053bc.Dockerfile
# even though the same container is used for llama2 and llama3, we need tags to manage which runtime is deployed
# create tag for llama2
docker tag <IMAGE_TAG> tt-metal-llama2-70b-src-full-inference:v0.0.1-tt-metal-a053bc
```

### 4. download weights
Download the Llama3-70B weights from Meta (https://llama.meta.com/llama-downloads/), you will need to submit your contact email and company information to get the license URL for downloading. Select "Meta Llama 2" as well if needed.

Once you have the email from Meta with the signed URL you can run the download script at https://github.com/meta-llama/llama3/blob/main/download.sh

```bash
git clone https://github.com/meta-llama/llama3.git
cd llama3
./download.sh
```

Select model size `70B-instruct` and it will download to `./Meta-Llama-3-70B-Instruct`
Once the download is finished you should see the checksum message:
```log
Checking checksums
consolidated.00.pth: OK
consolidated.01.pth: OK
consolidated.02.pth: OK
consolidated.03.pth: OK
consolidated.04.pth: OK
consolidated.05.pth: OK
consolidated.06.pth: OK
consolidated.07.pth: OK
params.json: OK
tokenizer.model: OK
```

### 5. move and repack weights

#### Llama 3 70B
```bash
cd tt-studio
# set TT_STUDIO_ROOT on your host machine to be where you've cloned tt-studio
export TT_STUDIO_ROOT=$PWD
export PERSISENT_VOLUME=${TT_STUDIO_ROOT}/tt_studio_persistent_volume/volume_id_tt-metal-llama3-70bv0.0.1
# create directories in persistent volume
mkdir -p ${PERSISENT_VOLUME}/model_weights/repacked-llama-3-70b-instruct
mkdir -p ${PERSISENT_VOLUME}/tt_metal_cache/repacked-llama-3-70b-instruct
# assuming weights are downloaded to: ~/llama3/Meta-Llama-3-70B-Instruct/
cp -r ~/llama3/Meta-Llama-3-70B-Instruct ${PERSISENT_VOLUME}/model_weights/llama-3-70b-instruct
# copy tokenizer and params to repacked
cp ~/llama3/Meta-Llama-3-70B-Instruct/tokenizer.model ${PERSISENT_VOLUME}/model_weights/repacked-llama-3-70b-instruct/tokenizer.model
cp ~/llama3/Meta-Llama-3-70B-Instruct/params.json ${PERSISENT_VOLUME}/model_weights/repacked-llama-3-70b-instruct/params.json
```

#### Llama 2 70B (skip if you only want to run Llama 3 70B)
```bash
cd tt-studio
# set TT_STUDIO_ROOT on your host machine to be where you've cloned tt-studio
export TT_STUDIO_ROOT=$PWD
export PERSISENT_VOLUME=${TT_STUDIO_ROOT}/tt_studio_persistent_volume/volume_id_tt-metal-llama2-70bv0.0.1
# create directories in persistent volume
mkdir -p ${PERSISENT_VOLUME}/model_weights/repacked-llama-2-70b-chat
mkdir -p ${PERSISENT_VOLUME}/tt_metal_cache/repacked-llama-2-70b-chat
# assuming weights are downloaded to: ~/llama/llama-2-70b-chat
cp -r ~/llama/llama-2-70b-chat ${PERSISENT_VOLUME}/model_weights/llama-2-70b-chat
cp ~/llama/llama-2-70b-chat/tokenizer.model ${PERSISENT_VOLUME}/model_weights/repacked-llama-2-70b-chat/tokenizer.model
cp ~/llama/llama-2-70b-chat/params.json ${PERSISENT_VOLUME}/model_weights/repacked-llama-2-70b-chat/params.json
```

#### Repack the weights

Use the docker container to run the `repack_weights.py` script:
```bash
docker run \
  --rm \
  -it \
  --cap-add ALL \
  --device /dev/tenstorrent:/dev/tenstorrent \
  --env JWT_SECRET=test-secret-456 \
  --env CACHE_ROOT=/home/user/cache_root \
  --env HF_HOME=/home/user/cache_root/huggingface \
  --env MODEL_WEIGHTS_ID=id_repacked-llama-3-70b-instruct \
  --env MODEL_WEIGHTS_PATH=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct \
  --env LLAMA_VERSION=llama3 \
  --env TT_METAL_ASYNC_DEVICE_QUEUE=1 \
  --env WH_ARCH_YAML=wormhole_b0_80_arch_eth_dispatch.yaml \
  --env SERVICE_PORT=7000 \
  --volume /dev/hugepages-1G:/dev/hugepages-1G:rw \
  --volume ${TT_STUDIO_ROOT?ERROR env var TT_STUDIO_ROOT must be set}/tt_studio_persistent_volume/volume_id_tt-metal-llama3-70bv0.0.1:/home/user/cache_root:rw \
  --shm-size 32G \
  --publish 7000:7000 \
  tt-metal-llama3-70b-src-full-inference:v0.0.1-tt-metal-a053bc bash

# need to set path environment variables for demo scripts
export LLAMA3_CKPT_DIR=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct
export LLAMA3_TOKENIZER_PATH=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct/tokenizer.model
export LLAMA3_CACHE_PATH=/home/user/cache_root/tt_metal_cache/repacked-llama-3-70b-instruct
cd /tt-metal
# run script to repack weights, default chunk size is 5
python models/demos/t3000/llama2_70b/scripts/repack_weights.py /home/user/cache_root/model_weights/llama-3-70b-instruct ${LLAMA3_CKPT_DIR} 5
# for llama-2-70b-chat, tt_studio_persistent_volume for llama2 must be mounted instead of llama3 volume
export LLAMA2_CKPT_DIR=/home/user/cache_root/model_weights/repacked-llama-2-70b-instruct
export LLAMA2_TOKENIZER_PATH=/home/user/cache_root/model_weights/repacked-llama-2-70b-chat/tokenizer.model
export LLAMA2_CACHE_PATH=/home/user/cache_root/tt_metal_cache/repacked-llama-2-70b-chat
python models/demos/t3000/llama2_70b/scripts/repack_weights.py /home/user/cache_root/model_weights/llama-2-70b-chat ${LLAMA2_CKPT_DIR}/model_weights/repacked-llama-2-70b-chat 5
```

### 6. First run, create tt-metal weights cache

After 1st run you can use the "sampling" option to enable top p / top k sampling of logits for token generation. "greedy" option should be used for 1st run for caching of rotational matrices.

```bash
# need to set path environment variables for demo scripts
export LLAMA3_CKPT_DIR=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct
export LLAMA3_TOKENIZER_PATH=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct/tokenizer.model
export LLAMA3_CACHE_PATH=/home/user/cache_root/tt_metal_cache/repacked-llama-3-70b-instruct
# 1st run will generate the tt_metal_cache files in $LLAMA_CACHE_PATH, this will take ~60 minutes
python tt_metal_impl/demo/demo_llama3_first_run_4k.py
```

# System dependencies

All system dependencies are listed and installed in `llama3.src.full.inference.a053bc.Dockerfile`

## Firmware and drivers

firmware bundle: 80.8.12.0 (https://github.com/tenstorrent/tt-firmware/blob/3dd6b7804a333efff4908cedc109c5a081b46bd5/patches/fw_pack-80.8.12.0.fwbundle)

tt-kmd: 1.28 (https://github.com/tenstorrent/tt-kmd/tree/ttkmd-1.28)

Note: after flashing firmware, tt-topology must be run for mesh chip layout to re-establish mesh ethernet links (https://github.com/tenstorrent/tt-topology)

# Development

additionally add the src code as a volume mount so that it can be editted and rerun.

```bash
# set TT_STUDIO_ROOT on your host machine, this is also in the .env file if you want to use that
# export TT_STUDIO_ROOT=/home/tt-admin/projects/tt-studio
source app/.env
docker run \
  -it \
  --rm \
  --cap-add ALL \
  --device /dev/tenstorrent:/dev/tenstorrent \
  --env JWT_SECRET=test-secret-456 \
  --env CACHE_ROOT=/home/user/cache_root \
  --env HF_HOME=/home/user/cache_root/huggingface \
  --env MODEL_WEIGHTS_ID=id_repacked-llama-3-70b-instruct \
  --env MODEL_WEIGHTS_PATH=/home/user/cache_root/model_weights/repacked-llama-3-70b-instruct \
  --env LLAMA_VERSION=llama3 \
  --env TT_METAL_ASYNC_DEVICE_QUEUE=1 \
  --env WH_ARCH_YAML=wormhole_b0_80_arch_eth_dispatch.yaml \
  --env SERVICE_PORT=7000 \
  --volume /dev/hugepages-1G:/dev/hugepages-1G:rw \
  --volume ${TT_STUDIO_ROOT?ERROR env var TT_STUDIO_ROOT must be set}/tt_studio_persistent_volume/volume_id_tt-metal-llama3-70bv0.0.1:/home/user/cache_root:rw \
  --volume ${TT_STUDIO_ROOT}/models/tt-metal-llama3-70b/src:/home/user/tt-metal-llama3-70b/src:rw \
  --shm-size 32G \
  --publish 7000:7000 \
  tt-metal-llama3-70b-src-full-inference:v0.0.1-tt-metal-a053bc bash
```

## Run tests

### Test with mocks

The mock server and mock backend can be used for development on either component in isolation.
Importantly the mock implementations give a single thread synchronous implmentation for ease of debugging.

```bash
cd ~/tt-metal-llama3-70b/src
# within container, access backend mock with:
python test_llama3_70b_backend_mock.py
# access inference server mock (using backend mock) with:
python test_mock_inference_api_server.py
```

### Test with full on device backend

```bash
cd ~/tt-metal-llama3-70b/src
# test backend running on device
python test_llama3_70b_backend.py
```