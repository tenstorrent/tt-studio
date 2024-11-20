# Running Llama3.1-70B in TT-Studio

This guide provides a step-by-step process to set up and deploy models like Llama3.1-70B using TT-Studio. You will need access to both `tt-studio` and `tt-inference-server` repositories to complete the setup.

## Prerequisites

1. **Docker**: Make sure Docker is installed on your system. Follow the [Docker installation guide](https://docs.docker.com/engine/install/).
2. **Model Access**: Register with Meta to access models such as Llama3.1 Instruct. Download links can be found on Meta's official site: [Llama Downloads](https://www.llama.com/llama-downloads/). You will need to download model weights from this site for use in TT-Studio.

---

## Steps for Setup and Deployment

### 1. Clone Required Repositories

Start by cloning both the `tt-studio` and `tt-inference-server` repositories. Use the `main` branch in `tt-studio` for the latest stable features.

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

### 2. Set Up TT Inference for Llama

Navigate to the directory in `tt-inference-server` corresponding to the specific model you’re setting up (e.g., `Llama3.1-70B`).

```bash
cd /path/to/tt-inference-server/vllm-tt-metal-llama3-70b
```

### 3. Run the Setup Script

The `setup.sh` script will handle all required downloads and configurations. Run it to initiate the setup, selecting the desired model when prompted.

```bash
sudo ./setup.sh llama-3-70b-instruct
```

- **Overwrite Prompt**: When prompted to overwrite the `.env` file, confirm with `y`.
- **Persistent Storage Path**: Enter the path to your persistent volume where model data will be stored, which should align with `tt_studio_persistent_volume`.

> **Example**:
>
> ```bash
> Enter your PERSISTENT_VOLUME_ROOT [default: /path/to/tt-inference-server/persistent_volume]: /path/to/tt-studio/tt_studio_persistent_volume
> ```

Ensure the directory path you specify matches the expected format. This will enable TT-Studio to access the model weights and configurations seamlessly.

### 4. Additional Configuration Details

During setup, you’ll be prompted to provide the following information:

- **Model Repository Clone Path**: Specify where the Llama model repository should be cloned (default: `/path/to/llama-models`).
- **JWT_SECRET**: For local usage, you can enter any valid JWT token.

Here’s an example of what the setup dialogue might look like:

```bash
REPO_ROOT: /path/to/tt-inference-server
MODEL_PATH: /path/to/tt-inference-server/vllm-tt-metal-llama3-70b
ENV_FILE: /path/to/tt-inference-server/vllm-tt-metal-llama3-70b/.env
Overwriting the .env file...
Enter your PERSISTENT_VOLUME_ROOT: /path/to/tt-studio/tt_studio_persistent_volume
Enter the path to clone the Llama model repository: /path/to/llama-models
Enter your JWT_SECRET:
```

---

### 5. Folder Structure for Model Weights

The `setup.sh` script within `tt-inference` will automatically handle downloading and organizing the model weights. However, it’s essential to verify that the weights are correctly stored in the following structure:

```
/path/to/tt-studio/tt_studio_persistent_volume/
└── volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/
    ├── layers_0-4.pth
    ├── layers_5-9.pth
    ├── layers_10-14.pth
    ├── ...
    ├── params.json
    └── tokenizer.model
```

**What to Look For**:

- Ensure all expected weight files (e.g., `layers_0-4.pth`, `params.json`, `tokenizer.model`) are present.
- If any files are missing, re-run the `setup.sh` script to complete the download.

This folder structure allows TT Studio to automatically recognize and access models without further configuration adjustments. For each model, verify that the weights are correctly copied to this directory to ensure proper access by TT Studio.

---

### 6. Setting Up Additional Models

To set up additional models, repeat the setup process, specifying the model name when prompted.

For example, to set up the Llama 7B model, use:

```bash
sudo ./setup.sh llama-7b
```

For additional configuration details for other models, refer to the [tt-inference-server README](https://github.com/tenstorrent/tt-inference-server).

---

### 8. Deploying the Model and Running Inference

Once the setup is complete and the persistent volume is correctly configured, you’re ready to deploy the model and start running inference in TT-Studio. Follow these steps:

1. **Start TT-Studio**: Run TT-Studio by executing the startup command or accessing it through your chosen method.
2. **Access Model Weights**: In the TT-Studio interface, navigate to the model weights section.

3. **Select Custom Weights**: Choose the option to use custom weights.

4. **Choose Repacked Weights**: In the GUI, select the repacked weights for the Llama model that you previously set up.

5. **Run the Model**: Initiate the model run.

6. **Wait for Initial Setup**: For the first run, model initialization may take approximately 70 minutes as weights and configurations are loaded. For subsequent runs, expect a setup time of about 5-7 minutes before inference starts.

---

## Troubleshooting: Why Llama Outputs May Seem Unusual

If you encounter unexpected or "weird" outputs from the Llama model or if the model fails to run inference, here are a few common troubleshooting steps:

1. **Check Model Weights**: Ensure that the model weights are correctly organized and placed in the persistent volume, following the folder structure shown above. You can monitor the logs in real-time to verify if the `tt_metal_cache` directory is created by using:

   ```bash
   tail -f /path/to/tt_studio_persistent_volume/volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/logs/python_logs
   ```

   The `tt_metal_cache` directory will be created automatically when the model runs. This process may take up to an hour during initial setup, so it’s normal for the directory to appear only after some time. If the directory does not appear immediately, continue monitoring the logs until the cache is fully initialized.

2. **Verify Environment Variables**: Double-check the `.env` configurations to ensure that paths, secrets, and model names are accurately specified. Incorrect environment variables can lead to runtime errors or misconfigurations.

3. **Inspect Persistent Storage Logs**: You can inspect the logs stored in the persistent storage directory to identify any issues during initialization or runtime. These logs, located in `tt_studio_persistent_volume/volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/logs/python_logs`, may contain errors or warnings that provide insights into potential misconfigurations. Use the following commands to view the logs:

   ```bash
   # To view the entire log file
   cat /path/to/tt_studio_persistent_volume/volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/logs/python_logs

   # To see recent entries or monitor in real-time
   tail -f /path/to/tt_studio_persistent_volume/volume_id_tt-metal-llama-3.1-70b-instructv0.0.1/logs/python_logs
   ```

---

## You're All Set!

With the setup complete, you’re ready to run inference on the Llama3.1-70B model (or any other supported model) within TT-Studio. Refer to the documentation and setup instructions in the repositories for further guidance.
