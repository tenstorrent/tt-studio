# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# docker_control/docker_utils.py
import socket, os, subprocess, json, signal, threading
import copy, re, time
from pathlib import Path
from typing import Tuple, Optional

import docker
from django.core.cache import caches

from shared_config.device_config import DeviceConfigurations
from shared_config.logger_config import get_logger
from shared_config.model_config import model_implmentations
from shared_config.backend_config import backend_config
from shared_config.setup_config import SetupTypes


CONFIG_PATH = "/root/.config/tenstorrent/reset_config.json"
logger = get_logger(__name__)
logger.info(f"importing {__name__}")
client = docker.from_env()

# docker internal bridge network used for models and applications.
networks = client.networks.list()
if backend_config.docker_bridge_network_name not in [net.name for net in networks]:
    network = client.networks.create(
        backend_config.docker_bridge_network_name, driver="bridge"
    )


def run_tt_inference_server(model_name: str, device: str, port: int, hf_token: str, jwt_secret: str) -> Tuple[bool, Optional[str]]:
    """
    Run a model using TT Inference Server infrastructure following the official user guide.
    
    Args:
        model_name: HuggingFace model name (e.g., "meta-llama/Llama-3.2-3B-Instruct")
        device: Device name (n150, n300, t3k, galaxy) 
        port: Host port to bind the service to
        hf_token: HuggingFace authentication token
        jwt_secret: JWT secret for authentication
        
    Returns:
        Tuple of (success: bool, container_name: Optional[str])
    """
    try:
        logger.info("🚀 ============= Starting TT Inference Server Integration =============")
        logger.info(f"📋 Model: {model_name}")
        logger.info(f"🖥️  Device: {device}")
        logger.info(f"🔌 Port: {port}")
        logger.info(f"🔐 HF Token: {'✅ Provided' if hf_token else '❌ Missing'}")
        logger.info(f"🔑 JWT Secret: {'✅ Provided' if jwt_secret else '❌ Missing'}")
        
        # TT Inference Server path - mounted as volume in container
        tt_inference_server_path = os.environ.get("TT_INFERENCE_SERVER_PATH", "/tt-inference-server")
        logger.info(f"📁 TT Inference Server Path: {tt_inference_server_path}")
        
        # Verify the path exists
        if not os.path.exists(tt_inference_server_path):
            logger.error(f"❌ TT Inference Server path does not exist: {tt_inference_server_path}")
            return False, None
        
        # Map internal device configurations to TT Inference Server device names
        device_name_map = {
            "0": "n300",  # Default fallback
            "n150": "n150",
            "n300": "n300", 
            "t3k": "t3k",      # Fix: t3k should map to t3k
            "t3000": "t3k",    # Alternative name for t3k
            "galaxy": "galaxy"
        }
        tt_device_name = device_name_map.get(device, "n300")
        logger.info(f"🔄 Mapped device '{device}' → '{tt_device_name}'")
        
        # Prepare the command following the official guide format
        cmd = [
            "python3", "run.py",
            "--model", model_name,
            "--workflow", "server", 
            "--device", tt_device_name,
            "--docker-server",
            "--service-port", str(port)
        ]
        
        logger.info(f"💻 Command: {' '.join(cmd)}")
        logger.info(f"📂 Working Directory: {tt_inference_server_path}")
        
        # Prepare environment for the subprocess, as per the official guide
        sub_env = os.environ.copy()
        logger.info("🔧 Preparing environment for TT Inference Server script...")
        if hf_token:
            sub_env['HF_TOKEN'] = hf_token
            logger.info("   • HF_TOKEN set in subprocess environment.")
        if jwt_secret:
            sub_env['JWT_SECRET'] = jwt_secret
            logger.info("   • JWT_SECRET set in subprocess environment.")

        # Prepare input responses for the interactive prompts (following official guide sequence)
        # For tt-studio integration, use the HOST persistent volume path (not the internal container path)
        # The TT Inference Server needs the host filesystem path to mount volumes correctly
        persistent_volume_path = os.environ.get("HOST_PERSISTENT_STORAGE_VOLUME", "/app/tt_studio_persistent_volume")
        
        # Pre-flight checks before running TT Inference Server
        logger.info("🔍 Running pre-flight checks...")
        
        # Check if Docker is accessible
        try:
            docker_info = client.info()
            logger.info(f"✅ Docker is accessible (version: {docker_info.get('ServerVersion', 'unknown')})")
        except Exception as e:
            logger.error(f"❌ Docker is not accessible: {e}")
            return False, None
        
        # Check if persistent volume path exists and is writable (use internal path for this check)
        internal_persistent_volume_path = os.environ.get("INTERNAL_PERSISTENT_STORAGE_VOLUME", "/app/tt_studio_persistent_volume")
        if not os.path.exists(internal_persistent_volume_path):
            logger.error(f"❌ Internal persistent volume path does not exist: {internal_persistent_volume_path}")
            return False, None
        elif not os.access(internal_persistent_volume_path, os.W_OK):
            logger.error(f"❌ Internal persistent volume path is not writable: {internal_persistent_volume_path}")
            return False, None
        else:
            logger.info(f"✅ Internal persistent volume path exists and is writable: {internal_persistent_volume_path}")
        
        # Check if we can access TT hardware (if available)
        if os.path.exists("/dev/tenstorrent"):
            logger.info("✅ TT hardware device found: /dev/tenstorrent")
        else:
            logger.warning("⚠️  TT hardware device not found: /dev/tenstorrent")
        logger.info(f"💾 Host Persistent Volume Path (for TT Inference Server): {persistent_volume_path}")
        logger.info(f"💾 Internal Persistent Volume Path (for validation): {internal_persistent_volume_path}")
        
        input_responses = [
            persistent_volume_path,             # persistent_volume_root for tt-studio
            "1",                               # Choose Hugging Face download mode (option 1) 
            hf_token,                          # HF_TOKEN
            "",                                # host_hf_home (press enter for default)
            jwt_secret                         # JWT_SECRET
        ]
        input_text = "\n".join(input_responses) + "\n"
        
        logger.info("📝 Input responses prepared:")
        for i, response in enumerate(input_responses, 1):
            if i == 3:  # HF_TOKEN
                logger.info(f"   {i}. {'[HF_TOKEN]' if response else '[EMPTY]'}")
            elif i == 5:  # JWT_SECRET
                logger.info(f"   {i}. {'[JWT_SECRET]' if response else '[EMPTY]'}")
            else:
                logger.info(f"   {i}. {response if response else '[EMPTY/DEFAULT]'}")
        
        # Get existing container IDs to identify the new one later
        try:
            logger.info("🔍 Getting list of existing containers before running script...")
            existing_containers = client.containers.list(all=True)
            existing_container_ids = {c.id for c in existing_containers}
            logger.info(f"   • Found {len(existing_container_ids)} existing containers.")
        except Exception as e:
            logger.error(f"❌ Failed to list docker containers before script execution: {e}")
            return False, None

        # Start the process and wait for it to complete
        logger.info("🔄 Starting TT Inference Server process and waiting for completion...")
        process = subprocess.Popen(
            cmd,
            cwd=tt_inference_server_path,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            universal_newlines=True,
            env=sub_env
        )
        
        # Send inputs and get output
        try:
            logger.info("📤 Sending input responses to process...")
            stdout, stderr = process.communicate(input=input_text, timeout=300) # 5 min timeout
            logger.info("✅ TT Inference Server script finished.")
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
            logger.error("❌ TT Inference Server script timed out after 5 minutes.")
            logger.error(f"--- STDOUT ---\n{stdout}")
            logger.error(f"--- STDERR ---\n{stderr}")
            return False, None
        except Exception as e:
            logger.error(f"❌ Error communicating with process: {e}")
            process.kill()
            return False, None

        # Log output for debugging purposes
        logger.info("--- Full output from 'run.py' script ---")
        if stdout:
            logger.info("--- STDOUT ---")
            for line in stdout.strip().split('\n'):
                logger.info(f"  > {line}")
        if stderr:
            logger.error("--- STDERR ---")
            for line in stderr.strip().split('\n'):
                logger.error(f"  > {line}")
        logger.info("---------------------------------------------------------")

        if process.returncode != 0:
            logger.error(f"❌ 'run.py' script failed with a non-zero exit code: {process.returncode}")
            return False, None

        # Find the new container that was created
        container_id = None
        container_name = None
        try:
            logger.info("🔍 Getting list of containers after running script to find the new one...")
            all_containers = client.containers.list(all=True)  # Include stopped containers
            all_container_ids = {c.id for c in all_containers}
            new_container_ids = all_container_ids - existing_container_ids
            
            if len(new_container_ids) == 1:
                container_id = new_container_ids.pop()
                logger.info(f"✅ Found one new container with ID: {container_id}")
            elif len(new_container_ids) == 0:
                logger.error("❌ No new container was created by the script. Checking for containers that may have started and stopped...")
                
                # Check for containers that were created recently but may have stopped
                import time
                current_time = time.time()
                recent_containers = []
                for container in all_containers:
                    created_time = container.attrs.get('Created')
                    if created_time:
                        # Parse the created time and check if it's within the last 10 minutes
                        from datetime import datetime
                        try:
                            # Docker uses ISO format: "2025-06-10T23:10:05.123456789Z"
                            created_dt = datetime.fromisoformat(created_time.replace('Z', '+00:00'))
                            created_timestamp = created_dt.timestamp()
                            if current_time - created_timestamp < 600:  # Last 10 minutes
                                recent_containers.append(container)
                        except Exception as parse_e:
                            logger.warning(f"Could not parse created time {created_time}: {parse_e}")
                
                if recent_containers:
                    logger.error(f"Found {len(recent_containers)} containers created recently:")
                    for container in recent_containers:
                        logger.error(f"   • {container.name} ({container.id[:12]}) - Status: {container.status}")
                        
                        # Try to get logs from this container
                        try:
                            logs = container.logs().decode('utf-8')
                            if logs.strip():
                                logger.error(f"❌ Logs from container {container.name}:")
                                for line in logs.split('\n')[-30:]:  # Last 30 lines
                                    if line.strip():
                                        logger.error(f"   [docker-log] {line}")
                        except Exception as log_error:
                            logger.error(f"❌ Could not retrieve logs from {container.name}: {log_error}")
                
                # Try to read the workflow log file mentioned in the stdout
                logger.info("🔍 Attempting to read workflow log file...")
                try:
                    # Parse the log file path from stdout if available
                    log_file_path = None
                    if stdout:
                        for line in stdout.split('\n'):
                            if 'workflow_logs/docker_server/' in line and '.log' in line:
                                # Extract the path after "log file: "
                                parts = line.split('log file: ')
                                if len(parts) > 1:
                                    log_file_path = parts[1].strip()
                                    break
                    
                    if log_file_path and os.path.exists(log_file_path):
                        logger.error(f"📖 Reading workflow log file: {log_file_path}")
                        with open(log_file_path, 'r') as f:
                            log_content = f.read()
                            for line in log_content.split('\n')[-50:]:  # Last 50 lines
                                if line.strip():
                                    logger.error(f"   [workflow-log] {line}")
                    else:
                        # Try to find any recent log files in the workflow logs directory
                        log_dir = "/tt-inference-server/workflow_logs/docker_server/"
                        if os.path.exists(log_dir):
                            log_files = [f for f in os.listdir(log_dir) if f.endswith('.log')]
                            if log_files:
                                # Get the most recent log file
                                latest_log = max([os.path.join(log_dir, f) for f in log_files], key=os.path.getmtime)
                                logger.error(f"📖 Reading latest workflow log file: {latest_log}")
                                with open(latest_log, 'r') as f:
                                    log_content = f.read()
                                    for line in log_content.split('\n')[-50:]:  # Last 50 lines
                                        if line.strip():
                                            logger.error(f"   [workflow-log] {line}")
                            else:
                                logger.error(f"❌ No log files found in {log_dir}")
                        else:
                            logger.error(f"❌ Workflow log directory not found: {log_dir}")
                            
                except Exception as log_read_error:
                    logger.error(f"❌ Error reading workflow log files: {log_read_error}")
                
                return False, None
            else:
                logger.error(f"❌ Expected 1 new container, but found {len(new_container_ids)}: {new_container_ids}")
                # This could happen in a race condition, picking the most recent one as a fallback
                # For now, we will fail to be safe.
                return False, None
                
        except Exception as e:
            logger.error(f"❌ Failed to list docker containers after script execution: {e}")
            return False, None
            
        # Get container object using the ID and debug its status
        try:
            container = client.containers.get(container_id)
            container_name = container.name
            logger.info(f"🎯 Successfully retrieved container: {container_name}")
            logger.info(f"📊 Container details:")
            logger.info(f"   • ID: {container.id[:12]}")
            logger.info(f"   • Name: {container.name}")
            logger.info(f"   • Status: {container.status}")
            
            # Check if container is actually running
            if container.status != 'running':
                logger.error(f"❌ Container {container_name} is not running (status: {container.status})")
                
                # Get container logs to see what went wrong
                try:
                    logs = container.logs(tail=50).decode('utf-8')
                    logger.error(f"❌ Container logs (last 50 lines):")
                    for line in logs.split('\n')[-20:]:  # Show last 20 lines
                        if line.strip():
                            logger.error(f"   {line}")
                except Exception as log_error:
                    logger.error(f"❌ Could not retrieve container logs: {log_error}")
                
                # Get container exit code if available
                try:
                    exit_code = container.wait(timeout=1)
                    logger.error(f"❌ Container exit code: {exit_code}")
                except Exception as wait_error:
                    logger.warning(f"⚠️  Could not get exit code: {wait_error}")
                
                return False, None
                
        except docker.errors.NotFound:
            logger.error(f"❌ Container {container_id} not found in Docker")
            # Let's check what containers are actually running
            try:
                running_containers = client.containers.list()
                logger.error(f"❌ Currently running containers ({len(running_containers)}):")
                for c in running_containers:
                    logger.error(f"   • {c.name} ({c.id[:12]}) - {c.status}")
            except Exception as list_error:
                logger.error(f"❌ Could not list running containers: {list_error}")
            return False, None
        except Exception as e:
            logger.error(f"❌ Error retrieving container {container_id}: {e}")
            return False, None
        
        # Wait for the model container to be ready
        logger.info(f"⏳ Waiting for container {container_name} to be ready...")
        if not _wait_for_container_ready(container_name):
            logger.error(f"❌ Container {container_name} failed to become ready")
            return False, None
        
        # Connect container to TT Studio network
        try:
            logger.info(f"🔗 Connecting container {container_name} to network {backend_config.docker_bridge_network_name}")
            container = client.containers.get(container_name)
            network = client.networks.get(backend_config.docker_bridge_network_name)
            network.connect(container)
            logger.info(f"✅ Successfully connected {container_name} to {backend_config.docker_bridge_network_name}")
        except Exception as e:
            logger.error(f"❌ Error connecting container to network: {e}")
            return False, None
        
        logger.info("🎉 ============= TT Inference Server Integration Complete =============")
        return True, container_name
        
    except Exception as e:
        logger.error(f"❌ Error running TT Inference Server: {e}")
        return False, None


