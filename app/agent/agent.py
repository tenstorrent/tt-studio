# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from custom_llm import CustomLLM
from utils import poll_requests, setup_executer
from code_tool import CodeInterpreterFunctionTool
from langchain.memory import ConversationBufferMemory
from langchain_community.tools.tavily_search import TavilySearchResults
from llm_discovery import LLMDiscoveryService, LLMInfo
from health_monitor import LLMHealthMonitor, HealthStatus
from config import AgentConfig
import os 
import jwt
import json
import asyncio
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from typing import Optional, Dict, Any

app = FastAPI()

# Authentication setup
json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
jwt_secret = os.getenv("JWT_SECRET")
cloud_auth_token = os.getenv("CLOUD_CHAT_UI_AUTH_TOKEN")

# Use cloud auth token if available, otherwise fall back to JWT
if cloud_auth_token:
    encoded_jwt = cloud_auth_token
    print(f"Using cloud auth token for authentication")
elif jwt_secret:
    encoded_jwt = jwt.encode(json_payload, jwt_secret, algorithm="HS256")
    print(f"Using JWT authentication")
else:
    encoded_jwt = None
    print("Warning: No authentication token available (neither CLOUD_CHAT_UI_AUTH_TOKEN nor JWT_SECRET)")

class RequestPayload(BaseModel):
    message: str
    thread_id: str

# Global variables for LLM management
discovery_service = LLMDiscoveryService()
current_llm: Optional[CustomLLM] = None
health_monitor: Optional[LLMHealthMonitor] = None
agent_executer = None

# Validate configuration
config_issues = AgentConfig.validate_config()
if config_issues:
    print("=== CONFIGURATION ISSUES ===")
    for issue in config_issues:
        print(f"WARNING: {issue}")
    print("============================")

# Print configuration
AgentConfig.print_config()

def setup_cloud_llm() -> CustomLLM:
    """Setup cloud LLM endpoint"""
    cloud_endpoint = AgentConfig.CLOUD_ENDPOINT
    cloud_auth_token = AgentConfig.CLOUD_AUTH_TOKEN
    
    print(f"Cloud endpoint: {cloud_endpoint}")
    print(f"Cloud auth token length: {len(cloud_auth_token) if cloud_auth_token else 0}")
    
    if not cloud_auth_token:
        print("ERROR: No cloud chat UI auth token provided. Agent will not work correctly.")
        print("Please set CLOUD_CHAT_UI_AUTH_TOKEN environment variable with a valid API key.")
        raise Exception("No cloud auth token available")
    
    cloud_model_name = AgentConfig.CLOUD_MODEL_NAME
    llm = CustomLLM(
        server_url=cloud_endpoint, 
        encoded_jwt=cloud_auth_token,
        streaming=True,
        is_cloud=True,
        cloud_model_name=cloud_model_name
    )
    print(f"Agent configured to use cloud LLM endpoint: {cloud_endpoint} with model: {cloud_model_name}")
    return llm

def setup_local_container_llm(container_name: str) -> CustomLLM:
    """Setup LLM using environment-specified container"""
    llm = CustomLLM(
        server_url=f"http://{container_name}:7000", 
        encoded_jwt=encoded_jwt, 
        streaming=True,
        is_cloud=False
    )
    print(f"Agent configured to use local LLM container: {container_name}")
    return llm

