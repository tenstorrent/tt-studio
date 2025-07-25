# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# docker_control/docker_utils.py
import socket, os, subprocess, json, signal, time
import copy
from pathlib import Path

import docker
import requests
from django.core.cache import caches

from shared_config.device_config import DeviceConfigurations
from shared_config.logger_config import get_logger
from shared_config.model_config import model_implmentations
from shared_config.backend_config import backend_config
from shared_config.model_type_config import ModelTypes
from board_control.services import SystemResourceService


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


def map_board_type_to_device_name(board_type):
    """Map our internal board type names to TT Inference Server device names"""
    board_to_device_map = {
        "N150": "n150",
        "N300": "n300",
        "T3000": "t3k",  # T3000 maps to t3k for TT Inference Server
        "T3K": "t3k",
        "unknown": "cpu"  # Fallback to cpu for unknown boards
    }

    device_name = board_to_device_map.get(board_type, "cpu")
    logger.info(f"Mapped board type '{board_type}' to device name '{device_name}'")
    return device_name

def run_container(impl, weights_id):
    """Run a docker container via TT Inference Server API"""
    if (impl.model_type == ModelTypes.CHAT):
        # For chat models, we use the TT Inference Server API to run the container
        try:
            logger.info(f"Calling TT Inference Server API")
            logger.info(f"run_container called for {impl.model_name}")

            board_type = detect_board_type()
            device = map_board_type_to_device_name(board_type)
            
            # Create payload for the API call
            payload = {
                "model": impl.model_name,
                "workflow": "server",  # Default workflow for container runs
                "device": device,  # Use mapped device name
                "docker_server": True,
                "dev_mode": True
            }

            logger.info(f"API payload: {payload}")

            # Make POST request to TT Inference Server API
            api_url = "http://172.18.0.1:8001/run"

            response = requests.post(
                api_url,
                json=payload,
                timeout=300  # 5 minute timeout for container startup
            )

            if response.status_code == 200:
                api_result = response.json()
                logger.info(f"API call successful: {api_result}")

                # Update deploy cache on success
                update_deploy_cache()

                return {
                    "status": "success",
                    "container_name": api_result["container_name"],
                    "api_response": api_result
                }
            else:
                error_msg = f"API call failed with status {response.status_code}: {response.text}"
                logger.error(error_msg)
                return {"status": "error", "message": error_msg}

        except requests.exceptions.RequestException as e:
            error_msg = f"Network error calling TT Inference Server API: {str(e)}"
            logger.error(error_msg)
            return {"status": "error", "message": error_msg}
        except Exception as e:
            error_msg = f"Unexpected error in run_container: {str(e)}"
            logger.error(error_msg)
            return {"status": "error", "message": error_msg}
    else:
        # For non-chat models, we use the docker client to run the container
        try:
            logger.info(f"run_container called for {impl.model_name}")


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
            logger.info(f"!!!host_port:= {host_port}")
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
    'agent_image:v1',
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
    BASE_MODEL_PORT = 8002
    for port in range(BASE_MODEL_PORT, BASE_MODEL_PORT + 100):
        if str(port) not in used_host_ports:
            return port
    logger.warning("Could not find an unused port in block: 8001-8100")
    return None



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
    logger.info(f"!!! current_container_ids:= {current_container_ids}")

    # Remove containers from cache that are no longer running
    containers_to_remove = cached_container_ids - current_container_ids
    for container_id in containers_to_remove:
        logger.info(f"Removing stopped container from deploy cache: {container_id}")
        cache.delete(container_id)

    # Add/update current running containers in cache
    logger.info(f"!!! data.items():= {data.items()}")
    for con_id, con in data.items():
        con_model_id = con['env_vars'].get("MODEL_ID")
        logger.info(f"!!! con_model_id:= {con_model_id}")
        model_impl = model_implmentations.get(con_model_id)
        if not model_impl:
            # find first impl that uses that container name
            model_impl = [
                v
                for k, v in model_implmentations.items()
                if v.model_name == con["name"]
            ]
            if len(model_impl) == 0:
                # fallback to finding first impl that uses that container image
                model_impl = [
                    v
                    for k, v in model_implmentations.items()
                    if v.image_version == con["image_name"]
                ]
            logger.info(f"Container image name: {con['name']}")
            logger.info("Available model implementations:")
            for k, v in model_implmentations.items():
                logger.info(f"Model ID: {k}, Image Version: {v.model_name}")
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

        # Attempt software resets first (up to MAX_RESET_ATTEMPTS)
        MAX_RESET_ATTEMPTS = 3
        reset_attempts = 0
        reset_success = False
        cumulative_output = []

        # Step 1: Try software resets first
        while reset_attempts < MAX_RESET_ATTEMPTS and not reset_success:
            reset_attempts += 1
            logger.info(f"Software reset attempt {reset_attempts} of {MAX_RESET_ATTEMPTS}")
            cumulative_output.append(f"Attempting software reset {reset_attempts} of {MAX_RESET_ATTEMPTS}...\n")

            # Check if the reset config JSON already exists
            if not os.path.exists(CONFIG_PATH):
                generate_result = stream_command_output(["tt-smi", "--generate_reset_json"])
                if generate_result.get("status") == "error":
                    cumulative_output.append(f"Error generating reset config: {generate_result.get('message')}\n")
                    cumulative_output.append(generate_result.get('output', '') + "\n")
                else:
                    cumulative_output.append("Generated reset configuration successfully.\n")

            # Perform software reset
            soft_reset_result = stream_command_output(["tt-smi", "--softreset"])
            cumulative_output.append(soft_reset_result.get('output', '') + "\n")

            if soft_reset_result.get("status") == "success":
                logger.info(f"Software reset attempt {reset_attempts} succeeded")
                reset_success = True
                break

            logger.warning(f"Software reset attempt {reset_attempts} failed")
            # Small delay between attempts
            time.sleep(2)

        # If software resets didn't work, try tt-smi reset
        if not reset_success:
            logger.warning(f"All {MAX_RESET_ATTEMPTS} software reset attempts failed. Trying tt-smi reset...")
            cumulative_output.append(f"Software reset attempts exhausted. Trying tt-smi reset...\n")

            # Step 2: Run the tt-smi reset using the generated JSON
            reset_result = stream_command_output(["tt-smi", "-r", CONFIG_PATH])
            cumulative_output.append(reset_result.get('output', '') + "\n")

            if reset_result.get("status") == "error":
                all_output = "".join(cumulative_output)
                logger.error("tt-smi reset also failed")
                return {
                    "status": "error",
                    "message": f"All reset attempts failed. Last error: {reset_result.get('message')}",
                    "output": all_output,
                    "http_status": 500
                }
            else:
                reset_success = True

        all_output = "".join(cumulative_output)
        if reset_success:
            return {
                "status": "success",
                "message": f"Reset successful after {reset_attempts} attempt(s)",
                "output": all_output,
                "http_status": 200
            }
        else:
            return {
                "status": "error",
                "message": "All reset attempts failed with no specific error",
                "output": all_output,
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
    """Detect board type using cached data from SystemResourceService"""
    try:
        return SystemResourceService.get_board_type()
    except Exception as e:
        logger.error(f"Error detecting board type: {str(e)}")
        return "unknown"