def _wait_for_container_ready(container_name: str, timeout: int = 180) -> bool:
    """
    Wait for container to be ready by monitoring docker logs for startup completion.
    Following the official guide: looking for "INFO: Uvicorn running on socket" in logs.
    
    Args:
        container_name: Name of the container to monitor
        timeout: Maximum time to wait in seconds
        
    Returns:
        True if container is ready, False if timeout or error
    """
    try:
        container = client.containers.get(container_name)
        start_time = time.time()
        
        logger.info(f"Running 'docker logs -f {container_name}' to monitor startup (following official guide)...")
        
        while time.time() - start_time < timeout:
            try:
                # Get logs using the same approach as the official guide: docker logs -f <container_name>
                logs = container.logs(tail=50, since=int(start_time)).decode('utf-8')
                
                # Official guide specifically mentions looking for "INFO: Uvicorn running on socket"
                if "INFO: Uvicorn running on socket" in logs:
                    logger.info(f"✅ Found 'INFO: Uvicorn running on socket' - Container {container_name} is ready!")
                    return True
                
                # Also check for other common startup indicators
                if any(indicator in logs for indicator in [
                    "Application startup complete",
                    "Server is ready", 
                    "Model loaded successfully",
                    "Uvicorn running on"  # Broader match for different uvicorn messages
                ]):
                    logger.info(f"✅ Container {container_name} startup indicators found - ready!")
                    return True
                    
                # Check if container is still running
                container.reload()
                if container.status != 'running':
                    logger.error(f"❌ Container {container_name} stopped running (status: {container.status})")
                    return False
                    
            except docker.errors.NotFound:
                logger.error(f"❌ Container {container_name} disappeared while waiting for it to be ready.")
                logger.error("   This is likely because the process inside the container failed to start and the container was removed due to the '--rm' flag.")
                
                # Attempt to find and read the log file saved by `run.py`
                log_dir = "/tt-inference-server/workflow_logs/docker_server/"
                try:
                    logger.info(f"🔍 Searching for container log file in {log_dir}...")
                    log_files = [os.path.join(log_dir, f) for f in os.listdir(log_dir) if os.path.isfile(os.path.join(log_dir, f))]
                    if not log_files:
                        logger.error(f"❌ No log files found in {log_dir}.")
                    else:
                        latest_log_file = max(log_files, key=os.path.getmtime)
                        logger.error(f"📖 Found latest log file: {latest_log_file}. Displaying contents for debugging:")
                        with open(latest_log_file, 'r') as f:
                            for line in f:
                                logger.error(f"  [log] {line.strip()}")
                except Exception as find_log_e:
                    logger.error(f"❌ Could not search for or read log file: {find_log_e}")

                return False
            except Exception as e:
                logger.warning(f"Error checking container logs: {e}")
                
            time.sleep(5)  # Check every 5 seconds
        
        logger.warning(f"⏰ Timeout waiting for container {container_name} to show 'INFO: Uvicorn running on socket'")
        return False
        
    except docker.errors.NotFound:
        logger.error(f"❌ Container {container_name} was not found immediately after creation.")
        return False
    except Exception as e:
        logger.error(f"Error waiting for container {container_name}: {e}")
        return False