def setup_discovered_llm(llm_info: LLMInfo) -> CustomLLM:
    """Setup LLM using discovered container info with dynamic model type handling"""
    print(f"[DYNAMIC_LLM_SETUP] Setting up discovered LLM:")
    print(f"  - Container: {llm_info.container_name}")
    print(f"  - Model: {llm_info.model_name}")
    print(f"  - Model Type: {llm_info.model_type}")
    print(f"  - Internal URL: {llm_info.internal_url}")
    print(f"  - Health URL: {llm_info.health_url}")
    print(f"  - Status: {llm_info.status}")
    
    # Determine the correct endpoint based on model type
    server_url = f"http://{llm_info.internal_url}"
    
    # For different model types, we might need different endpoints
    # Most vLLM models use /v1/chat/completions, but some might use different endpoints
    if llm_info.model_type == 'chat':
        # Standard chat completion endpoint
        if not llm_info.internal_url.endswith('/v1/chat/completions'):
            server_url = f"http://{llm_info.internal_url}/v1/chat/completions"
    elif llm_info.model_type == 'completion':
        # For completion models, use /v1/completions
        server_url = f"http://{llm_info.internal_url.replace('/v1/chat/completions', '/v1/completions')}"
    else:
        # Default to chat completions for unknown types
        print(f"[WARNING] Unknown model type '{llm_info.model_type}', using chat completions endpoint")
    
    print(f"[DYNAMIC_LLM_SETUP] Final server URL: {server_url}")
    
    llm_info_dict = {
        'deploy_id': llm_info.deploy_id,
        'container_name': llm_info.container_name,
        'internal_url': llm_info.internal_url,
        'health_url': llm_info.health_url,
        'model_name': llm_info.model_name,
        'model_type': llm_info.model_type,
        'status': llm_info.status.value,
        'hf_model_id': llm_info.hf_model_id if hasattr(llm_info, 'hf_model_id') else None
    }
    print(f"[DEBUG] Setting up LLM with llm_info: {llm_info_dict}")
    
    llm = CustomLLM(
        server_url=server_url,
        encoded_jwt=encoded_jwt,
        streaming=True,
        is_cloud=False,
        is_discovered=True,
        llm_info=llm_info_dict
    )
    
    print(f"[DYNAMIC_LLM_SETUP] Agent configured to use discovered LLM: {llm_info.model_name} ({llm_info.container_name})")
    print(f"[DYNAMIC_LLM_SETUP] LLM server URL: {llm.server_url}")
    
    # Test the connection with model-specific parameters
    if test_llm_connection(llm, llm_info.model_name, llm_info.model_type):
        print(f"[SUCCESS] LLM connection test passed for {llm_info.model_name}")
        return llm
    else:
        print(f"[WARNING] LLM connection test failed for {llm_info.model_name}, but continuing...")
        return llm

def check_local_host_llm() -> bool:
    """Check if there's a local host LLM available"""
    try:
        local_host = AgentConfig.LOCAL_HOST
        local_port = AgentConfig.LOCAL_PORT
        health_url = f"http://{local_host}:{local_port}/health"
        response = requests.get(health_url, timeout=AgentConfig.HEALTH_CHECK_TIMEOUT)
        return response.status_code == 200
    except:
        return False

def setup_local_host_llm() -> CustomLLM:
    """Setup LLM using local host endpoint"""
    local_host = AgentConfig.LOCAL_HOST
    local_port = AgentConfig.LOCAL_PORT
    local_model = AgentConfig.LOCAL_MODEL_NAME
    
    llm = CustomLLM(
        server_url=f"http://{local_host}:{local_port}/v1/chat/completions",
        encoded_jwt=encoded_jwt,
        streaming=True,
        is_cloud=False
    )
    print(f"Agent configured to use local host LLM: {local_host}:{local_port} ({local_model})")
    return llm

def test_llm_connection(llm: CustomLLM, model_name: str, model_type: str) -> bool:
    """Test if the agent can connect to the LLM"""
    try:
        print(f"[DEBUG] Testing LLM connection to: {llm.server_url}")
        
        # Test basic connectivity first
        if hasattr(llm, 'llm_info') and llm.llm_info and 'health_url' in llm.llm_info:
            health_url = f"http://{llm.llm_info['health_url']}"
            print(f"[DEBUG] Testing health endpoint: {health_url}")
            response = requests.get(health_url, timeout=5)
            if response.status_code == 200:
                print(f"[DEBUG] Health check passed")
            else:
                print(f"[WARNING] Health check failed: {response.status_code}")
        
        # Test the actual chat endpoint with a simple request
        # Use hf_model_id if available, otherwise use model_name
        test_model = llm.llm_info.get('hf_model_id') if llm.llm_info else model_name
        test_payload = {
            "model": test_model,
            "messages": [{"role": "user", "content": "Hello"}],
            "max_tokens": 1,
            "stream": False
        }
        
        headers = {"Authorization": f"Bearer {llm.encoded_jwt}"}
        print(f"[DEBUG] Testing chat endpoint with simple request")
        
        response = requests.post(llm.server_url, json=test_payload, headers=headers, timeout=10)
        print(f"[DEBUG] Test request status: {response.status_code}")
        
        if response.status_code in [200, 400, 422]:  # 400/422 are expected for invalid model names
            print(f"[DEBUG] LLM connection test successful")
            return True
        else:
            print(f"[ERROR] LLM connection test failed: {response.status_code}")
            print(f"[ERROR] Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"[ERROR] LLM connection test exception: {str(e)}")
        return False

def initialize_llm() -> CustomLLM:
    """Initialize LLM with fallback strategy"""
    print("=== Initializing LLM with Enhanced Discovery ===")
    
    # Priority 1: Cloud LLM (if configured)
    if AgentConfig.USE_CLOUD_LLM and AgentConfig.CLOUD_AUTH_TOKEN:
        print("Priority 1: Using cloud LLM")
        return setup_cloud_llm()
    
    # Priority 2: Environment-specified local container
    if AgentConfig.LLM_CONTAINER_NAME:
        print("Priority 2: Using environment-specified local container")
        return setup_local_container_llm(AgentConfig.LLM_CONTAINER_NAME)
    
    # Priority 3: Auto-discovered local containers
    if AgentConfig.AUTO_DISCOVERY_ENABLED:
        print("Priority 3: Attempting auto-discovery of local LLMs")
        try:
            local_llms = discovery_service.discover_local_llms()
            if local_llms:
                selected_llm = discovery_service.select_best_llm(local_llms)
                if selected_llm:
                    print(f"Auto-discovered local LLM: {selected_llm.model_name}")
                    return setup_discovered_llm(selected_llm)
        except Exception as e:
            print(f"Auto-discovery failed: {e}")
    
    # Priority 4: Local host LLM (fallback)
    if AgentConfig.FALLBACK_TO_LOCAL and check_local_host_llm():
        print("Priority 4: Using local host LLM")
        return setup_local_host_llm()
    
    # No LLM available
    print("ERROR: No LLM endpoint available")
    raise Exception("No LLM endpoint available")

def on_llm_change(new_llm: CustomLLM):
    """Callback when LLM changes during health monitoring"""
    global current_llm, agent_executer
    print("LLM changed, updating agent executor...")
    current_llm = new_llm
    
    # Recreate agent executor with new LLM
    memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)
    tools = [TavilySearchResults(max_results=2, include_answer=True, include_raw_content=True)]
    agent_executer = setup_executer(new_llm, memory, tools)
    print("Agent executor updated with new LLM")

