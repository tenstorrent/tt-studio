# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.db import models
from django.utils import timezone


class HardwareSnapshot(models.Model):
    """Store hardware snapshots from tt-smi"""
    timestamp = models.DateTimeField(default=timezone.now)
    raw_data = models.JSONField()
    host_info = models.JSONField()
    devices_count = models.IntegerField(default=0)
    
    class Meta:
        ordering = ['-timestamp']


class DeviceTelemetry(models.Model):
    """Store device telemetry data"""
    snapshot = models.ForeignKey(HardwareSnapshot, on_delete=models.CASCADE, related_name='devices')
    device_index = models.IntegerField()
    board_type = models.CharField(max_length=50)
    bus_id = models.CharField(max_length=20)
    board_id = models.CharField(max_length=50)
    coords = models.CharField(max_length=50)
    
    # Telemetry data
    voltage = models.FloatField(null=True)
    current = models.FloatField(null=True)
    power = models.FloatField(null=True)
    aiclk = models.IntegerField(null=True)
    asic_temperature = models.FloatField(null=True)
    
    # Status
    dram_status = models.BooleanField(default=False)
    dram_speed = models.CharField(max_length=10, null=True)
    pcie_speed = models.IntegerField(null=True)
    pcie_width = models.CharField(max_length=10, null=True)
    
    class Meta:
        unique_together = ['snapshot', 'device_index']


class SystemGuardrails(models.Model):
    """Store system guardrails configuration"""
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField()
    is_enabled = models.BooleanField(default=True)
    threshold_value = models.FloatField(null=True)
    threshold_type = models.CharField(max_length=20, choices=[
        ('temperature', 'Temperature'),
        ('power', 'Power'),
        ('voltage', 'Voltage'),
        ('frequency', 'Frequency'),
    ])
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)


class HardwareAlert(models.Model):
    """Store hardware alerts and notifications"""
    device_index = models.IntegerField()
    alert_type = models.CharField(max_length=50)
    severity = models.CharField(max_length=20, choices=[
        ('info', 'Info'),
        ('warning', 'Warning'),
        ('error', 'Error'),
        ('critical', 'Critical'),
    ])
    message = models.TextField()
    is_resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    resolved_at = models.DateTimeField(null=True)
    
    class Meta:
        ordering = ['-created_at'] 