def run_container(impl, weights_id):
    """Run a docker container from an image"""
    try:
        logger.info(f"run_container called for {impl.model_name}")

        # Check if this is a TT Inference Server model
        if impl.setup_type == SetupTypes.TT_INFERENCE_SERVER:
            logger.info(f"Detected TT_INFERENCE_SERVER setup for {impl.model_name}")
            
            # Get host port for the model
            host_port = get_host_port(impl)
            if not host_port:
                return {"status": "error", "message": "Could not allocate host port"}
            
            # Get device configuration and map to TT Inference Server device names
            device_config = get_runtime_device_configuration(impl.device_configurations)
            device_name_mapping = {
                DeviceConfigurations.N150: "n150",
                DeviceConfigurations.N150_WH_ARCH_YAML: "n150", 
                DeviceConfigurations.N300: "n300",
                DeviceConfigurations.N300_WH_ARCH_YAML: "n300",
                DeviceConfigurations.N300x4: "t3k",
                DeviceConfigurations.N300x4_WH_ARCH_YAML: "t3k",
                DeviceConfigurations.E150: "n150"  # Fallback
            }
            device_name = device_name_mapping.get(device_config, "n300")  # Default to n300
            
            # Get tokens from environment or docker config
            hf_token = impl.docker_config.get("environment", {}).get("HF_TOKEN", os.environ.get("HF_TOKEN", ""))
            jwt_secret = impl.docker_config.get("environment", {}).get("JWT_SECRET", backend_config.jwt_secret)
            
            if not hf_token:
                logger.warning("No HF_TOKEN found, this may cause issues with private models")
            
            # Run TT Inference Server
            success, container_name = run_tt_inference_server(
                model_name=impl.model_name,
                device=device_name,
                port=host_port,
                hf_token=hf_token,
                jwt_secret=jwt_secret
            )
            
            if success and container_name:
                # Get container object for metadata
                try:
                    container = client.containers.get(container_name)
                    
                    # Update deploy cache
                    update_deploy_cache()
                    
                    return {
                        "status": "success",
                        "container_id": container.id,
                        "container_name": container.name,
                        "service_route": impl.service_route,
                        "port_bindings": {f"{impl.service_port}/tcp": host_port},
                        "setup_type": "TT_INFERENCE_SERVER"
                    }
                except docker.errors.NotFound:
                    return {"status": "error", "message": f"Container {container_name} not found after creation"}
            else:
                return {"status": "error", "message": "Failed to start TT Inference Server container"}
        
        # Handle non-TT_INFERENCE_SERVER models (existing logic)
        run_kwargs = copy.deepcopy(impl.docker_config)
        # handle runtime configuration changes to docker kwargs
        device_mounts = get_devices_mounts(impl)
        if device_mounts:
            run_kwargs.update({"devices": device_mounts})
        run_kwargs.update({"ports": get_port_mounts(impl)})
        # add bridge inter-container network
        run_kwargs.update({"network": backend_config.docker_bridge_network_name})
        # add unique container name suffixing with host port
        host_port = list(run_kwargs["ports"].values())[0]
        run_kwargs.update({"name": f"{impl.container_base_name}_p{host_port}"})
        run_kwargs.update({"hostname": f"{impl.container_base_name}_p{host_port}"})
        # add environment variables
        run_kwargs["environment"]["MODEL_WEIGHTS_ID"] = weights_id
        # container path, not backend path
        run_kwargs["environment"]["MODEL_WEIGHTS_PATH"] = get_model_weights_path(
            impl.model_container_weights_dir, weights_id
        )
        logger.info(f"run_kwargs:= {run_kwargs}")
        container = client.containers.run(impl.image_version, **run_kwargs)
        # 
        verify_container(impl, run_kwargs, container)
        # on changes to containers, update deploy cache
        update_deploy_cache()
        return {
            "status": "success",
            "container_id": container.id,
            "container_name": container.name,
            "service_route": impl.service_route,
            "port_bindings": run_kwargs["ports"],
        }
    except docker.errors.ContainerError as e:
        return {"status": "error", "message": str(e)}

