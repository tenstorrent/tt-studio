# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from custom_llm import CustomLLM
from utils import poll_requests, setup_executer
from code_tool import CodeInterpreterFunctionTool
from langchain.memory import ConversationBufferMemory
from langchain_community.tools.tavily_search import TavilySearchResults
from llm_discovery import LLMDiscoveryService, LLMInfo
from health_monitor import LLMHealthMonitor
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
        server_url=f"http://{container_name}:7000/v1/chat/completions", 
        encoded_jwt=encoded_jwt, 
        streaming=True,
        is_cloud=False
    )
    print(f"Agent configured to use local LLM container: {container_name}")
    return llm

def setup_discovered_llm(llm_info: LLMInfo) -> CustomLLM:
    """Setup LLM using discovered container info"""
    llm = CustomLLM(
        server_url=f"http://{llm_info.internal_url}/v1/chat/completions",
        encoded_jwt=encoded_jwt,
        streaming=True,
        is_cloud=False,
        is_discovered=True,
        llm_info={
            'deploy_id': llm_info.deploy_id,
            'container_name': llm_info.container_name,
            'internal_url': llm_info.internal_url,
            'health_url': llm_info.health_url,
            'model_name': llm_info.model_name
        }
    )
    print(f"Agent configured to use discovered LLM: {llm_info.model_name} ({llm_info.container_name})")
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
    """Detailed status endpoint"""
    global current_llm, health_monitor
    
    return {
        "agent_status": "running",
        "current_llm": {
            "mode": "cloud" if current_llm and current_llm.is_cloud else "local",
            "server_url": current_llm.server_url if current_llm else None,
            "is_discovered": current_llm.is_discovered if current_llm else False,
            "llm_info": current_llm.llm_info if current_llm else None
        },
        "health_monitor": health_monitor.get_health_status() if health_monitor else None,
        "discovery_service": discovery_service.get_llm_status_summary(),
        "environment": {
            "use_cloud_llm": os.getenv("USE_CLOUD_LLM", "false"),
            "llm_container_name": os.getenv("LLM_CONTAINER_NAME"),
            "auto_discovery": os.getenv("AGENT_AUTO_DISCOVERY", "true"),
            "fallback_to_local": os.getenv("AGENT_FALLBACK_TO_LOCAL", "true")
        }
    }

@app.post("/refresh")
def refresh_llm():
    """Manually trigger LLM refresh"""
    global current_llm, agent_executer
    
    try:
        print("Manual LLM refresh triggered")
        discovery_service.clear_cache()
        new_llm = initialize_llm()
        
        if new_llm != current_llm:
            current_llm = new_llm
            on_llm_change(new_llm)
            start_health_monitoring()
            return {"status": "success", "message": "LLM refreshed successfully"}
        else:
            return {"status": "success", "message": "No change in LLM"}
            
    except Exception as e:
        return {"status": "error", "message": f"Failed to refresh LLM: {str(e)}"}
