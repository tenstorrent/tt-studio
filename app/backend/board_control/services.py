# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import subprocess
import json
import os
import psutil
import signal
import time
from django.utils import timezone
from django.core.cache import cache
from shared_config.logger_config import get_logger
from .models import HardwareSnapshot, DeviceTelemetry, HardwareAlert

logger = get_logger(__name__)

class SystemResourceService:
    """Service for monitoring system resources and TT device telemetry"""
    
    # Cache keys and timeout
    TT_SMI_CACHE_KEY = "tt_smi_data"
    TT_SMI_CACHE_TIMEOUT = 10  # Cache for 10 seconds
    
    @staticmethod
    def get_tt_smi_data(timeout=10):
        """Get raw tt-smi data with caching to reduce expensive calls"""
        # Check cache first
        cached_data = cache.get(SystemResourceService.TT_SMI_CACHE_KEY)
        if cached_data is not None:
            logger.debug("Using cached tt-smi data")
            return cached_data
        
        try:
            logger.info("Running tt-smi -s to get device telemetry")
            
            process = subprocess.Popen(
                ["tt-smi", "-s"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL,
                text=True,
                preexec_fn=os.setsid  # Create new process group
            )
            
            try:
                # Wait for process with timeout
                stdout, stderr = process.communicate(timeout=timeout)
                
                if process.returncode != 0:
                    logger.error(f"tt-smi -s failed with return code {process.returncode}, stderr: {stderr}")
                    # Cache the None result for a shorter time to avoid repeated failures
                    cache.set(SystemResourceService.TT_SMI_CACHE_KEY, None, timeout=5)
                    return None
                
                # Parse JSON output
                try:
                    data = json.loads(stdout)
                    logger.info("Successfully parsed tt-smi data")
                    # Cache the successful result
                    cache.set(SystemResourceService.TT_SMI_CACHE_KEY, data, timeout=SystemResourceService.TT_SMI_CACHE_TIMEOUT)
                    return data
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse tt-smi JSON output: {e}, stdout: {stdout}")
                    cache.set(SystemResourceService.TT_SMI_CACHE_KEY, None, timeout=5)
                    return None
                    
            except subprocess.TimeoutExpired:
                logger.error(f"tt-smi -s command timed out after {timeout} seconds")
                # Kill the process group to ensure cleanup
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                    process.wait(timeout=2)
                except:
                    try:
                        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                    except:
                        pass
                # Cache the None result for a shorter time
                cache.set(SystemResourceService.TT_SMI_CACHE_KEY, None, timeout=5)
                return None
                
        except FileNotFoundError:
            logger.error("tt-smi command not found")
            cache.set(SystemResourceService.TT_SMI_CACHE_KEY, None, timeout=30)  # Cache longer for missing command
            return None
        except Exception as e:
            logger.error(f"Error getting tt-smi data: {str(e)}")
            cache.set(SystemResourceService.TT_SMI_CACHE_KEY, None, timeout=5)
            return None

    @staticmethod
    def get_system_resources():
        """Get comprehensive system resources including CPU, memory, and TT device data"""
        try:
            # Get system resources (these should always work)
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            memory_usage_percent = memory.percent
            memory_total_gb = round(memory.total / (1024**3), 2)
            
            # Initialize basic system status with fallbacks
            system_status = {
                "timestamp": timezone.now().isoformat(),
                "host_info": {
                    "cpu_usage": round(cpu_percent, 1),
                    "memory_usage": round(memory_usage_percent, 1),
                    "memory_total": f"{memory_total_gb} GB",
                    "memory_used_gb": round(memory.used / (1024**3), 2),
                    "memory_available_gb": round(memory.available / (1024**3), 2)
                },
                "devices": [],
                "board_name": "Unknown",
                "hardware_status": "unknown",
                "hardware_error": None
            }
            
            # Try to get TT device data with timeout
            try:
                tt_data = SystemResourceService.get_tt_smi_data(timeout=10)
                
                if tt_data:
                    system_status["hardware_status"] = "healthy"
                    
                    # Add host info from tt-smi if available
                    if "host_info" in tt_data:
                        host_info = tt_data["host_info"]
                        system_status["host_info"].update({
                            "os": host_info.get("OS"),
                            "distro": host_info.get("Distro"),
                            "kernel": host_info.get("Kernel"),
                            "hostname": host_info.get("Hostname"),
                            "driver": host_info.get("Driver")
                        })
                    
                    # Process device information
                    if "device_info" in tt_data and tt_data["device_info"]:
                        devices = []
                        board_types = []
                        
                        for idx, device in enumerate(tt_data["device_info"]):
                            board_info = device.get("board_info", {})
                            telemetry = device.get("telemetry", {})
                            limits = device.get("limits", {})
                            
                            # Track board types
                            board_type = board_info.get("board_type", "Unknown")
                            board_types.append(board_type)
                            
                            device_data = {
                                "index": idx,
                                "board_type": board_type,
                                "bus_id": board_info.get("bus_id", "N/A"),
                                "coords": board_info.get("coords", "N/A"),
                                "voltage": float(telemetry.get("voltage", 0)) if telemetry.get("voltage") else 0,
                                "current": float(telemetry.get("current", 0)) if telemetry.get("current") else 0,
                                "power": float(telemetry.get("power", 0)) if telemetry.get("power") else 0,
                                "aiclk": int(telemetry.get("aiclk", 0)) if telemetry.get("aiclk") else 0,
                                "temperature": float(telemetry.get("asic_temperature", 0)) if telemetry.get("asic_temperature") else 0,
                                "limits": {
                                    "tdp_limit": int(limits.get("tdp_limit", 0)) if limits.get("tdp_limit") else 0,
                                    "tdc_limit": int(limits.get("tdc_limit", 0)) if limits.get("tdc_limit") else 0,
                                    "thm_limit": int(limits.get("thm_limit", 0)) if limits.get("thm_limit") else 0
                                }
                            }
                            devices.append(device_data)
                        
                        system_status["devices"] = devices
                        
                        # Determine primary board name
                        if board_types:
                            if len(board_types) == 1:
                                system_status["board_name"] = "N150"
                            elif len(board_types) == 2:
                                system_status["board_name"] = "N300"
                            elif len(board_types) == 8:
                                system_status["board_name"] = "T3K"
                            else:
                                system_status["board_name"] = board_types[0]
                else:
                    # tt-smi failed - indicate potential hardware issue
                    system_status["hardware_status"] = "error"
                    system_status["hardware_error"] = "Unable to communicate with TT hardware. The card may be in a bad state or tt-smi is not responding."
                    system_status["board_name"] = "TT Board (Error)"
                    logger.warning("tt-smi failed - hardware may be in bad state")
                    
            except Exception as hardware_error:
                logger.error(f"Hardware monitoring failed: {str(hardware_error)}")
                system_status["hardware_status"] = "error"
                system_status["hardware_error"] = f"Hardware monitoring error: {str(hardware_error)}"
                system_status["board_name"] = "TT Board (Error)"
            
            return system_status
            
        except Exception as e:
            logger.error(f"Error getting system resources: {str(e)}")
            return {
                "timestamp": timezone.now().isoformat(),
                "host_info": {
                    "cpu_usage": 0,
                    "memory_usage": 0,
                    "memory_total": "0 GB",
                    "memory_used_gb": 0,
                    "memory_available_gb": 0
                },
                "devices": [],
                "board_name": "System Error",
                "hardware_status": "error",
                "hardware_error": str(e),
                "error": str(e)
            }

    @staticmethod
    def save_hardware_snapshot():
        """Save current hardware state to database"""
        try:
            tt_data = SystemResourceService.get_tt_smi_data()
            system_resources = SystemResourceService.get_system_resources()
            
            if not tt_data:
                logger.warning("No tt-smi data available for snapshot")
                return None
            
            # Create snapshot
            snapshot = HardwareSnapshot.objects.create(
                raw_data=tt_data,
                host_info=system_resources["host_info"],
                devices_count=len(system_resources["devices"])
            )
            
            # Create device telemetry records
            for device_data in system_resources["devices"]:
                DeviceTelemetry.objects.create(
                    snapshot=snapshot,
                    device_index=device_data["index"],
                    board_type=device_data["board_type"],
                    bus_id=device_data["bus_id"],
                    board_id=tt_data["device_info"][device_data["index"]].get("board_info", {}).get("board_id", ""),
                    coords=device_data["coords"],
                    voltage=device_data["voltage"],
                    current=device_data["current"],
                    power=device_data["power"],
                    aiclk=device_data["aiclk"],
                    asic_temperature=device_data["temperature"],
                    dram_status=tt_data["device_info"][device_data["index"]].get("board_info", {}).get("dram_status", False),
                    dram_speed=tt_data["device_info"][device_data["index"]].get("board_info", {}).get("dram_speed"),
                    pcie_speed=tt_data["device_info"][device_data["index"]].get("board_info", {}).get("pcie_speed"),
                    pcie_width=tt_data["device_info"][device_data["index"]].get("board_info", {}).get("pcie_width")
                )
            
            logger.info(f"Hardware snapshot saved with {len(system_resources['devices'])} devices")
            return snapshot
            
        except Exception as e:
            logger.error(f"Error saving hardware snapshot: {str(e)}")
            return None

    @staticmethod
    def check_hardware_alerts(system_resources):
        """Check for hardware alerts based on current telemetry"""
        alerts = []
        
        try:
            for device in system_resources.get("devices", []):
                device_idx = device["index"]
                temperature = device["temperature"]
                power = device["power"]
                limits = device["limits"]
                
                # Temperature alerts
                if temperature > limits.get("thm_limit", 75):
                    alerts.append({
                        "device_index": device_idx,
                        "alert_type": "temperature",
                        "severity": "critical" if temperature > 85 else "warning",
                        "message": f"Device {device_idx} temperature ({temperature}°C) exceeds limit ({limits.get('thm_limit', 75)}°C)",
                        "value": temperature,
                        "limit": limits.get("thm_limit", 75)
                    })
                
                # Power alerts  
                if power > limits.get("tdp_limit", 85):
                    alerts.append({
                        "device_index": device_idx,
                        "alert_type": "power",
                        "severity": "warning",
                        "message": f"Device {device_idx} power ({power}W) exceeds TDP limit ({limits.get('tdp_limit', 85)}W)",
                        "value": power,
                        "limit": limits.get("tdp_limit", 85)
                    })
            
            # Save critical alerts to database
            for alert in alerts:
                if alert["severity"] in ["critical", "error"]:
                    HardwareAlert.objects.create(
                        device_index=alert["device_index"],
                        alert_type=alert["alert_type"],
                        severity=alert["severity"],
                        message=alert["message"]
                    )
            
            return alerts
            
        except Exception as e:
            logger.error(f"Error checking hardware alerts: {str(e)}")
            return [] 