def run_agent_container(container_name, port_bindings, impl):
    # runs agent container after associated llm container runs
    run_kwargs = copy.deepcopy(impl.docker_config)
    host_agent_port = get_host_agent_port()
    llm_host_port = list(port_bindings.values())[0] # port that llm is using for naming convention (for easier removal later)
    run_kwargs = {
    'name': f'ai_agent_container_p{llm_host_port}',  # Container name
    'network': 'tt_studio_network',  # Docker network
    'ports': {'8080/tcp': host_agent_port},  # Mapping container port 8080 to host port (host port dependent on LLM port)
    'environment': {
        'TAVILY_API_KEY': os.getenv('TAVILY_API_KEY'), # found in env file 
        'LLM_CONTAINER_NAME': container_name,
        'JWT_SECRET': run_kwargs["environment"]['JWT_SECRET'],
        'HF_MODEL_PATH': run_kwargs["environment"]["HF_MODEL_PATH"]
    },  # Set the environment variables
    'detach': True,  # Run the container in detached mode
}
    container = client.containers.run(
    'ghcr.io/tenstorrent/tt-studio/agent_image:v1.1',
    f"uvicorn agent:app --reload --host 0.0.0.0 --port {host_agent_port}",
    auto_remove=True,
    **run_kwargs
)
    
