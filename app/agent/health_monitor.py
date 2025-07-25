# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import asyncio
import time
import requests
from typing import Optional, Callable, Dict, Any
from llm_discovery import LLMDiscoveryService, LLMInfo, HealthStatus

class LLMHealthMonitor:
    def __init__(self, llm, discovery_service: LLMDiscoveryService):
        from config import AgentConfig
        self.llm = llm
        self.discovery_service = discovery_service
        self.health_check_interval = AgentConfig.HEALTH_CHECK_INTERVAL
        self.max_failures = AgentConfig.MAX_FAILURES
        self.failure_count = 0
        self.last_health_check = 0
        self.is_monitoring = False
        self.on_llm_change: Optional[Callable] = None
        self.current_llm_info: Optional[LLMInfo] = None
        
    async def start_monitoring(self):
        """Start health monitoring in background"""
        if self.is_monitoring:
            return
            
        self.is_monitoring = True
        print("Starting LLM health monitoring...")
        
        while self.is_monitoring:
            try:
                if not await self._check_health():
                    self.failure_count += 1
                    print(f"LLM health check failed ({self.failure_count}/{self.max_failures})")
                    
                    if self.failure_count >= self.max_failures:
                        await self._switch_to_fallback()
                else:
                    if self.failure_count > 0:
                        print("LLM health recovered")
                    self.failure_count = 0
                    
            except Exception as e:
                print(f"Health check error: {e}")
                self.failure_count += 1
                
                if self.failure_count >= self.max_failures:
                    await self._switch_to_fallback()
            
            await asyncio.sleep(self.health_check_interval)
    
    def stop_monitoring(self):
        """Stop health monitoring"""
        self.is_monitoring = False
        print("Stopping LLM health monitoring...")
    
    async def _check_health(self) -> bool:
        """Check if current LLM is healthy"""
        try:
            if hasattr(self.llm, 'llm_info') and self.llm.llm_info:
                health_url = f"http://{self.llm.llm_info['health_url']}"
                response = requests.get(health_url, timeout=5)
                return response.status_code == 200
            elif hasattr(self.llm, 'server_url') and 'localhost' in self.llm.server_url:
                # For local host LLMs, try a simple ping
                response = requests.get(self.llm.server_url.replace('/v1/chat/completions', '/health'), timeout=5)
                return response.status_code == 200
            else:
                # For cloud LLMs, assume healthy (they have their own monitoring)
                return True
        except Exception as e:
            print(f"Health check failed: {e}")
            return False
    
    async def _switch_to_fallback(self):
        """Switch to fallback LLM"""
        print("LLM unhealthy, attempting to switch to fallback...")
        
        try:
            # Discover available LLMs
            local_llms = self.discovery_service.discover_local_llms()
            
            if not local_llms:
                print("No fallback LLMs available")
                return
            
            # Select best fallback
            fallback_llm = self.discovery_service.select_best_llm(local_llms)
            
            if fallback_llm and fallback_llm != self.current_llm_info:
                print(f"Switching to fallback LLM: {fallback_llm.model_name}")
                
                # Create new LLM instance
                from custom_llm import CustomLLM
                new_llm = CustomLLM(
                    server_url=f"http://{fallback_llm.internal_url}",
                    encoded_jwt=self.llm.encoded_jwt,
                    streaming=True,
                    is_cloud=False,
                    is_discovered=True,
                    llm_info={
                        'deploy_id': fallback_llm.deploy_id,
                        'container_name': fallback_llm.container_name,
                        'internal_url': fallback_llm.internal_url,
                        'health_url': fallback_llm.health_url,
                        'model_name': fallback_llm.model_name
                    }
                )
                
                # Update current LLM
                self.llm = new_llm
                self.current_llm_info = fallback_llm
                self.failure_count = 0
                
                # Notify callback if set
                if self.on_llm_change:
                    self.on_llm_change(new_llm)
                    
                print(f"Successfully switched to {fallback_llm.model_name}")
            else:
                print("No suitable fallback LLM found")
                
        except Exception as e:
            print(f"Failed to switch to fallback: {e}")
    
    def set_llm_change_callback(self, callback: Callable):
        """Set callback to be called when LLM changes"""
        self.on_llm_change = callback
    
    def get_health_status(self) -> Dict[str, Any]:
        """Get current health status"""
        return {
            'is_monitoring': self.is_monitoring,
            'failure_count': self.failure_count,
            'last_health_check': self.last_health_check,
            'current_llm': self.current_llm_info.model_name if self.current_llm_info else None,
            'health_status': 'healthy' if self.failure_count == 0 else 'degraded' if self.failure_count < self.max_failures else 'unhealthy'
        } 