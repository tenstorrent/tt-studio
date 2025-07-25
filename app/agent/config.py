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
    # Priority models can be set via environment variable AGENT_PRIORITY_MODELS
    # Format: "model1,model2,model3" (comma-separated)
    # Default priority models (will be used if no environment variable is set)
    DEFAULT_PRIORITY_MODELS: list = [
        'meta-llama/Llama-3.2-1B-Instruct',
        'meta-llama/Llama-3.2-3B-Instruct',
        'meta-llama/Llama-3.2-8B-Instruct',
        'meta-llama/Llama-3.3-70B-Instruct',
        'meta-llama/Llama-3.1-70B-Instruct',
        'microsoft/DialoGPT-medium',
        'gpt2',
        'bert-base-uncased'
    ]
    
    # Model Type Preferences (for selection when multiple models are available)
    # Order: chat models first, then completion models, then others
    MODEL_TYPE_PRIORITY: list = ['chat', 'completion', 'embedding', 'other']
    
    # Dynamic Configuration
    DYNAMIC_CONFIG_ENABLED: bool = os.getenv("AGENT_DYNAMIC_CONFIG", "true").lower() == "true"
    CONFIG_REFRESH_INTERVAL: int = int(os.getenv("AGENT_CONFIG_REFRESH_INTERVAL", "300"))  # 5 minutes
    
    # LLM Polling Configuration
    LLM_POLLING_ENABLED: bool = os.getenv("AGENT_LLM_POLLING_ENABLED", "true").lower() == "true"
    LLM_POLLING_INTERVAL: int = int(os.getenv("AGENT_LLM_POLLING_INTERVAL", "180"))  # 3 minutes
    LLM_POLLING_MAX_ATTEMPTS: int = int(os.getenv("AGENT_LLM_POLLING_MAX_ATTEMPTS", "0"))  # 0 means infinite
    
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
        return cls.DEFAULT_PRIORITY_MODELS
    
    @classmethod
    def get_model_type_priority(cls) -> list:
        """Get model type priority order"""
        env_priority = os.getenv("AGENT_MODEL_TYPE_PRIORITY")
        if env_priority:
            return [model_type.strip() for model_type in env_priority.split(",")]
        return cls.MODEL_TYPE_PRIORITY
    
    @classmethod
    def refresh_config(cls):
        """Refresh configuration from environment variables"""
        if not cls.DYNAMIC_CONFIG_ENABLED:
            return
        
        print("[CONFIG_REFRESH] Refreshing agent configuration...")
        
        # Refresh priority models
        old_priority = cls.get_priority_models()
        new_priority = cls.get_priority_models()  # This will re-read from env
        
        if old_priority != new_priority:
            print(f"[CONFIG_REFRESH] Priority models updated: {old_priority} -> {new_priority}")
        
        # Refresh other dynamic settings
        cls.AUTO_DISCOVERY_ENABLED = os.getenv("AGENT_AUTO_DISCOVERY", "true").lower() == "true"
        cls.HEALTH_CHECK_ENABLED = os.getenv("AGENT_HEALTH_CHECK_ENABLED", "true").lower() == "true"
        cls.FALLBACK_TO_LOCAL = os.getenv("AGENT_FALLBACK_TO_LOCAL", "true").lower() == "true"
        cls.USE_CLOUD_LLM = os.getenv("USE_CLOUD_LLM", "false").lower() == "true"
        
        print("[CONFIG_REFRESH] Configuration refresh complete")
    
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
        print(f"LLM Polling Enabled: {cls.LLM_POLLING_ENABLED}")
        print(f"LLM Polling Interval: {cls.LLM_POLLING_INTERVAL}s")
        print(f"LLM Polling Max Attempts: {cls.LLM_POLLING_MAX_ATTEMPTS}")
        print(f"Backend URL: {cls.BACKEND_URL}")
        print(f"Priority Models: {cls.get_priority_models()}")
        print(f"Debug Mode: {cls.DEBUG_MODE}")
        print("==========================") 