def stop_container(container_id):
    """Stop a specific docker container"""
    try:
        container = client.containers.get(container_id)
        container.stop()
        # on changes to containers, update deploy cache
        update_deploy_cache()
        return {"status": "success"}
    except docker.errors.NotFound as e:
        return {"status": "error", "message": "Container not found"}


def get_runtime_device_configuration(device_configurations):
    # TODO: add device management
    # choose supported device configuration for the implementation
    return next(iter(device_configurations))


def get_devices_mounts(impl):
    device_config = get_runtime_device_configuration(impl.device_configurations)
    assert isinstance(device_config, DeviceConfigurations)
    # TODO: add logic to handle multiple devices and multiple containers
    single_device_mounts = ["/dev/tenstorrent/0:/dev/tenstorrent/0"]
    all_device_mounts = ["/dev/tenstorrent:/dev/tenstorrent"]
    device_map = {
        DeviceConfigurations.E150: single_device_mounts,
        DeviceConfigurations.N150: single_device_mounts,
        DeviceConfigurations.N150_WH_ARCH_YAML: single_device_mounts,
        DeviceConfigurations.N300: single_device_mounts,
        DeviceConfigurations.N300x4_WH_ARCH_YAML: all_device_mounts,
        DeviceConfigurations.N300x4: all_device_mounts,
    }
    device_mounts = device_map.get(device_config)
    return device_mounts


def get_port_mounts(impl):
    host_port = get_host_port(impl)
    return {f"{impl.service_port}/tcp": host_port}


def get_host_port(impl):
    # use a fixed block of ports starting at 8001 for models
    managed_containers = get_managed_containers()
    port_mappings = get_port_mappings(managed_containers)
    used_host_ports = get_used_host_ports(port_mappings)
    logger.info(f"used_host_ports={used_host_ports}")
    BASE_MODEL_PORT = 8001
    for port in range(BASE_MODEL_PORT, BASE_MODEL_PORT + 100):
        if str(port) not in used_host_ports:
            return port
    logger.warning("Could not find an unused port in block: 8001-8100")
    return None

def get_host_agent_port():
    # used fixed block of ports starting at 8101 for agents 
    agent_containers = get_agent_containers()
    port_mappings = get_port_mappings(agent_containers)
    used_host_agent_ports = get_used_host_ports(port_mappings)
    logger.info(f"used_host_agent_ports={used_host_agent_ports}")
    BASE_AGENT_PORT = 8201
    for port in range(BASE_AGENT_PORT, BASE_AGENT_PORT+100):
        if str(port) not in used_host_agent_ports:
            return port
    logger.warning("Could not find an unused port in block: 8201-8300")

def get_agent_containers():
    """
    get all containers used by an ai agent 
    """
    running_containers = client.containers.list()
    agent_containers = []
    for container in running_containers:
        if "ai_agent_container" in container.name: 
            agent_containers.append(container)
    return agent_containers

