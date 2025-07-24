# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
from typing import Optional

class AgentConfig:
    """Configuration class for the enhanced agent"""
    
    # Discovery Configuration
    AUTO_DISCOVERY_ENABLED: bool = os.getenv("AGENT_AUTO_DISCOVERY", "true").lower() == "true"
    DISCOVERY_CACHE_TTL: int = int(os.getenv("AGENT_DISCOVERY_CACHE_TTL", "30"))
    DISCOVERY_INTERVAL: int = int(os.getenv("AGENT_DISCOVERY_INTERVAL", "60"))
    
    # Health Monitoring Configuration
    HEALTH_CHECK_ENABLED: bool = os.getenv("AGENT_HEALTH_CHECK_ENABLED", "true").lower() == "true"
    HEALTH_CHECK_INTERVAL: int = int(os.getenv("AGENT_HEALTH_CHECK_INTERVAL", "30"))
    HEALTH_CHECK_TIMEOUT: int = int(os.getenv("AGENT_HEALTH_CHECK_TIMEOUT", "5"))
    MAX_FAILURES: int = int(os.getenv("AGENT_MAX_FAILURES", "3"))
    
    # Fallback Configuration
    FALLBACK_TO_LOCAL: bool = os.getenv("AGENT_FALLBACK_TO_LOCAL", "true").lower() == "true"
    FALLBACK_TO_CLOUD: bool = os.getenv("AGENT_FALLBACK_TO_CLOUD", "false").lower() == "true"
    
    # LLM Priority Configuration
    # TODO: Add more models to the priority list
    # TODO: Add a way to add models to the priority list making it dynamic and not hardcoded maybe from the backend/model_control/model_config.py file
    PRIORITY_MODELS: list = [
        'meta-llama/Llama-3.2-1B-Instruct',
        'meta-llama/Llama-3.2-3B-Instruct',
        'meta-llama/Llama-3.2-8B-Instruct',
        'meta-llama/Llama-3.3-70B-Instruct',
        'meta-llama/Llama-3.1-70B-Instruct',
    ]
    
    # Network Configuration
    BACKEND_URL: str = os.getenv("AGENT_BACKEND_URL", "http://tt-studio-backend-api:8000")
    LOCAL_HOST: str = os.getenv("LOCAL_LLM_HOST", "localhost")
    LOCAL_PORT: str = os.getenv("LOCAL_LLM_PORT", "7000")
    
    # Authentication Configuration
    JWT_SECRET: Optional[str] = os.getenv("JWT_SECRET")
    CLOUD_AUTH_TOKEN: Optional[str] = os.getenv("CLOUD_CHAT_UI_AUTH_TOKEN")
    
    # Cloud Configuration
    USE_CLOUD_LLM: bool = os.getenv("USE_CLOUD_LLM", "false").lower() == "true"
    CLOUD_ENDPOINT: str = os.getenv("CLOUD_CHAT_UI_URL", "https://api.openai.com/v1/chat/completions")
    CLOUD_MODEL_NAME: str = os.getenv("CLOUD_MODEL_NAME", "meta-llama/Llama-3.3-70B-Instruct")
    
    # Local Container Configuration
    LLM_CONTAINER_NAME: Optional[str] = os.getenv("LLM_CONTAINER_NAME")
    LOCAL_MODEL_NAME: str = os.getenv("LOCAL_MODEL_NAME", "llama-3.1-70b")
    
    # Logging Configuration
    LOG_LEVEL: str = os.getenv("AGENT_LOG_LEVEL", "INFO")
    DEBUG_MODE: bool = os.getenv("AGENT_DEBUG_MODE", "false").lower() == "true"
    
    @classmethod
    def get_priority_models(cls) -> list:
        """Get priority models from environment or use defaults"""
        env_priority = os.getenv("AGENT_PRIORITY_MODELS")
        if env_priority:
            return [model.strip() for model in env_priority.split(",")]
        return cls.PRIORITY_MODELS
    
    @classmethod
    def validate_config(cls) -> list:
        """Validate configuration and return any issues"""
        issues = []
        
        # Check required authentication
        if not cls.JWT_SECRET and not cls.CLOUD_AUTH_TOKEN:
            issues.append("No authentication configured (neither JWT_SECRET nor CLOUD_CHAT_UI_AUTH_TOKEN)")
        
        # Check cloud configuration
        if cls.USE_CLOUD_LLM and not cls.CLOUD_AUTH_TOKEN:
            issues.append("Cloud LLM enabled but no CLOUD_CHAT_UI_AUTH_TOKEN provided")
        
        # Check health monitoring configuration
        if cls.HEALTH_CHECK_INTERVAL < 10:
            issues.append("Health check interval too low (minimum 10 seconds)")
        
        if cls.HEALTH_CHECK_TIMEOUT < 1:
            issues.append("Health check timeout too low (minimum 1 second)")
        
        return issues
    
    @classmethod
    def print_config(cls):
        """Print current configuration for debugging"""
        print("=== Agent Configuration ===")
        print(f"Auto Discovery: {cls.AUTO_DISCOVERY_ENABLED}")
        print(f"Health Monitoring: {cls.HEALTH_CHECK_ENABLED}")
        print(f"Health Check Interval: {cls.HEALTH_CHECK_INTERVAL}s")
        print(f"Max Failures: {cls.MAX_FAILURES}")
        print(f"Fallback to Local: {cls.FALLBACK_TO_LOCAL}")
        print(f"Use Cloud LLM: {cls.USE_CLOUD_LLM}")
        print(f"Backend URL: {cls.BACKEND_URL}")
        print(f"Priority Models: {cls.get_priority_models()}")
        print(f"Debug Mode: {cls.DEBUG_MODE}")
        print("==========================") 