def start_health_monitoring():
    """Start health monitoring for the current LLM"""
    global health_monitor
    if health_monitor:
        health_monitor.stop_monitoring()
    
    if current_llm and not current_llm.is_cloud and AgentConfig.HEALTH_CHECK_ENABLED:
        health_monitor = LLMHealthMonitor(current_llm, discovery_service)
        health_monitor.set_llm_change_callback(on_llm_change)
        
        # Start monitoring in background
        loop = asyncio.get_event_loop()
        loop.create_task(health_monitor.start_monitoring())
        print("Health monitoring started")
    else:
        print("Health monitoring disabled or not applicable")

# Initialize LLM and agent
try:
    current_llm = initialize_llm()
    
    # Setup agent executor
    memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)
    os.environ["TAVILY_API_KEY"] = os.getenv("TAVILY_API_KEY")
    
    search = TavilySearchResults(
        max_results=2,
        include_answer=True,
        include_raw_content=True)
    tools = [search]
    agent_executer = setup_executer(current_llm, memory, tools)
    
    # Start health monitoring for local LLMs
    start_health_monitoring()
    
    print("=== Agent Initialization Complete ===")
    
except Exception as e:
    print(f"Failed to initialize agent: {e}")
    raise

@app.post("/poll_requests")
async def handle_requests(payload: RequestPayload):
    print('[TRACE_FLOW_STEP_4_AGENT_ENTRY] handle_requests called', {'thread_id': payload.thread_id, 'message': payload.message})
    config = {"configurable": {"thread_id": payload.thread_id}}
    try:
        # use await to prevent handle_requests from blocking, allow other tasks to execute
        return StreamingResponse(poll_requests(agent_executer, config, tools, memory, payload.message), media_type="text/plain")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def read_root():
    """Health check endpoint with enhanced status information"""
    global current_llm, health_monitor
    
    # Get LLM status
    llm_mode = "cloud" if current_llm and current_llm.is_cloud else "local"
    llm_info = "N/A"
    
    if current_llm:
        if current_llm.is_cloud:
            llm_info = f"Cloud: {current_llm.cloud_model_name}"
        elif current_llm.is_discovered and current_llm.llm_info:
            llm_info = f"Discovered: {current_llm.llm_info.get('model_name', 'Unknown')}"
        else:
            llm_info = f"Container: {current_llm.server_url}"
    
    # Get health monitoring status
    health_status = "N/A"
    if health_monitor:
        health_status = health_monitor.get_health_status()
    
    # Get discovery summary
    discovery_summary = discovery_service.get_llm_status_summary()
    
    return {
        "message": "Agent server is running",
        "llm_mode": llm_mode,
        "llm_info": llm_info,
        "health_monitoring": health_status,
        "discovery_summary": discovery_summary
    }

