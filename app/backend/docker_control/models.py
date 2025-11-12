# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from django.db import models
from django.utils import timezone


class ModelDeployment(models.Model):
    """Track all model deployments with full history"""
    # Deployment identification
    container_id = models.CharField(max_length=255, unique=True, db_index=True)
    container_name = models.CharField(max_length=255, db_index=True)
    
    # Model information
    model_name = models.CharField(max_length=255, db_index=True)
    device = models.CharField(max_length=50)  # n150, n300, etc.
    
    # Deployment metadata
    deployed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    stopped_at = models.DateTimeField(null=True, blank=True)
    
    # Status tracking
    status = models.CharField(max_length=50, default="running", db_index=True)
    # Choices: starting, running, stopped, exited, dead, error
    stopped_by_user = models.BooleanField(default=False)  # True if user clicked stop/delete
    
    # Container details
    port = models.IntegerField(null=True, blank=True)
    
    class Meta:
        ordering = ['-deployed_at']
        indexes = [
            models.Index(fields=['status', '-deployed_at']),
            models.Index(fields=['model_name', '-deployed_at']),
        ]
    
    def __str__(self):
        return f"{self.model_name} on {self.device} - {self.status}"
