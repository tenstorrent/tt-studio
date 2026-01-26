# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# docker_control/docker_utils.py
import socket, os, subprocess, json, signal, time
import copy
from pathlib import Path

import requests
from django.core.cache import caches

from shared_config.device_config import DeviceConfigurations
from shared_config.logger_config import get_logger
from shared_config.model_config import model_implmentations
from shared_config.backend_config import backend_config
from shared_config.model_type_config import ModelTypes
from board_control.services import SystemResourceService
from docker_control.models import ModelDeployment
from docker_control.docker_control_client import get_docker_client


CONFIG_PATH = Path(backend_config.backend_cache_root).joinpath("tenstorrent", "reset_config.json")
logger = get_logger(__name__)
logger.info(f"importing {__name__}")

# Deployment timeout: 5 hours to allow for large model downloads
DEPLOYMENT_TIMEOUT_SECONDS = 5 * 60 * 60  # 5 hours

# Ensure the bridge network exists on startup
def _ensure_network():
    """Ensure the tt_studio_network exists via docker-control-service"""
    try:
        docker_client = get_docker_client()
        networks = docker_client.list_networks()

        network_names = [net.get("Name") for net in networks]
        if backend_config.docker_bridge_network_name not in network_names:
            docker_client.create_network(
                name=backend_config.docker_bridge_network_name,
                driver="bridge"
            )
            logger.info(f"Created Docker network via docker-control-service: {backend_config.docker_bridge_network_name}")
        else:
            logger.info(f"Docker network already exists: {backend_config.docker_bridge_network_name}")
    except Exception as e:
        logger.warning(f"Could not create Docker network: {e}")


# Initialize network on module load
_ensure_network()