@app.get("/status")
def get_status():
    """Get dynamic status of the agent and all available LLMs"""
    global current_llm, discovery_service
    
    try:
        # Get current LLM info
        current_llm_info = None
        if current_llm:
            current_llm_info = {
                "server_url": current_llm.server_url,
                "is_cloud": current_llm.is_cloud,
                "is_discovered": current_llm.is_discovered,
                "llm_info": current_llm.llm_info if hasattr(current_llm, 'llm_info') else None
            }
        
        # Discover all available LLMs
        all_llms = discovery_service.discover_local_llms()
        available_models = []
        
        for llm in all_llms:
            model_info = {
                "deploy_id": llm.deploy_id,
                "model_name": llm.model_name,
                "model_type": llm.model_type,
                "container_name": llm.container_name,
                "internal_url": llm.internal_url,
                "health_url": llm.health_url,
                "status": llm.status.value,
                "is_current": (current_llm and 
                              hasattr(current_llm, 'llm_info') and 
                              current_llm.llm_info and 
                              current_llm.llm_info.get('deploy_id') == llm.deploy_id)
            }
            available_models.append(model_info)
        
        # Get discovery service status
        discovery_status = discovery_service.get_llm_status_summary()
        
        return {
            "status": "running",
            "current_llm": current_llm_info,
            "available_models": available_models,
            "discovery_summary": discovery_status,
            "configuration": {
                "auto_discovery_enabled": AgentConfig.AUTO_DISCOVERY_ENABLED,
                "health_check_enabled": AgentConfig.HEALTH_CHECK_ENABLED,
                "fallback_to_local": AgentConfig.FALLBACK_TO_LOCAL,
                "use_cloud_llm": AgentConfig.USE_CLOUD_LLM,
                "priority_models": AgentConfig.get_priority_models()
            }
        }
        
    except Exception as e:
        print(f"[STATUS] Error getting status: {e}")
        return {
            "status": "error",
            "error": str(e),
            "current_llm": current_llm_info if 'current_llm_info' in locals() else None
        }

@app.post("/refresh")
def refresh_llm():
    """Dynamically refresh LLM selection and configuration"""
    global current_llm, agent_executer, discovery_service
    
    print("[DYNAMIC_REFRESH] Starting LLM refresh process...")
    
    try:
        # Clear discovery cache to force fresh discovery
        discovery_service.clear_cache()
        print("[DYNAMIC_REFRESH] Cleared discovery cache")
        
        # Discover available LLMs
        local_llms = discovery_service.discover_local_llms()
        print(f"[DYNAMIC_REFRESH] Discovered {len(local_llms)} local LLMs")
        
        if not local_llms:
            print("[DYNAMIC_REFRESH] No local LLMs discovered, checking fallback options...")
            
            # Try fallback options
            if AgentConfig.FALLBACK_TO_LOCAL and check_local_host_llm():
                print("[DYNAMIC_REFRESH] Using local host LLM as fallback")
                new_llm = setup_local_host_llm()
            elif AgentConfig.FALLBACK_TO_CLOUD and AgentConfig.CLOUD_AUTH_TOKEN:
                print("[DYNAMIC_REFRESH] Using cloud LLM as fallback")
                new_llm = setup_cloud_llm()
            else:
                return {"status": "error", "message": "No LLMs available and no fallback configured"}
        else:
            # Select best LLM from discovered ones
            selected_llm = discovery_service.select_best_llm(local_llms)
            if selected_llm:
                print(f"[DYNAMIC_REFRESH] Selected LLM: {selected_llm.model_name}")
                new_llm = setup_discovered_llm(selected_llm)
            else:
                return {"status": "error", "message": "No suitable LLM found among discovered models"}
        
        # Update current LLM and agent executor
        old_llm_name = current_llm.llm_info.get('model_name', 'Unknown') if current_llm and hasattr(current_llm, 'llm_info') else 'Unknown'
        current_llm = new_llm
        new_llm_name = current_llm.llm_info.get('model_name', 'Unknown') if hasattr(current_llm, 'llm_info') else 'Unknown'
        
        # Recreate agent executor with new LLM
        memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)
        tools = [TavilySearchResults(max_results=2, include_answer=True, include_raw_content=True)]
        agent_executer = setup_executer(current_llm, memory, tools)
        
        # Restart health monitoring
        start_health_monitoring()
        
        print(f"[DYNAMIC_REFRESH] Successfully switched from {old_llm_name} to {new_llm_name}")
        
        return {
            "status": "success",
            "message": f"LLM refreshed successfully",
            "old_model": old_llm_name,
            "new_model": new_llm_name,
            "available_models": [
                {
                    "model_name": llm.model_name,
                    "model_type": llm.model_type,
                    "status": llm.status.value,
                    "container_name": llm.container_name
                }
                for llm in local_llms
            ]
        }
        
    except Exception as e:
        print(f"[DYNAMIC_REFRESH] Error during refresh: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/select_model")
