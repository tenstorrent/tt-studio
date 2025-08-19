# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import requests
import time
import json
import os
from typing import List, Dict, Optional
from dataclasses import dataclass
from enum import Enum

class HealthStatus(Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"

@dataclass
class LLMInfo:
    deploy_id: str
    container_name: str
    internal_url: str
    health_url: str
    model_name: str
    model_type: str
    status: HealthStatus = HealthStatus.UNKNOWN

class LLMDiscoveryService:
    def __init__(self):
        try:
            from .config import AgentConfig
        except ImportError:
            from config import AgentConfig
        self.backend_url = AgentConfig.BACKEND_URL
        self.cache = {}
        self.cache_ttl = AgentConfig.DISCOVERY_CACHE_TTL
        self.health_check_timeout = AgentConfig.HEALTH_CHECK_TIMEOUT
        self.max_failures = AgentConfig.MAX_FAILURES
        
    def discover_local_llms(self) -> List[LLMInfo]:
        """Discover all available local LLM containers"""
        try:
            # Check cache first
            cache_key = "local_llms"
            cached = self.cache.get(cache_key)
            
            if cached and (time.time() - cached['timestamp']) < self.cache_ttl:
                return cached['data']
            
            # Get deployed models from backend
            response = requests.get(f"{self.backend_url}/models/deployed/", timeout=10)
            if response.status_code == 200:
                deployed_models = response.json()
                llms = self._filter_healthy_llms(deployed_models)
                
                # Update cache
                self.cache[cache_key] = {
                    'data': llms,
                    'timestamp': time.time()
                }
                return llms
            else:
                print(f"Failed to fetch deployed models: {response.status_code}")
                return []
        except Exception as e:
            print(f"Error discovering LLMs: {e}")
            return []
    
    def _filter_healthy_llms(self, deployed_models: Dict) -> List[LLMInfo]:
        """Filter only healthy LLM containers with support for different model types"""
        healthy_llms = []
        
        for deploy_id, model_info in deployed_models.items():
            try:
                # Support multiple model types, not just chat
                model_type = model_info.get('model_impl', {}).get('model_type', 'chat')
                model_name = model_info.get('model_impl', {}).get('model_name', 'Unknown')
                hf_model_id = model_info.get('model_impl', {}).get('hf_model_id', None)
                
                print(f"[DISCOVERY] Processing model: {model_name} (type: {model_type}) hf_model_id: {hf_model_id}")
                
                # Check health status
                health_url = f"http://{model_info['health_url']}"
                status = self._check_health_status(health_url)
                
                llm_info = LLMInfo(
                    deploy_id=deploy_id,
                    container_name=model_info.get('name', ''),
                    internal_url=model_info['internal_url'],
                    health_url=model_info['health_url'],
                    model_name=model_name,
                    model_type=model_type,
                    status=status
                )
                # Attach hf_model_id as an extra attribute
                llm_info.hf_model_id = hf_model_id
                
                # Accept healthy and degraded models
                if status in [HealthStatus.HEALTHY, HealthStatus.DEGRADED]:
                    healthy_llms.append(llm_info)
                    print(f"[DISCOVERY] Added healthy model: {model_name} ({status.value})")
                else:
                    print(f"[DISCOVERY] Skipped unhealthy model: {model_name} ({status.value})")
                    
            except Exception as e:
                print(f"[DISCOVERY] Error processing model {deploy_id}: {e}")
                continue
                
        return healthy_llms
    
    def _check_health_status(self, health_url: str) -> HealthStatus:
        """Check health status of an LLM container"""
        try:
            start_time = time.time()
            response = requests.get(health_url, timeout=self.health_check_timeout)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                if response_time < 2:  # Fast response
                    return HealthStatus.HEALTHY
                elif response_time < 5:  # Slow but working
                    return HealthStatus.DEGRADED
                else:  # Very slow
                    return HealthStatus.DEGRADED
            else:
                return HealthStatus.UNHEALTHY
                
        except requests.exceptions.Timeout:
            return HealthStatus.UNHEALTHY
        except Exception:
            return HealthStatus.UNHEALTHY
    
    def select_best_llm(self, local_llms: List[LLMInfo]) -> Optional[LLMInfo]:
        """Select the best LLM based on dynamic priority criteria"""
        if not local_llms:
            print("[SELECTION] No LLMs available for selection")
            return None
            
        print(f"[SELECTION] Selecting from {len(local_llms)} available LLMs:")
        for llm in local_llms:
            print(f"  - {llm.model_name} ({llm.model_type}) - {llm.status.value}")
        
        # Get priority models and model type priority from configuration
        try:
            from .config import AgentConfig
        except ImportError:
            from config import AgentConfig
        priority_models = AgentConfig.get_priority_models()
        model_type_priority = AgentConfig.get_model_type_priority()
        
        print(f"[SELECTION] Priority models: {priority_models}")
        print(f"[SELECTION] Model type priority: {model_type_priority}")
        
        # First, try to find a healthy priority model (any type)
        for model_name in priority_models:
            for llm in local_llms:
                if (model_name.lower() in llm.model_name.lower() and 
                    llm.status == HealthStatus.HEALTHY):
                    print(f"[SELECTION] Selected healthy priority model: {llm.model_name}")
                    return llm
        
        # If no priority model is healthy, try degraded priority models
        for model_name in priority_models:
            for llm in local_llms:
                if (model_name.lower() in llm.model_name.lower() and 
                    llm.status == HealthStatus.DEGRADED):
                    print(f"[SELECTION] Selected degraded priority model: {llm.model_name}")
                    return llm
        
        # If no priority models, use model type priority
        for model_type in model_type_priority:
            # Try healthy models of this type
            for llm in local_llms:
                if (llm.model_type == model_type and 
                    llm.status == HealthStatus.HEALTHY):
                    print(f"[SELECTION] Selected healthy {model_type} model: {llm.model_name}")
                    return llm
            
            # Try degraded models of this type
            for llm in local_llms:
                if (llm.model_type == model_type and 
                    llm.status == HealthStatus.DEGRADED):
                    print(f"[SELECTION] Selected degraded {model_type} model: {llm.model_name}")
                    return llm
        
        # If no models match type priority, return the first healthy one (any type)
        for llm in local_llms:
            if llm.status == HealthStatus.HEALTHY:
                print(f"[SELECTION] Selected first healthy model: {llm.model_name}")
                return llm
        
        # If no healthy models, return the first degraded one (any type)
        for llm in local_llms:
            if llm.status == HealthStatus.DEGRADED:
                print(f"[SELECTION] Selected first degraded model: {llm.model_name}")
                return llm
        
        # Last resort: return the first available
        if local_llms:
            print(f"[SELECTION] Last resort selection: {local_llms[0].model_name}")
            return local_llms[0]
        
        print("[SELECTION] No suitable LLM found")
        return None
    
    def clear_cache(self):
        """Clear the discovery cache"""
        self.cache.clear()
    
    def get_llm_status_summary(self) -> Dict:
        """Get a summary of all discovered LLMs and their status"""
        llms = self.discover_local_llms()
        summary = {
            'total_llms': len(llms),
            'healthy': len([llm for llm in llms if llm.status == HealthStatus.HEALTHY]),
            'degraded': len([llm for llm in llms if llm.status == HealthStatus.DEGRADED]),
            'unhealthy': len([llm for llm in llms if llm.status == HealthStatus.UNHEALTHY]),
            'llms': [
                {
                    'deploy_id': llm.deploy_id,
                    'model_name': llm.model_name,
                    'status': llm.status.value,
                    'internal_url': llm.internal_url
                }
                for llm in llms
            ]
        }
        return summary 