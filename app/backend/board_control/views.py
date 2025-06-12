# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from shared_config.logger_config import get_logger
from .services import SystemResourceService
from .models import HardwareSnapshot, DeviceTelemetry, HardwareAlert
from django.utils import timezone

logger = get_logger(__name__)


@method_decorator(csrf_exempt, name='dispatch')
class SystemStatusView(APIView):
    """Get current system resources and device telemetry"""
    
    def get(self, request, *args, **kwargs):
        try:
            logger.info("Fetching system status")
            system_resources = SystemResourceService.get_system_resources()
            
            # Check for alerts
            alerts = SystemResourceService.check_hardware_alerts(system_resources)
            system_resources["alerts"] = alerts
            
            logger.info(f"System status retrieved: {len(system_resources.get('devices', []))} devices, {len(alerts)} alerts")
            return Response(system_resources, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error fetching system status: {str(e)}")
            return Response(
                {"error": "Failed to fetch system status", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


@method_decorator(csrf_exempt, name='dispatch')
class FooterDataView(APIView):
    """Simplified endpoint specifically for Footer component data"""
    
    def get(self, request, *args, **kwargs):
        try:
            logger.info("Fetching footer data")
            system_resources = SystemResourceService.get_system_resources()
            
            # Extract data specifically for Footer component
            footer_data = {
                "cpuUsage": system_resources["host_info"]["cpu_usage"],
                "memoryUsage": system_resources["host_info"]["memory_usage"],
                "memoryTotal": system_resources["host_info"]["memory_total"],
                "boardName": system_resources["board_name"],
                "temperature": 0,  # Will be set from device data
                "devices": [],
                "hardware_status": system_resources.get("hardware_status", "unknown"),
                "hardware_error": system_resources.get("hardware_error", None)
            }
            
            # Get average temperature and device info
            if system_resources["devices"]:
                temperatures = [device["temperature"] for device in system_resources["devices"] if device["temperature"] > 0]
                if temperatures:
                    footer_data["temperature"] = round(sum(temperatures) / len(temperatures), 1)
                
                # Include device summary
                footer_data["devices"] = [
                    {
                        "index": device["index"],
                        "board_type": device["board_type"],
                        "temperature": device["temperature"],
                        "power": device["power"],
                        "voltage": device["voltage"]
                    }
                    for device in system_resources["devices"]
                ]
            
            logger.info(f"Footer data retrieved for {len(footer_data['devices'])} devices")
            return Response(footer_data, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error fetching footer data: {str(e)}")
            # Return safe fallback data
            return Response({
                "cpuUsage": 0,
                "memoryUsage": 0,
                "memoryTotal": "0 GB",
                "boardName": "Error",
                "temperature": 0,
                "devices": [],
                "error": str(e)
            }, status=status.HTTP_200_OK)  # Return 200 to avoid breaking UI


@method_decorator(csrf_exempt, name='dispatch')
class DeviceTelemetryView(APIView):
    """Get detailed device telemetry data"""
    
    def get(self, request, *args, **kwargs):
        try:
            logger.info("Fetching device telemetry")
            tt_data = SystemResourceService.get_tt_smi_data()
            
            if not tt_data:
                return Response(
                    {"error": "No telemetry data available"},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE
                )
            
            return Response(tt_data, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error fetching device telemetry: {str(e)}")
            return Response(
                {"error": "Failed to fetch device telemetry", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


@method_decorator(csrf_exempt, name='dispatch')
class HardwareSnapshotView(APIView):
    """Create and retrieve hardware snapshots"""
    
    def post(self, request, *args, **kwargs):
        """Create a new hardware snapshot"""
        try:
            logger.info("Creating hardware snapshot")
            snapshot = SystemResourceService.save_hardware_snapshot()
            
            if snapshot:
                return Response({
                    "status": "success",
                    "snapshot_id": snapshot.id,
                    "timestamp": snapshot.timestamp.isoformat(),
                    "devices_count": snapshot.devices_count
                }, status=status.HTTP_201_CREATED)
            else:
                return Response(
                    {"error": "Failed to create hardware snapshot"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
                
        except Exception as e:
            logger.error(f"Error creating hardware snapshot: {str(e)}")
            return Response(
                {"error": "Failed to create hardware snapshot", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def get(self, request, *args, **kwargs):
        """Get recent hardware snapshots"""
        try:
            snapshots = HardwareSnapshot.objects.all()[:10]  # Get last 10 snapshots
            
            data = []
            for snapshot in snapshots:
                data.append({
                    "id": snapshot.id,
                    "timestamp": snapshot.timestamp.isoformat(),
                    "devices_count": snapshot.devices_count,
                    "host_info": snapshot.host_info
                })
            
            return Response(data, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error fetching hardware snapshots: {str(e)}")
            return Response(
                {"error": "Failed to fetch hardware snapshots", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


@method_decorator(csrf_exempt, name='dispatch')
class HardwareAlertsView(APIView):
    """Get hardware alerts"""
    
    def get(self, request, *args, **kwargs):
        try:
            # Get unresolved alerts
            alerts = HardwareAlert.objects.filter(is_resolved=False).order_by('-created_at')[:50]
            
            data = []
            for alert in alerts:
                data.append({
                    "id": alert.id,
                    "device_index": alert.device_index,
                    "alert_type": alert.alert_type,
                    "severity": alert.severity,
                    "message": alert.message,
                    "created_at": alert.created_at.isoformat(),
                    "is_resolved": alert.is_resolved
                })
            
            return Response(data, status=status.HTTP_200_OK)
            
        except Exception as e:
            logger.error(f"Error fetching hardware alerts: {str(e)}")
            return Response(
                {"error": "Failed to fetch hardware alerts", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    def patch(self, request, alert_id, *args, **kwargs):
        """Mark alert as resolved"""
        try:
            alert = HardwareAlert.objects.get(id=alert_id)
            alert.is_resolved = True
            alert.resolved_at = timezone.now()
            alert.save()
            
            return Response({"status": "success"}, status=status.HTTP_200_OK)
            
        except HardwareAlert.DoesNotExist:
            return Response(
                {"error": "Alert not found"},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.error(f"Error resolving alert: {str(e)}")
            return Response(
                {"error": "Failed to resolve alert", "details": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            ) 