def select_model(deploy_id: str):
    """Dynamically select a specific model by deploy_id"""
    global current_llm, agent_executer, discovery_service
    
    print(f"[DYNAMIC_SELECTION] Attempting to select model with deploy_id: {deploy_id}")
    
    try:
        # Discover all available LLMs
        local_llms = discovery_service.discover_local_llms()
        
        # Find the specific model
        target_llm = None
        for llm in local_llms:
            if llm.deploy_id == deploy_id:
                target_llm = llm
                break
        
        if not target_llm:
            return {
                "status": "error", 
                "message": f"Model with deploy_id {deploy_id} not found",
                "available_models": [
                    {
                        "deploy_id": llm.deploy_id,
                        "model_name": llm.model_name,
                        "status": llm.status.value
                    }
                    for llm in local_llms
                ]
            }
        
        # Check if the model is healthy enough
        if target_llm.status == HealthStatus.UNHEALTHY:
            return {
                "status": "error",
                "message": f"Model {target_llm.model_name} is unhealthy (status: {target_llm.status.value})"
            }
        
        # Setup the selected LLM
        new_llm = setup_discovered_llm(target_llm)
        
        # Update current LLM and agent executor
        old_llm_name = current_llm.llm_info.get('model_name', 'Unknown') if current_llm and hasattr(current_llm, 'llm_info') else 'Unknown'
        current_llm = new_llm
        
        # Recreate agent executor with new LLM
        memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)
        tools = [TavilySearchResults(max_results=2, include_answer=True, include_raw_content=True)]
        agent_executer = setup_executer(current_llm, memory, tools)
        
        # Restart health monitoring
        start_health_monitoring()
        
        print(f"[DYNAMIC_SELECTION] Successfully switched to {target_llm.model_name}")
        
        return {
            "status": "success",
            "message": f"Successfully switched to {target_llm.model_name}",
            "old_model": old_llm_name,
            "new_model": target_llm.model_name,
            "model_info": {
                "deploy_id": target_llm.deploy_id,
                "model_name": target_llm.model_name,
                "model_type": target_llm.model_type,
                "status": target_llm.status.value,
                "container_name": target_llm.container_name
            }
        }
        
    except Exception as e:
        print(f"[DYNAMIC_SELECTION] Error selecting model: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/test_llm")
def test_llm():
    """Test LLM connectivity"""
    global current_llm
    
    if not current_llm:
        return {"status": "error", "message": "No LLM configured"}
    
    try:
        result = test_llm_connection(current_llm, current_llm.llm_info.get('model_name'), current_llm.llm_info.get('model_type'))
        return {
            "status": "success" if result else "error",
            "llm_url": current_llm.server_url,
            "llm_info": current_llm.llm_info,
            "connection_test": result
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/refresh_config")
def refresh_config():
    """Refresh agent configuration from environment variables"""
    try:
        print("[CONFIG_REFRESH_ENDPOINT] Refreshing configuration...")
        
        # Refresh configuration
        AgentConfig.refresh_config()
        
        # Optionally trigger LLM refresh if configuration changed
        # This could be useful if priority models changed
        should_refresh_llm = os.getenv("AGENT_REFRESH_LLM_ON_CONFIG_CHANGE", "false").lower() == "true"
        
        if should_refresh_llm:
            print("[CONFIG_REFRESH_ENDPOINT] Configuration changed, triggering LLM refresh...")
            refresh_result = refresh_llm()
            return {
                "status": "success",
                "message": "Configuration refreshed and LLM updated",
                "llm_refresh": refresh_result
            }
        
        return {
            "status": "success",
            "message": "Configuration refreshed successfully",
            "current_config": {
                "priority_models": AgentConfig.get_priority_models(),
                "model_type_priority": AgentConfig.get_model_type_priority(),
                "auto_discovery_enabled": AgentConfig.AUTO_DISCOVERY_ENABLED,
                "health_check_enabled": AgentConfig.HEALTH_CHECK_ENABLED,
                "fallback_to_local": AgentConfig.FALLBACK_TO_LOCAL,
                "use_cloud_llm": AgentConfig.USE_CLOUD_LLM
            }
        }
        
    except Exception as e:
        print(f"[CONFIG_REFRESH_ENDPOINT] Error refreshing configuration: {e}")
        return {"status": "error", "message": str(e)}
