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
4. [Run the mock vLLM model via the GUI](#7-deploy-and-run-the-model)

### **For vLLM Llama3.1-70B Model:**
1. [Clone repositories](#1-clone-required-repositories)
2. [Pull the model Docker image](#2-pull-the-desired-model-docker-images-using-docker-github-registry)
3. [Set up the Hugging Face (HF) token in the TT-Studio `.env` file](#3-set-up-environment-variables-and-hugging-face-token)
4. [Run the model setup script](#4-run-the-setup-script-vllm-llama31-70b-only)
5. [Update the vLLM Environment Variable in Environment File](#6-add-the-vllm-environment-variable-in-environment-file--copy-the-file-over-to-tt-studio-persistent-volume)
6. [Deploy and run inference for the Llama3.1-70B model via the GUI](#7-deploy-and-run-the-model)

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

Follow these step-by-step instructions for a smooth automated process of model weights setup.

1. **Navigate to the `vllm-tt-metal-llama3-70b/` folder** within the `tt-inference-server`. This folder contains the necessary files and scripts for model setup.

2. **Run the automated setup script** as outlined in the [official documentation](https://github.com/tenstorrent/tt-inference-server/tree/main/vllm-tt-metal-llama3-70b#5-automated-setup-environment-variables-and-weights-files:~:text=70b/docs/development-,5.%20Automated%20Setup%3A%20environment%20variables%20and%20weights%20files,-The%20script%20vllm). This script handles key steps such as configuring environment variables, downloading weight files, repacking weights, and creating directories.

**Note** During the setup process, you will see the following prompt:

   ```
   Enter your PERSISTENT_VOLUME_ROOT [default: tt-inference-server/tt_inference_server_persistent_volume]:
   ```

   **Do not accept the default path.** Instead, set the persistent volume path to `tt-studio/tt_studio_persistent_volume`. This ensures the configuration matches TT-Studio’s directory structure. Using the default path may result in incorrect configuration.

By following these instructions, you will have a properly configured model infrastructure, ready for inference and further development.



---

## 5. Folder Structure for Model Weights

Verify that the weights are correctly stored in the following structure:

```bash
/path/to/tt-studio/tt_studio_persistent_volume/
└── volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/
    ├── layers_0-4.pth
    ├── layers_5-9.pth
    ├── params.json
    └── tokenizer.model
```

**What to Look For:**
- Ensure all expected weight files (e.g., `layers_0-4.pth`, `params.json`, `tokenizer.model`) are present.
- If any files are missing, re-run the `setup.sh` script to complete the download.

This folder structure allows TT Studio to automatically recognize and access models without further configuration adjustments. For each model, verify that the weights are correctly copied to this directory to ensure proper access by TT Studio.


## 6. Copy the Environment File and Point to it in TT-Studio

### Step 1: Copy the Environment File
During the model weights download process, an `.env` file will be automatically created. The path to the `.env` file might resemble the following example:

```
/path/to/tt-inference-server/vllm-tt-metal-llama3-70b/.env
```

To ensure the model can be deployed via the TT-Studio GUI, this `.env` file must be copied to the model's persistent storage location. For example:

```bash
/path/to/tt_studio_persistent_volume/volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/copied_env
```

The following command can be used as a reference (*replace paths as necessary*):

```bash
sudo cp /$USR/tt-inference-server/vllm-tt-metal-llama3-70b/.env /$USR/tt_studio/tt_studio_persistent_volume/volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/.env
```

### Step 2: Point to the Copied Environment File
The `VLLM_LLAMA31_ENV_FILE` variable within the TT-Studio `$USR/tt-studio/app/.env` file must point to *this* copied `.env` file. This should be a **relative path**, for example it can be set as follows:

```
VLLM_LLAMA31_ENV_FILE="/tt_studio_persistent_volume/volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/.env"
```
---

### Step 2: Update the TT-Studio Environment File
After copying the `.env` file, update the `VLLM_LLAMA31_ENV_FILE` variable in the `tt-studio/app/.env` file to point to the **copied file path**. This ensures TT-Studio uses the correct environment configuration for the model.

```bash
VLLM_LLAMA31_ENV_FILE="/path/to/tt_studio_persistent_volume/volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/copied_env"
```

---
Here is an example of a complete `.env` file configuration for reference:

```bash
TT_STUDIO_ROOT=/Users/**username**/tt-studio
HOST_PERSISTENT_STORAGE_VOLUME=${TT_STUDIO_ROOT}/tt_studio_persistent_volume
INTERNAL_PERSISTENT_STORAGE_VOLUME=/tt_studio_persistent_volume
BACKEND_API_HOSTNAME="tt-studio-backend-api"
VLLM_LLAMA31_ENV_FILE="/path/to/tt_studio_persistent_volume/volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/**copied_env
# SECURITY WARNING: keep these secret in production!
JWT_SECRET=test-secret-456
DJANGO_SECRET_KEY=django-insecure-default
HF_TOKEN=hf_****
```

---

## 7. Deploy and Run the Model

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
If successful, you will receive a response from the model.


## You're All Set 🎉

With the setup complete, you’re ready to run inference on the vLLM models (or any other supported model(s)) within TT-Studio. Refer to the documentation and setup instructions in the repositories for further guidance.