def map_board_type_to_device_name(board_type):
    """Map our internal board type names to TT Inference Server device names"""
    board_to_device_map = {
        # Wormhole devices
        "N150": "n150",
        "N300": "n300",
        "E150": "e150",
        
        # Wormhole multi-device
        "N150X4": "n150x4",
        "T3000": "t3k",  # T3000 maps to t3k for TT Inference Server
        "T3K": "t3k",
        
        # Blackhole devices
        "P100": "p100",
        "P150": "p150",
        "P300c": "p300c",
        
        # Blackhole multi-device
        "P150X4": "p150x4",
        "P150X8": "p150x8",
        "P300Cx2": "p300cx2",  # 2 cards (4 chips)
        "P300Cx4": "p300cx4",  # 4 cards (8 chips)
        
        # Galaxy systems
        "GALAXY": "galaxy",
        "GALAXY_T3K": "galaxy_t3k",
        
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
                timeout=DEPLOYMENT_TIMEOUT_SECONDS  # 5 hour timeout for container startup and weight downloads
            )

            if response.status_code in [200, 202]:
                api_result = response.json()
                logger.info(f"API call successful (status {response.status_code}): {api_result}")
                logger.info(f"api_result contains docker_log_file_path: {'docker_log_file_path' in api_result}")
                if 'docker_log_file_path' in api_result:
                    logger.info(f"api_result['docker_log_file_path'] = {api_result.get('docker_log_file_path')}")
                else:
                    logger.warning(f"docker_log_file_path NOT found in api_result. Available keys: {list(api_result.keys())}")

                # Update deploy cache on success
                update_deploy_cache()
                
                # Notify agent about new container deployment
                notify_agent_of_new_container(api_result["container_name"])
                
                # Save deployment record to database
                container_id = None
                container_name = "unknown"
                try:
                    container_id = api_result.get("container_id")
                    container_name = api_result.get("container_name", "unknown")
                    
                    # If container_id is not in response, try to get it from Docker by name
                    if not container_id and container_name:
                        try:
                            docker_client = get_docker_client()
                            container_info = docker_client.get_container(container_name)
                            container_id = container_info.get("id")
                            logger.info(f"Retrieved container_id {container_id} from Docker for {container_name}")
                        except Exception as docker_error:
                            logger.warning(f"Could not get container_id from Docker: {docker_error}")
                            # Use container_name as fallback ID if we can't get the actual ID
                            container_id = container_name
                    
                    if container_id:
                        # Extract workflow log path from API response
                        workflow_log_path = api_result.get("docker_log_file_path")
                        logger.info(f"Extracted workflow_log_path from api_result: {workflow_log_path}")
                        logger.info(f"workflow_log_path type: {type(workflow_log_path)}, is None: {workflow_log_path is None}")
                        
                        ModelDeployment.objects.create(
                            container_id=container_id,
                            container_name=container_name,
                            model_name=impl.model_name,
                            device=device,
                            status="running",
                            stopped_by_user=False,
                            port=7000,  # TT Inference Server default port
                            workflow_log_path=workflow_log_path
                        )
                        logger.info(f"Saved deployment record for {container_name} (ID: {container_id})")
                        if workflow_log_path:
                            logger.info(f"Workflow log path saved: {workflow_log_path}")
                        else:
                            logger.warning(f"Workflow log path is None/empty for {container_name}")
                    else:
                        logger.warning(f"Could not save deployment record: no container_id or container_name")
                except Exception as e:
                    import traceback
                    logger.error(
                        f"Failed to save deployment record for {container_name} (ID: {container_id}): {type(e).__name__}: {e}\n"
                        f"Traceback: {traceback.format_exc()}"
                    )
                    # Don't fail the deployment if we can't save the record

                return {
                    "status": "success",
                    "container_name": api_result["container_name"],
                    "container_id": api_result.get("container_id"),  # Pass through container_id
                    "job_id": api_result.get("job_id") or api_result.get("container_id"),  # Use job_id or container_id as fallback
                    "api_response": api_result
                }
            else:
                error_msg = f"API call failed with status {response.status_code}: {response.text}"
                logger.error(error_msg)
                
                # Try to extract job_id and error details from response
                job_id = None
                error_detail = error_msg
                try:
                    error_data = response.json()
                    if isinstance(error_data, dict):
                        # Extract job_id if present
                        job_id = error_data.get('job_id')
                        # Extract error message if present
                        error_detail = error_data.get('message', error_msg)
                        logger.info(f"Extracted job_id from error response: {job_id}")
                except Exception as parse_error:
                    logger.warning(f"Could not parse error response: {parse_error}")
                
                return {
                    "status": "error",
                    "message": error_detail,
                    "job_id": job_id
                }

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

            # Convert run_kwargs to docker-control-service API format
            docker_client = get_docker_client()
            api_kwargs = {
                "image": impl.image_version,
                "name": run_kwargs.get("name"),
                "command": run_kwargs.get("command"),
                "environment": run_kwargs.get("environment", {}),
                "ports": run_kwargs.get("ports", {}),
                "volumes": run_kwargs.get("volumes"),
                "network": run_kwargs.get("network"),
                "detach": run_kwargs.get("detach", True),
            }

            # Add devices if present
            if "devices" in run_kwargs:
                api_kwargs["devices"] = run_kwargs["devices"]

            # Add hostname if present
            if "hostname" in run_kwargs:
                api_kwargs["hostname"] = run_kwargs["hostname"]

            container_result = docker_client.run_container(**api_kwargs)
            logger.info(f"Container started via docker-control-service: {container_result}")

            # Extract container info from API response
            container_id = container_result.get("id")
            container_name = container_result.get("name")
            # on changes to containers, update deploy cache
            update_deploy_cache()

            # Notify agent about new container deployment
            notify_agent_of_new_container(container_name)

            # Save deployment record to database
            try:
                # Get device from impl configuration
                device_config = impl.device_configurations[0] if impl.device_configurations else None
                device_name = device_config.name if device_config else "unknown"

                ModelDeployment.objects.create(
                    container_id=container_id,
                    container_name=container_name,
                    model_name=impl.model_name,
                    device=device_name,
                    status="running",
                    stopped_by_user=False,
                    port=host_port
                )
                logger.info(f"Saved deployment record for {container_name} (ID: {container_id})")
            except Exception as e:
                import traceback
                logger.error(
                    f"Failed to save deployment record for {container_name} (ID: {container_id}): {type(e).__name__}: {e}\n"
                    f"Traceback: {traceback.format_exc()}"
                )
                # Don't fail the deployment if we can't save the record

            return {
                "status": "success",
                "container_id": container_id,
                "container_name": container_name,
                "service_route": impl.service_route,
                "port_bindings": run_kwargs["ports"],
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}

