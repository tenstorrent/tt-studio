# Running Llama and Mock vLLM Models in TT-Studio

This guide walks you through setting up vLLM Llama models and vLLM Mock models via the TT-Inference-Server, and then deploying them via TT-Studio.

## Supported Models

For the complete and up-to-date list of models supported by TT-Studio via TT-Inference-Server, please refer to [TT-Inference-Server GitHub README](https://github.com/tenstorrent/tt-inference-server/blob/main/README.md).

---

## Prerequisites

1. **Docker**: Make sure Docker is installed on your system. Follow the [Docker installation guide](https://docs.docker.com/engine/install/).

2. **Hugging Face Token**: Both models require authentication to Hugging Face repositories. To obtain a token, go to [Hugging Face Account](https://huggingface.co/settings/tokens) and generate a token. Additionally; make sure to accept the terms and conditions on Hugging Face for the the desired model. 

---

### **For vLLM Mock/ Llama Model(s):**
1. [Clone repositories](#1-clone-required-repositories)  
2. [Pull the model Docker image](#2-pull-the-desired-model-docker-images-using-docker-github-registry)  
3. [Run the model setup script](#3-run-the-setup-script)  
4. [Deploy and run inference for the model via the GUI](#5-deploy-and-run-the-model)

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

2. **Pull the Desried Model Docker Image:**
   ```bash
   docker pull ghcr.io/tenstorrent/tt-inference-server/:<model-image>:<image-tag>     
   ```

3. **Authenticate Your Terminal (Optional - If Pull Command Fails)):**
   ```bash
   echo YOUR_PAT | docker login ghcr.io -u YOUR_USERNAME --password-stdin
   ```

---
## 3. Run the Setup Script 

Follow these step-by-step instructions to smoothly automate the process of setting up model weights.

1. **Create the `tt_studio_persistent_volume` folder**  
   - Either create this folder manually inside `tt-studio/`, or run `./startup.sh` from within `tt-studio` to have it created automatically.

2. **Ensure folder permissions**  
   - Verify that you (the user) have permission to edit the newly created folder. If not, adjust ownership or permissions using commands like `chmod` or `chown`.

3. **Navigate to `tt-inference-server`**  
   - Consult the [README](https://github.com/tenstorrent/tt-inference-server?tab=readme-ov-file#model-implementations) to see which model servers are supported by TT-Studio.

4. **Run the automated setup script**  

   - **Execute the script**  
     Navigate to `tt-inference-server`, run:
     ```bash
     ./setup.sh **Model**
     ```
   
   - **Choose how to provide the model**  
     You will see:
     ```
     How do you want to provide a model?
     1) Download from 🤗 Hugging Face (default)
     2) Download from Meta
     3) Local folder
     Enter your choice:
     ```
     For first-time users, we recommend **option 1** (Hugging Face).

   - **Next Set `PERSISTENT_VOLUME_ROOT`**  
     The script will prompt you for a `PERSISTENT_VOLUME_ROOT` path. A default path will be suggested, but **do not accept the default**. Instead, specify the **absolute path** to your `tt-studio/tt_studio_persistent_volume` directory to maintain the correct structure. 
     Using the default path can lead to incorrect configurations.

   - **Validate token and set environment variables**  
     The script will:
     1. Validate your Hugging Face token (`HF_TOKEN`).
     2. Prompt you for an `HF_HOME` location (default is often `~/.cache/huggingface`).
     3. Ask for a JWT secret, which should match the one in `tt-studio/app/.env` (commonly `test-secret-456`).

By following these steps, your tt-inference-server model infrastructure will be correctly configured and ready for inference via the TT-Studio GUI.

---

## 4. Folder Structure for Model Weights

When using the setup script it creates (or updates) specific directories and files within your `tt_studio_persistent_volume` folder. Here’s what to look for:

1. **Model Weights Directories**  
   Verify that the weights are correctly stored in a directory similar to:
   ```bash
   /path/to/tt-studio/tt_studio_persistent_volume/
   ├── model_envs
   │   └── Llama-3.1-70B-Instruct.env
   └── volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/
      ├── layers_0-4.pth
      ├── layers_5-9.pth
      ├── params.json
      └── tokenizer.model

   ```
   - Ensure all expected weight files (e.g., `layers_0-4.pth`, `params.json`, `tokenizer.model`) are present.  
   - If any files are missing, re-run the `setup.sh` script to complete the download.

2. **`model_envs` Folder**  
   Within your `tt_studio_persistent_volume`, you will also find a `model_envs` folder (e.g., `model_envs/Llama-3.1-8B-Instruct.env`).  
   - Each `.env` file contains the values you input during the setup script run (e.g., `HF_TOKEN`, `HF_HOME`, `JWT_SECRET`).  
   - Verify that these environment variables match what you entered; if you need to adjust them, re-run the setup process.

This folder and file structure allows TT-Studio to automatically recognize and access models without any additional configuration steps.

---

## 5. Deploy and Run the Model

1. **Start TT-Studio:** Run TT-Studio using the startup command.
2. **Access Model Weights:** In the TT-Studio interface, navigate to the model weights section.
3. **Select Weights:** Select the model weights.
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


#### iv. Sample Command for Changing Ownership (chown)

If you need to adjust permissions for the `tt_studio_persistent_volume` folder, first determine your user and group IDs by running: (*replace paths as necessary*)

```bash
id
```

You will see an output similar to:

```
uid=1001(youruser) gid=1001(yourgroup) groups=...
```

Use these numeric IDs to set the correct ownership. For example:

```bash
sudo chown -R 1001:1001 /home/youruser/tt-studio/tt_studio_persistent_volume/
```

Replace `1001:1001` with your actual UID:GID and `/home/youruser/tt-studio/tt_studio_persistent_volume/` with the path to your persistent volume folder.



## You're All Set 🎉

With the setup complete, you’re ready to run inference on the vLLM models (or any other supported model(s)) within TT-Studio. Refer to the documentation and setup instructions in the repositories for further guidance.