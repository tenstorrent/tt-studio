<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC -->

# Running Llama3.1-70B and Mock vLLM Models in TT-Studio

This guide provides step-by-step instructions on setting up and deploying vLLM Llama3.1-70B and vLLM Mock models using TT-Studio.

---

## Prerequisites

1. **Docker**: Make sure Docker is installed on your system. Follow the [Docker installation guide](https://docs.docker.com/engine/install/).

2. **Hugging Face Token**: Both models require authentication to Hugging Face repositories. To obtain a token, go to [Hugging Face Account](https://huggingface.co/settings/tokens) and generate a token. Additionally; make sure to accept the terms and conditions on Hugging Face for the Llama3.1 models by visiting [Hugging Face Meta-Llama Page](https://huggingface.co/meta-llama/Llama-3.1-70B-Instruct).

3. **Model Access Weight**: To access specific models like Llama3.1, you may need to register with Meta to obtain download links for model weights. Visit [Llama Downloads](https://www.llama.com/llama-downloads/) for more information.

---

## Instructions Overview

### **For Mock vLLM Model:**

1. [Clone repositories](#1-clone-required-repositories)
2. [Pull the mock model Docker image](#2-pull-the-desired-model-docker-images-using-docker-github-registry)
3. [Set up the Hugging Face (HF) token](#3-set-up-environment-variables-and-hugging-face-token)
4. [Run the mock vLLM model via the GUI](#6-deploy-and-run-the-model)

### **For vLLM Llama3.1-70B Model:**

1. [Clone repositories](#1-clone-required-repositories)
2. [Pull the model Docker image](#2-pull-the-desired-model-docker-images-using-docker-github-registry)
3. [Set up the Hugging Face (HF) token in the TT-Studio `.env` file](#3-set-up-environment-variables-and-hugging-face-token)
4. [Run the model setup script](#4-run-the-setup-script-vllm-llama31-70b-only)
5. [Post Setup Steps](#5-post-setup-steps)
6. [Deploy and run inference for the Llama3.1-70B model via the GUI](#6-deploy-and-run-the-model)

[Troubleshooting](#troubleshooting)

---

## 1. Clone Required Repositories

Start by cloning both the `tt-studio` and `tt-inference-server` repositories.

```bash
# Clone tt-studio
git clone https://github.com/tenstorrent/tt-studio
cd tt-studio

# Make the setup script executable
chmod +x startup.sh

# Clone `tt-inference-server` into a separate directory
cd ..
git clone https://github.com/tenstorrent/tt-inference-server
```

---

## 2. Pull the Desired Model Docker Images Using Docker GitHub Registry

1. **Navigate to the Docker Images:**

   - Visit [TT-Inference-Server GitHub Packages](https://github.com/orgs/tenstorrent/packages?repo_name=tt-inference-server).

2. **Pull the Docker Image:**

   ```bash
   docker pull ghcr.io/tenstorrent/tt-inference-server:<image-tag>
   ```

   We suggest using this package as of now : https://github.com/tenstorrent/tt-inference-server/pkgs/container/tt-inference-server%2Ftt-metal-llama3-70b-src-base-vllm-ubuntu-20.04-amd64

3. **Authenticate Your Terminal (Optional):**
   ```bash
   echo YOUR_PAT | docker login ghcr.io -u YOUR_USERNAME --password-stdin
   ```

---

## 3. Set Up Environment Variables and Hugging Face Token

Add the Hugging Face Token within the `.env` file in the `tt-studio/app/` directory.

```bash
HF_TOKEN=hf_********
```

---

## 4. Run the Setup Script (vLLM Llama3.1-70B only)

1. Navigate to the `tt-inference-server` repository, which contains the available model configurations for inference setup.

2. Execute the automated setup script following the [official documentation](https://github.com/tenstorrent/tt-inference-server/blob/main/setup.sh). The script will:
   - Configure environment variables
   - Download weight files
   - Repack weights
   - Create required directories

**Note:** During script execution, you'll need to respond to setup prompts. See the [Model Setup Guide](#setup-process) section below for detailed prompt responses.

#### Setup Process

#### 1. Persistent Volume Path

You will see the following prompt:

```
Enter your PERSISTENT_VOLUME_ROOT [default: /path/to/tt-inference-server/tt_inference_server_persistent_volume]:
```

**Important:**  
**Do not accept the default path.** Instead, specify the path to your TT-Studio installation's persistent volume:

```
tt-studio/tt_studio_persistent_volume
```

This ensures compatibility with the TT-Studio directory structure. Using the default path may result in misconfiguration and potential issues during model deployment.

---

#### 2. Hugging Face Authorization

You will be asked:

```
Use :hugging_face: Hugging Face authorization token for downloading models? Alternative is direct authorization from Meta. (y/n) [default: y]:
```

- If you choose `y`, ensure that you have your **Hugging Face token** ready to provide when prompted.
- If your desired model is deprecated or unavailable through Hugging Face, you can opt for Meta's direct download instead by selecting `n`.

---

#### 3. Model Weights Verification

After setup, confirm that the model weights have been downloaded correctly by checking the directory contents. The setup script will output a message like:

```
Model weights already exist at: /path/to/persistent_volume/model_weights/repacked-llama-3.1-70b-instruct
```

You can manually verify the contents using the command:

```
ls -lh /path/to/persistent_volume/model_weights/repacked-llama-3.1-70b-instruct
```

Ensure that all necessary files (e.g., `.pth` weight files, `params.json`, `tokenizer.model`) are present.  
**If the contents are incorrect or missing,** delete the directory and rerun the setup script to re-download the model weights.

---

#### 4. Folder Permissions

During the setup, permissions are automatically configured to allow the necessary access. The script will:

- Add the user to the required group (e.g., `dockermount`).
- Set ownership and file permissions for proper container and host access.

If you face permission issues, **rerun the setup script** to adjust folder permissions accordingly.

---

#### 5. Completion and Next Steps

Once the setup completes, you will see confirmation messages like:

```
setup_model_environment completed!
setup_permissions completed!
```

---

#### 6. Folder Structure for Model Weights

Verify that the weights are correctly stored in the following structure:

```bash
/path/to/tt-studio/tt_studio_persistent_volume/
└── model_weights/
    ├── llama-3.1-70b-instruct/
    │   ├── consolidated.00.pth
    │   ├── consolidated.01.pth
    │   ├── consolidated.02.pth
    │   ├── consolidated.03.pth
    │   ├── consolidated.04.pth
    │   ├── consolidated.05.pth
    │   ├── consolidated.06.pth
    │   ├── consolidated.07.pth
    │   ├── params.json
    │   └── tokenizer.model
    ├── repacked-llama-3.1-70b-instruct/
    │   ├── layers_0-4.pth
    │   ├── layers_5-9.pth
    │   ├── layers_10-14.pth
    │   ├── layers_15-19.pth
    │   ├── layers_20-24.pth
    │   ├── layers_25-29.pth
    │   ├── layers_30-34.pth
    │   ├── layers_35-39.pth
    │   ├── layers_40-44.pth
    │   ├── layers_45-49.pth
    │   ├── layers_50-54.pth
    │   ├── layers_55-59.pth
    │   ├── layers_60-64.pth
    │   ├── layers_65-69.pth
    │   ├── layers_70-74.pth
    │   ├── layers_75-79.pth
    │   ├── params.json
    │   └── tokenizer.model
```

**What to Look For:**

- Ensure all expected weight files (e.g., `layers_0-7.pth`, `params.json`, `tokenizer.model`) are present.
- If any files are missing, re-run the `setup.sh` script to complete the download.

This folder structure allows TT Studio to automatically recognize and access models without further configuration adjustments. For each model, verify that the weights are correctly copied to this directory to ensure proper access by TT Studio.

---

## 5. Post Setup Steps

### Copying the Model Environment Folder

Follow these steps to copy and configure the `model_env` directory:

**Step 1: Locate the generated `model_env` folder**  
After the setup is complete, the `model_env` directory will be generated at:

```
$USR/tt-inference-server/persistent_volume/model_env
```

**Step 2: Copy the `model_envs` directory**  
Copy the entire `model_envs` structure to the TT-Studio persistent volume using the command:

```
cp -r /path/to/tt-inference-server/persistent_volume/model_envs /path/to/tt_studio_persistent_volume/
```

**Step 3: Update the Environment File**  
Modify the [`tt-studio/app/.env` ](app/.env) file to reflect the new environment path:

```
VLLM_LLAMA31_ENV_FILE="/tt_studio_persistent_volume/model_envs/llama-3.1-70b-instruct.env"
```

**Note:**  
Ensure to use relative paths as Docker mounts paths internally.

---

## 6. Deploy and Run the Model

1. **Start TT-Studio:** Run TT-Studio using the startup command.
2. **Access Model Weights:** In the TT-Studio interface, navigate to the model weights section.
3. **Select Custom Weights:** Use the custom weights option to select the weights for Llama3.1-70B.
4. **Run the Model:** Start the model and wait for it to initialize.

---

## Troubleshooting

### Verify Model Container Functionality

#### i. View Container Logs

To view real-time logs from the container, use the following command:

```bash
docker logs -f <container_id>
```

During container initialization, you may encounter log entries like the following, which indicate that the vLLM server has started successfully:

```bash
INFO 12-11 08:10:36 tt_executor.py:67] # TT blocks: 2068, # CPU blocks: 0
INFO 12-11 08:10:36 tt_worker.py:66] Allocating kv caches
INFO 12-11 08:10:36 api_server.py:232] vLLM to use /tmp/tmp3ki28i0p as PROMETHEUS_MULTIPROC_DIR
INFO 12-11 08:10:36 launcher.py:19] Available routes are:
INFO 12-11 08:10:36 launcher.py:27] Route: /openapi.json, Methods: GET, HEAD
INFO 12-11 08:10:36 launcher.py:27] Route: /docs, Methods: GET, HEAD
INFO 12-11 08:10:36 launcher.py:27] Route: /docs/oauth2-redirect, Methods: GET, HEAD
INFO 12-11 08:10:36 launcher.py:27] Route: /redoc, Methods: GET, HEAD
INFO 12-11 08:10:36 launcher.py:27] Route: /health, Methods: GET
INFO 12-11 08:10:36 launcher.py:27] Route: /tokenize, Methods: POST
INFO 12-11 08:10:36 launcher.py:27] Route: /detokenize, Methods: POST
INFO 12-11 08:10:36 launcher.py:27] Route: /v1/models, Methods: GET
INFO 12-11 08:10:36 launcher.py:27] Route: /version, Methods: GET
INFO 12-11 08:10:36 launcher.py:27] Route: /v1/chat/completions, Methods: POST
INFO 12-11 08:10:36 launcher.py:27] Route: /v1/completions, Methods: POST
INFO:     Application startup complete.
```

---

#### ii. Access the Container Shell

To access the container's shell for debugging or manual inspection, use the following command:

```bash
docker exec -it <container_id> bash
```

Use `env` to check environment variables or run commands directly to inspect the environment. To verify if the server is running properly, you can attempt to manually start it by running:

```bash
python ***_vllm_api_server.py
```

This will allow you to check for any startup errors or issues directly from the container's shell.

---

#### iii. Send Test Requests to the vLLM Server

```bash
curl -s --no-buffer -X POST "http://localhost:7000/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"model":"meta-llama/Llama-3.1-70B-Instruct","messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"Hi"}]}'
```

#### iv. Hugging Face not Authenticated 

If you encounter an error message such as:

```bash
huggingface_hub.errors.RepositoryNotFoundError: 404 Client Error. (Request ID: Root=1-6790f41f-2319b1605981a56e6b8b4461;49eb99dc-ba2b-4ecb-99b0-8a2d2ebe8888)

Repository Not Found for url: https://huggingface.co/api/models/meta-llama/Llama-3-8B/revision/main.
Please make sure you specified the correct `repo_id` and `repo_type`.
If you are trying to access a private or gated repo, make sure you are authenticated.
```

Please visit the model's page on Hugging Face and request access if necessary.

#### v. Invalid Mesh Device Shape Error

```bash
File "/home/user/vllm/vllm/model_executor/model_loader/tt_loader.py", line 25, in load_model
    model = model_class.initialize_vllm_model(model_config.hf_config, device_config.device, scheduler_config.max_num_seqs)
  File "/tt-metal/models/demos/t3000/llama2_70b/tt/generator_vllm.py", line 47, in initialize_vllm_model
    assert mesh_rows == 2 and mesh_cols == 4, f"Invalid mesh device shape: {mesh_rows}x{mesh_cols}"

```

Run the TT Topology setup:
Follow the instructions provided in the [TT Topology](https://github.com/tenstorrent/tt-topology?tab=readme-ov-file#mesh) repository to configure the correct mesh settings.

## You're All Set 🎉

With the setup complete, you’re ready to run inference on the vLLM models (or any other supported model(s)) within TT-Studio. Refer to the documentation and setup instructions in the repositories for further guidance.