def get_managed_containers():
    """get containers configured in model_config.py for LLM-studio management"""
    running_containers = client.containers.list()
    managed_images = set([impl.image_version for impl in model_implmentations.values()])
    managed_containers = []
    for container in running_containers:
        if managed_images.intersection(set(container.image.tags)):
            managed_containers.append(container)
    return managed_containers


def get_port_mappings(managed_containers):
    port_mappings = []
    for container in managed_containers:
        ports = container.attrs["NetworkSettings"]["Ports"]
        for port, mappings in ports.items():
            if mappings is not None:
                for mapping in mappings:
                    port_mappings.append(mapping)
    return port_mappings


def get_used_host_ports(port_mappings):
    used_host_ports = []
    for mapping in port_mappings:
        used_host_ports.append(mapping["HostPort"])
    return used_host_ports


def verify_container(impl, run_kwargs, container):
    verify_port_mappings(run_kwargs, container)


def verify_port_mappings(run_kwargs, container):
    impl_port_bindings = run_kwargs["ports"]
    container_ports = container.attrs["HostConfig"]["PortBindings"]
    for service_port, host_port in impl_port_bindings.items():
        assert container_ports[service_port][0]["HostPort"] == str(host_port)


def parse_env_var_str(env_var_list):
    return {
        var.split("=", 1)[0]: var.split("=", 1)[1] if "=" in var else None
        for var in env_var_list
    }


def get_container_status():
    containers = get_managed_containers()
    data = {}
    for con in containers:
        data[con.id] = {
            "name": con.name,
            "status": con.status,
            "health": con.health,
            "create": con.attrs.get("Created"),
            "image_id": con.attrs.get("Image"),
            "image_name": con.attrs.get("Config").get("Image"),
            "port_bindings": con.attrs.get("NetworkSettings").get("Ports"),
            "networks": {
                k: {"DNSNames": v.get("DNSNames")}
                for k, v in con.attrs.get("NetworkSettings").get("Networks").items()
            },
            "env_vars": parse_env_var_str(con.attrs.get("Config").get("Env")),
        }
    return data


def update_deploy_cache():
    # Get current running containers
    data = get_container_status()
    cache = caches[backend_config.django_deploy_cache_name]
    
    # Get all cached container IDs (need to strip version tag)
    cached_container_ids = set()
    for key in cache._cache.keys():
        # Strip the version tag to get the actual container ID
        clean_key = key.replace(":version:", "")
        cached_container_ids.add(clean_key)
    
    # Get current running container IDs
    current_container_ids = set(data.keys())
    
    # Remove containers from cache that are no longer running
    containers_to_remove = cached_container_ids - current_container_ids
    for container_id in containers_to_remove:
        logger.info(f"Removing stopped container from deploy cache: {container_id}")
        cache.delete(container_id)
    
    # Add/update current running containers in cache
    for con_id, con in data.items():
        con_model_id = con['env_vars'].get("MODEL_ID")
        model_impl = model_implmentations.get(con_model_id)
        if not model_impl:
            # fallback to finding first impl that uses that container 
            model_impl = [
                v
                for k, v in model_implmentations.items()
                if v.image_version == con["image_name"]
            ]
            assert (
                len(model_impl) == 1
            ), f"Cannot find model_impl={model_impl} for {con['image_name']}"
            model_impl = model_impl[0]
        con["model_id"] = model_impl.model_id
        con["weights_id"] = con["env_vars"].get("MODEL_WEIGHTS_ID")
        con["model_impl"] = model_impl
        logger.info(f"con['networks']={con["networks"]}")
        # handle containers not running within the tt-studio network
        if backend_config.docker_bridge_network_name in con["networks"].keys():
            hostname = con["networks"][backend_config.docker_bridge_network_name][
                "DNSNames"
            ][0]
            con["internal_url"] = (
                f"{hostname}:{model_impl.service_port}{model_impl.service_route}"
            )
            con["health_url"] = (
                f"{hostname}:{model_impl.service_port}{model_impl.health_route}"
            )
            cache.set(con_id, con, timeout=None)
            # TODO: validation


def get_model_weights_path(weights_dir_path, weights_id):
    """used for both backend (for validation) and model container"""
    if not weights_id:
        # uses default weights and location
        return ""

    def remove_id_prefix(s):
        ID_PREFIX = "id_"
        if s.startswith(ID_PREFIX):
            return s[len(ID_PREFIX) :]
        return s

    # weights_id is the dir name of the weights

    dir_name = remove_id_prefix(weights_id)
    return weights_dir_path.joinpath(dir_name)


