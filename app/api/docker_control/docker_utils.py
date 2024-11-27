# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

# docker_control/docker_utils.py
import socket,os,subprocess
import copy
from pathlib import Path

import docker
from django.core.cache import caches

from shared_config.device_config import DeviceConfigurations
from shared_config.logger_config import get_logger
from shared_config.model_config import model_implmentations
from shared_config.backend_config import backend_config


CONFIG_PATH = '/root/.config/tenstorrent/reset_config.json'
logger = get_logger(__name__)
logger.info(f"importing {__name__}")
client = docker.from_env()

# docker internal bridge network used for models and applications.
networks = client.networks.list()
if backend_config.docker_bridge_network_name not in [net.name for net in networks]:
    network = client.networks.create(
        backend_config.docker_bridge_network_name, driver="bridge"
    )


def run_container(impl, weights_id):
    """Run a docker container from an image"""
    try:
        logger.info(f"run_container called for {impl.model_name}")
        run_kwargs = copy.deepcopy(impl.docker_config)
        # handle runtime configuration changes to docker kwargs
        run_kwargs.update({"devices": get_devices_mounts(impl)})
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
        env_file = impl.env_file()
        with open(env_file, 'r') as file:
            for line in file:
                # Strip leading/trailing whitespace and ignore comments/empty lines
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                
                # Split on the first '='
                key, _, value = line.partition('=')
                key, value = key.strip(), value.strip()
                run_kwargs["environment"][key] = value
                
        logger.info(f"run_kwargs:= {run_kwargs}")
        container = client.containers.run(impl.image_version, **run_kwargs)
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
    # e.g. running falcon-7B and mistral-7B on 2x n150 machine
    if device_config in {DeviceConfigurations.N150, DeviceConfigurations.E150}:
        devices = ["/dev/tenstorrent/0:/dev/tenstorrent/0"]
    elif device_config == DeviceConfigurations.N300x4:
        devices = ["/dev/tenstorrent:/dev/tenstorrent"]
    elif device_config == DeviceConfigurations.CPU:
        devices = None
    return devices


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
    data = get_container_status()
    for con_id, con in data.items():
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
            caches[backend_config.django_deploy_cache_name].set(con_id, con, timeout=None)
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
                ['tt-smi'], 
                stdout=subprocess.PIPE, 
                stderr=subprocess.STDOUT, 
                stdin=subprocess.DEVNULL,  # Prevents interactive command-line interface
                text=True
            )
            output = []
            for line in iter(process.stdout.readline, ''):
                logger.info(f"tt-smi output: {line.strip()}")
                output.append(line)
                if "No Tenstorrent devices detected" in line:
                    return {
                        "status": "error",
                        "message": "No Tenstorrent devices detected! Please check your hardware and try again.",
                        "output": ''.join(output),
                        "http_status": 501  # Not Implemented
                    }
            process.stdout.close()
            return_code = process.wait()
            if return_code != 0:
                return {
                    "status": "error",
                    "message": f"tt-smi command failed with return code {return_code}.",
                    "output": ''.join(output),
                    "http_status": 500  # Internal Server Error
                }
            return {"status": "success", "output": ''.join(output)}

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
                text=True
            )
            output = []
            for line in iter(process.stdout.readline, ''):
                logger.info(f"Command output: {line.strip()}")
                output.append(line)
            process.stdout.close()
            return_code = process.wait()
            if return_code != 0:
                logger.info(f"Command failed with return code {return_code}")
                output.append(f"Command failed with return code {return_code}")
                return {
                    "status": "error",
                    "output": ''.join(output),
                    "http_status": 500  # Internal Server Error
                }
            else:
                logger.info(f"Command completed successfully with return code {return_code}")
                return {
                    "status": "success",
                    "output": ''.join(output)
                }

        # Step 1: Check if the reset config JSON already exists
        if not os.path.exists(CONFIG_PATH):
            generate_result = stream_command_output(['tt-smi', '--generate_reset_json'])
            if generate_result.get("status") == "error":
                return generate_result
        
        # Step 2: Run the reset using the generated JSON
        reset_result = stream_command_output(['tt-smi', '-r', CONFIG_PATH])
        return reset_result or {"status": "error", "output": "No output from reset command"}

    except Exception as e:
        logger.exception("Exception occurred during reset operation.")
        return {"status": "error", "message": str(e), "output": "An exception occurred during the reset operation.", "http_status": 500}