def run_agent_container(container_name, port_bindings, impl):
    # runs agent container after associated llm container runs
    run_kwargs = copy.deepcopy(impl.docker_config)
    host_agent_port = get_host_agent_port()
    llm_host_port = list(port_bindings.values())[0] # port that llm is using for naming convention (for easier removal later)

    docker_client = get_docker_client()
    docker_client.run_container(
        image='agent_image:v1',
        command=f"uvicorn agent:app --reload --host 0.0.0.0 --port {host_agent_port}",
        name=f'ai_agent_container_p{llm_host_port}',
        network='tt_studio_network',
        ports={'8080/tcp': host_agent_port},
        environment={
            'TAVILY_API_KEY': os.getenv('TAVILY_API_KEY'),
            'LLM_CONTAINER_NAME': container_name,
            'JWT_SECRET': run_kwargs["environment"]['JWT_SECRET'],
            'HF_MODEL_PATH': run_kwargs["environment"]["HF_MODEL_PATH"]
        },
        detach=True
    )

def stop_container(container_id):
    """Stop a specific docker container"""
    try:
        docker_client = get_docker_client()
        result = docker_client.stop_container(container_id)
        # on changes to containers, update deploy cache
        update_deploy_cache()
        return result
    except Exception as e:
        return {"status": "error", "message": str(e)}


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
    docker_client = get_docker_client()
    response = docker_client.list_containers(all=False)

    # Extract containers array from response
    containers_list = response.get("containers", []) if isinstance(response, dict) else []

    managed_images = set([impl.image_version for impl in model_implmentations.values()])
    managed_containers = []

    for container_data in containers_list:
        # Convert API response to container-like object for backwards compatibility
        class ContainerWrapper:
            def __init__(self, data):
                self.id = data.get("id")
                self.name = data.get("name")
                self.status = data.get("status")
                self.attrs = data
                # Create image object
                self.image = type('obj', (object,), {
                    'tags': data.get("image_tags", [])
                })()

            @property
            def health(self):
                """Extract health status from nested attrs structure"""
                # Try to get from State.Health (Docker SDK structure)
                # Health can be in attrs["State"]["Health"] or attrs["attrs"]["State"]["Health"]

                # First try: attrs["State"]["Health"] (if attrs is the Docker container.attrs directly)
                state = self.attrs.get("State", {})
                if state and "Health" in state:
                    return state["Health"]

                # Second try: attrs["attrs"]["State"]["Health"] (if data has nested attrs)
                nested_attrs = self.attrs.get("attrs", {})
                if nested_attrs:
                    nested_state = nested_attrs.get("State", {})
                    if nested_state and "Health" in nested_state:
                        return nested_state["Health"]

                # Return empty dict if no health info found
                return {}

        container = ContainerWrapper(container_data)
        # Method 1: Check if container uses a managed image (legacy models)
        if managed_images.intersection(set(container.image.tags)):
            managed_containers.append(container)
        else:
            # Method 2: Check for TT Inference Server containers by environment variables
            # TT Inference Server containers have specific env vars like CACHE_ROOT, TT_CACHE_PATH
            env_list = container.attrs.get("Config", {}).get("Env", [])
            if not env_list:
                env_list = container.attrs.get("environment", [])
            env_vars = parse_env_var_str(env_list) if env_list else {}
            if "CACHE_ROOT" in env_vars or "TT_CACHE_PATH" in env_vars:
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
    # logger.info(f"!!! current_container_ids:= {current_container_ids}")  # Temporarily hidden

    # Remove containers from cache that are no longer running
    containers_to_remove = cached_container_ids - current_container_ids
    for container_id in containers_to_remove:
        logger.info(f"Removing stopped container from deploy cache: {container_id}")
        cache.delete(container_id)

    # Add/update current running containers in cache
    # logger.info(f"!!! data.items():= {data.items()}")  # Temporarily hidden
    for con_id, con in data.items():
        con_model_id = con['env_vars'].get("MODEL_ID")
        # logger.info(f"!!! con_model_id:= {con_model_id}")  # Temporarily hidden
        model_impl = model_implmentations.get(con_model_id)
        if not model_impl:
            # Check if this is a TT Inference Server container by checking for specific env vars
            is_tt_inference_container = (
                "CACHE_ROOT" in con['env_vars'] or 
                "TT_CACHE_PATH" in con['env_vars']
            )
            
            if is_tt_inference_container:
                logger.info(f"Detected TT Inference Server container: {con['name']} (ID: {con_id})")
                
                # Try to find the model implementation from the database
                deployment_found = False
                try:
                    from docker_control.models import ModelDeployment
                    deployment = ModelDeployment.objects.filter(container_id=con_id).first()
                    
                    if deployment:
                        # Find the model implementation by model name
                        model_impl = None
                        for k, v in model_implmentations.items():
                            if v.model_name == deployment.model_name:
                                model_impl = v
                                logger.info(f"Matched TT Inference Server container to model_impl: {model_impl.model_name}")
                                deployment_found = True
                                break
                        
                        if not model_impl:
                            logger.warning(f"Could not find model_impl for {deployment.model_name} in container {con['name']}")
                    else:
                        logger.warning(f"No deployment record found for TT Inference Server container {con_id}")
                except Exception as e:
                    # Check if this is a migration/database issue
                    error_str = str(e).lower()
                    if "no such table" in error_str or "operationalerror" in error_str:
                        logger.warning(f"Database table not found for container {con_id} (migrations may not be applied). Using fallback logic.")
                    else:
                        logger.error(f"Error looking up deployment record for container {con_id}: {e}")
                
                # If database lookup failed or no deployment found, use fallback logic
                if not deployment_found:
                    logger.info(f"Using fallback logic to match container {con['name']}")
                    # Try to match by container name
                    model_impl = None
                    for k, v in model_implmentations.items():
                        if v.model_name in con["name"]:
                            model_impl = v
                            logger.info(f"Matched container by name to model_impl: {model_impl.model_name}")
                            break
                    
                    if not model_impl:
                        logger.warning(f"Could not match TT Inference Server container {con['name']} to any model_impl. Skipping.")
                        continue
            else:
                # Original fallback logic for legacy containers
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
                # logger.info(f"Container image name: {con['name']}")  # Temporarily hidden
                # logger.info("Available model implementations:")  # Temporarily hidden
                # for k, v in model_implmentations.items():  # Temporarily hidden
                #     logger.info(f"Model ID: {k}, Image Version: {v.model_name}")  # Temporarily hidden
                if len(model_impl) == 0:
                    logger.warning(f"Cannot find model_impl for container {con['name']} with image {con['image_name']}")
                    continue
                
                model_impl = model_impl[0]
        con["model_id"] = model_impl.model_id
        con["weights_id"] = con["env_vars"].get("MODEL_WEIGHTS_ID")
        con["model_impl"] = model_impl
        # logger.info(f"con['networks']={con["networks"]}")  # Temporarily hidden
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
            logger.info(f"Added container {con['name']} (ID: {con_id[:12]}) to deploy cache")
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
        logger.info("Running initial tt-smi -s command to check device detection.")

        # Initial check to see if Tenstorrent devices are detected
        def check_device_detection():
            process = subprocess.Popen(
                ["tt-smi", "-s"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,  # Prevents interactive command-line interface
                text=True,
            )
            output = []
            detected_chips = 0
            warnings = []
            for line in iter(process.stdout.readline, ""):
                logger.info(f"tt-smi output: {line.strip()}")
                output.append(line)
                lower_line = line.lower()
                if "detected chips" in lower_line:
                    # Expect format like: "Detected Chips: 2"
                    try:
                        parts = line.strip().split(":")
                        if len(parts) == 2:
                            detected_chips = int(parts[1].strip().split()[0])
                    except (ValueError, IndexError) as e:
                        warnings.append(f"Unable to parse detected chips from line: {line.strip()}")
                        logger.warning(f"Unable to parse detected chips from line '{line.strip()}': {e}")
                if "response_q out of sync" in lower_line or "rd_ptr" in lower_line:
                    warnings.append(line.strip())
                if "No Tenstorrent devices detected" in line:
                    return {
                        "status": "error",
                        "message": "No Tenstorrent devices detected! Please check your hardware and try again.",
                        "output": "".join(output),
                        "http_status": 503,  # Service Unavailable
                    }
            process.stdout.close()
            return_code = process.wait()
            
            # Parse JSON output if text parsing didn't find chips
            if detected_chips == 0:
                full_output = "".join(output)
                try:
                    json_data = json.loads(full_output)
                    if "device_info" in json_data and isinstance(json_data["device_info"], list):
                        detected_chips = len(json_data["device_info"])
                        logger.info(f"Detected {detected_chips} chips from JSON output")
                except json.JSONDecodeError as e:
                    logger.warning(f"Could not parse tt-smi output as JSON: {e}")
            
            # If chips are detected, allow reset but surface warnings/return code
            if detected_chips > 0:
                if return_code != 0:
                    warnings.append(f"tt-smi -s exited with code {return_code}")
                status_val = "success" if not warnings and return_code == 0 else "warning"
                return {
                    "status": status_val,
                    "output": "".join(output),
                    "warnings": warnings,
                    "detected_chips": detected_chips,
                    "return_code": return_code,
                }
            if return_code != 0:
                return {
                    "status": "error",
                    "message": f"tt-smi -s command failed with return code {return_code}. Please check if tt-smi is properly installed.",
                    "output": "".join(output),
                    "http_status": 500,  # Internal Server Error
                }
            return {
                "status": "success",
                "message": "No Tenstorrent devices detected. tt-smi executed successfully.",
                "output": "".join(output),
                "detected_chips": 0,
                "return_code": return_code,
            }

        # Run the device detection check
        detection_result = check_device_detection()
        detection_warnings = detection_result.get("warnings", [])
        detection_output = detection_result.get("output", "")
        if detection_result.get("status") == "error":
            return detection_result
        if detection_output:
            cumulative_output = [detection_output]
        else:
            cumulative_output = []
        if detection_warnings:
            cumulative_output.append("Warnings during device detection:\n")
            cumulative_output.extend([w + "\n" for w in detection_warnings])

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

        # Try tt-smi reset with retries (no reset config file; use default tt-smi behavior)
        while reset_attempts < MAX_RESET_ATTEMPTS and not reset_success:
            reset_attempts += 1
            logger.info(f"Reset attempt {reset_attempts} of {MAX_RESET_ATTEMPTS}")
            cumulative_output.append(f"Attempting reset {reset_attempts} of {MAX_RESET_ATTEMPTS}...\n")

            # Perform reset using tt-smi default behavior (no reset_config.json)
            cumulative_output.append("Executing tt-smi -r with default reset configuration.\n")
            reset_result = stream_command_output(["tt-smi", "-r"])
            cumulative_output.append(reset_result.get('output', '') + "\n")

            if reset_result.get("status") == "success":
                logger.info(f"Reset attempt {reset_attempts} succeeded")
                reset_success = True
                break

            logger.warning(f"Reset attempt {reset_attempts} failed")
            # Small delay between attempts
            time.sleep(2)

        # If all reset attempts failed
        if not reset_success:
            all_output = "".join(cumulative_output)
            logger.error(f"All {MAX_RESET_ATTEMPTS} reset attempts failed")
            return {
                "status": "error", 
                "message": f"All {MAX_RESET_ATTEMPTS} reset attempts failed using tt-smi --reset command.",
                "output": all_output,
                "http_status": 500
            }

        all_output = "".join(cumulative_output)
        if reset_success:
            return {
                "status": "success",
                "message": f"Reset successful after {reset_attempts} attempt(s)",
                "output": all_output,
                "warnings": detection_warnings,
                "http_status": 200
            }
        else:
            return {
                "status": "error",
                "message": "All reset attempts failed with no specific error",
                "output": all_output,
                "warnings": detection_warnings,
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

        docker_client = get_docker_client()

        # Try using docker-control-service API
        exists = docker_client.image_exists(image_name, image_tag)

        if exists:
            # Get all images to find size info
            response = docker_client.list_images()
            # Extract images array from response dict
            images_list = response.get("images", []) if isinstance(response, dict) else []
            for image_data in images_list:
                tags = image_data.get("tags", [])
                if target_image in tags or any(image_name in tag and image_tag in tag for tag in tags):
                    size_bytes = image_data.get("size", 0)
                    size_mb = round(size_bytes / (1024 * 1024), 2)
                    logger.info(f"Found image: {target_image}")
                    return {
                        "exists": True,
                        "size": f"{size_mb}MB",
                        "status": "available"
                    }

            # Image exists but no size info
            return {
                "exists": True,
                "size": "unknown",
                "status": "available"
            }

        logger.warning(f"Image not found: {target_image}")
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

def detect_board_type():
    """Detect board type using cached data from SystemResourceService"""
    try:
        return SystemResourceService.get_board_type()
    except Exception as e:
        logger.error(f"Error detecting board type: {str(e)}")
        return "unknown"


def notify_agent_of_new_container(container_name):
    """Notify the agent about a new container deployment"""
    try:
        import requests
        agent_url = "http://tt_studio_agent:8080/refresh"
        response = requests.post(agent_url, timeout=10)
        
        if response.status_code == 200:
            logger.info(f"Successfully notified agent about new container: {container_name}")
        else:
            logger.warning(f"Failed to notify agent (status {response.status_code}): {response.text}")
            
    except Exception as e:
        logger.warning(f"Failed to notify agent about new container {container_name}: {e}")
        # Don't fail the deployment if agent notification fails