def perform_reset():
    try:
        logger.info("Running initial tt-smi command to check device detection.")

        # Initial check to see if Tenstorrent devices are detected
        def check_device_detection():
            process = subprocess.Popen(
                ["tt-smi"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,  # Prevents interactive command-line interface
                text=True,
            )
            output = []
            for line in iter(process.stdout.readline, ""):
                logger.info(f"tt-smi output: {line.strip()}")
                output.append(line)
                if "No Tenstorrent devices detected" in line:
                    return {
                        "status": "error",
                        "message": "No Tenstorrent devices detected! Please check your hardware and try again.",
                        "output": "".join(output),
                        "http_status": 501,  # Not Implemented
                    }
            process.stdout.close()
            return_code = process.wait()
            if return_code != 0:
                return {
                    "status": "error",
                    "message": f"tt-smi command failed with return code {return_code}. Please check if tt-smi is properly installed.",
                    "output": "".join(output),
                    "http_status": 500,  # Internal Server Error
                }
            return {"status": "success", "output": "".join(output)}

        # Run the device detection check
        detection_result = check_device_detection()
        if detection_result.get("status") == "error":
            return detection_result

        logger.info("Running tt-smi reset command.")

        def stream_command_output(command):
            logger.info(f"Executing command: {' '.join(command)}")
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,  # Prevents interactive command-line interface
                text=True,
            )
            output = []
            for line in iter(process.stdout.readline, ""):
                logger.info(f"Command output: {line.strip()}")
                output.append(line)
            process.stdout.close()
            return_code = process.wait()
            if return_code != 0:
                logger.info(f"Command failed with return code {return_code}")
                output.append(f"Command failed with return code {return_code}")
                error_message = "tt-smi reset failed. Please check if:\n"
                error_message += "1. The Tenstorrent device is properly connected\n"
                error_message += "2. You have the correct permissions to access the device\n"
                error_message += "3. The tt-smi utility is properly installed\n"
                error_message += "4. The device firmware is up to date"
                return {
                    "status": "error",
                    "message": error_message,
                    "output": "".join(output),
                    "http_status": 500,  # Internal Server Error
                }
            else:
                logger.info(
                    f"Command completed successfully with return code {return_code}"
                )
                return {"status": "success", "output": "".join(output)}

        # Step 1: Check if the reset config JSON already exists
        if not os.path.exists(CONFIG_PATH):
            generate_result = stream_command_output(["tt-smi", "--generate_reset_json"])
            if generate_result.get("status") == "error":
                return generate_result

        # Step 2: Run the reset using the generated JSON
        reset_result = stream_command_output(["tt-smi", "-r", CONFIG_PATH])
        if reset_result.get("status") == "error":
            return reset_result
        return reset_result or {
            "status": "error",
            "message": "tt-smi reset failed with no output. Please check device connection and try again.",
            "output": "No output from reset command",
            "http_status": 500
        }

    except Exception as e:
        logger.exception("Exception occurred during reset operation.")
        return {
            "status": "error",
            "message": str(e),
            "output": "An exception occurred during the reset operation.",
            "http_status": 500,
        }

def check_image_exists(image_name, image_tag):
    """Check if a Docker image exists locally with robust matching"""
    try:
        target_image = f"{image_name}:{image_tag}"
        logger.info(f"Checking for image: {target_image}")
        
        # First try exact match (current behavior)
        try:
            image_info = client.images.get(target_image)
            size_bytes = image_info.attrs['Size']
            size_mb = round(size_bytes / (1024 * 1024), 2)
            logger.info(f"Found exact match for image: {target_image}")
            return {
                "exists": True,
                "size": f"{size_mb}MB",
                "status": "available"
            }
        except docker.errors.ImageNotFound:
            logger.info(f"Exact match not found for: {target_image}")
            pass
        
        # If exact match fails, search through all images
        logger.info("Searching through all available images for partial matches...")
        all_images = client.images.list()
        available_images = []
        
        for image in all_images:
            for tag in image.tags:
                available_images.append(tag)
                # Check for partial matches
                if image_name in tag and image_tag in tag:
                    size_bytes = image.attrs['Size']
                    size_mb = round(size_bytes / (1024 * 1024), 2)
                    logger.info(f"Found partial match: {tag} (looking for {target_image})")
                    return {
                        "exists": True,
                        "size": f"{size_mb}MB",
                        "status": "available",
                        "actual_tag": tag
                    }
        
        # Log available images for debugging
        logger.warning(f"Image not found: {target_image}")
        logger.info(f"Available images: {available_images[:10]}...")  # Show first 10 to avoid spam
        
        return {
            "exists": False,
            "size": "0MB",
            "status": "not_pulled"
        }
        
    except Exception as e:
        logger.error(f"Error checking image status: {str(e)}")
        return {
            "exists": False,
            "size": "0MB",
            "status": "error"
        }

def pull_image_with_progress(image_name, image_tag, progress_callback=None):
    """Pull a Docker image with progress tracking"""
    try:
        image = f"{image_name}:{image_tag}"
        logger.info(f"Pulling image: {image}")
        
        # Authenticate with ghcr.io if credentials are available
        if image_name.startswith("ghcr.io") and backend_config.github_username and backend_config.github_pat:
            logger.info("Authenticating with GitHub Container Registry")
            try:
                client.login(
                    username=backend_config.github_username,
                    password=backend_config.github_pat,
                    registry="ghcr.io"
                )
                logger.info("Successfully authenticated with ghcr.io")
            except Exception as auth_error:
                logger.error(f"Failed to authenticate with ghcr.io: {str(auth_error)}")
                return {"status": "error", "message": f"Authentication failed: {str(auth_error)}"}
        
        # Pull the image with progress tracking
        for line in client.api.pull(image, stream=True, decode=True):
            if progress_callback and isinstance(line, dict):
                if 'status' in line:
                    progress = {
                        'status': line['status'],
                        'progress': line.get('progress', ''),
                        'id': line.get('id', '')
                    }
                    progress_callback(progress)
        
        # Verify the image was pulled successfully
        client.images.get(image)
        return {"status": "success", "message": f"Successfully pulled {image}"}
    except Exception as e:
        logger.error(f"Error pulling image: {str(e)}")
        return {"status": "error", "message": str(e)}

def detect_board_type():
    """Detect board type using tt-smi command"""
    try:
        logger.info("Running tt-smi -s to detect board type")
        
        process = subprocess.Popen(
            ["tt-smi", "-s"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            text=True,
            preexec_fn=os.setsid  # Create new process group for cleanup
        )
        
        try:
            # Wait for process with timeout (10 seconds)
            stdout, stderr = process.communicate(timeout=10)
            
            if process.returncode != 0:
                logger.error(f"tt-smi -s failed with return code {process.returncode}, stderr: {stderr}")
                return "unknown"
            
            # Parse JSON output
            logger.info(f"tt-smi -s raw output length: {len(stdout)}")
            logger.info(f"tt-smi -s first 500 chars: {stdout[:500]}")
            
            try:
                data = json.loads(stdout)
                logger.info(f"Parsed JSON successfully. Keys: {list(data.keys())}")
                
                if "device_info" in data:
                    logger.info(f"Found {len(data['device_info'])} devices")
                    if len(data["device_info"]) > 0:
                        # Get board type from first device
                        first_device = data["device_info"][0]
                        logger.info(f"First device keys: {list(first_device.keys())}")
                        
                        if "board_info" in first_device:
                            board_info = first_device["board_info"]
                            logger.info(f"Board info keys: {list(board_info.keys())}")
                            board_type = board_info.get("board_type", "unknown")
                            logger.info(f"Raw board_type: '{board_type}'")
                            
                            # Normalize board type (e.g., "n300 L" -> "N300")
                            if "n150" in board_type.lower():
                                logger.info("Detected N150 board")
                                return "N150"
                            elif "n300" in board_type.lower():
                                logger.info("Detected N300 board")
                                return "N300"
                            elif "t3000" in board_type.lower():
                                logger.info("Detected T3000 board")
                                return "T3000"
                            else:
                                logger.warning(f"Unknown board type: {board_type}")
                                return "unknown"
                        else:
                            logger.warning("No board_info found in first device")
                            return "unknown"
                    else:
                        logger.warning("Device_info array is empty")
                        return "unknown"
                else:
                    logger.warning("No 'device_info' key found in JSON")
                    logger.info(f"Available keys: {list(data.keys())}")
                    return "unknown"
                    
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse tt-smi JSON output: {e}")
                logger.error(f"Raw output: {stdout}")
                return "unknown"
                
        except subprocess.TimeoutExpired:
            logger.error("tt-smi -s command timed out after 10 seconds")
            # Kill the process group to ensure cleanup
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                process.wait(timeout=2)
            except:
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                except:
                    pass
            return "unknown"
            
    except FileNotFoundError:
        logger.error("tt-smi command not found")
        return "unknown"
    except Exception as e:
        logger.error(f"Error detecting board type: {str(e)}")
        return "unknown"

def test_llama_1b_instruct():
    """
    Test function for Llama-3.2-1B-Instruct following the official guide workflow.
    This function simulates what happens when you select the model in the frontend.
    """
    try:
        logger.info("🧪 ============= Testing Llama-3.2-1B-Instruct =============")
        
        # Find the model implementation
        model_id = None
        model_impl = None
        for impl_id, impl in model_implmentations.items():
            if impl.hf_model_id == "meta-llama/Llama-3.2-1B-Instruct":
                model_id = impl_id
                model_impl = impl
                break
        
        if not model_impl:
            logger.error("❌ Llama-3.2-1B-Instruct model implementation not found")
            return False
        
        logger.info(f"✅ Found model implementation: {model_id}")
        logger.info(f"📋 Model details:")
        logger.info(f"   • HF Model ID: {model_impl.hf_model_id}")
        logger.info(f"   • Setup Type: {model_impl.setup_type}")
        logger.info(f"   • Model Type: {model_impl.model_type}")
        logger.info(f"   • Service Route: {model_impl.service_route}")
        logger.info(f"   • Device Configurations: {[dev.name for dev in model_impl.device_configurations]}")
        
        # Simulate the run_container call
        logger.info("🚀 Simulating frontend model selection -> run_container call...")
        result = run_container(model_impl, weights_id=None)
        
        logger.info("📊 Result:")
        logger.info(f"   • Status: {result.get('status')}")
        logger.info(f"   • Container ID: {result.get('container_id', 'N/A')}")
        logger.info(f"   • Container Name: {result.get('container_name', 'N/A')}")
        logger.info(f"   • Service Route: {result.get('service_route', 'N/A')}")
        logger.info(f"   • Port Bindings: {result.get('port_bindings', 'N/A')}")
        
        if result.get('status') == 'success':
            logger.info("🎉 SUCCESS: Llama-3.2-1B-Instruct is ready for chat!")
            container_name = result.get('container_name')
            port = list(result.get('port_bindings', {}).values())[0] if result.get('port_bindings') else 'N/A'
            logger.info(f"🔗 Chat API endpoint: http://localhost:{port}/v1/chat/completions")
            return True
        else:
            logger.error(f"❌ FAILED: {result.get('message', 'Unknown error')}")
            return False
            
    except Exception as e:
        logger.error(f"❌ Error in test: {e}")
        return False