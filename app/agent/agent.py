# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from custom_llm import CustomLLM
from utils import poll_requests, setup_executer
from code_tool import CodeInterpreterFunctionTool
from langchain.memory import ConversationBufferMemory
from langchain_community.tools.tavily_search import TavilySearchResults
import os 
import jwt
import json
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import StreamingResponse



app = FastAPI()
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


# Debug environment variables
print("=== AGENT ENVIRONMENT DEBUG ===")
print(f"USE_CLOUD_LLM: {os.getenv('USE_CLOUD_LLM')}")
print(f"LLM_CONTAINER_NAME: {os.getenv('LLM_CONTAINER_NAME')}")
print(f"CLOUD_CHAT_UI_URL: {os.getenv('CLOUD_CHAT_UI_URL')}")
print(f"CLOUD_CHAT_UI_AUTH_TOKEN: {'SET' if os.getenv('CLOUD_CHAT_UI_AUTH_TOKEN') else 'NOT SET'}")
print(f"JWT_SECRET: {'SET' if os.getenv('JWT_SECRET') else 'NOT SET'}")
print(f"TAVILY_API_KEY: {'SET' if os.getenv('TAVILY_API_KEY') else 'NOT SET'}")
print("==============================")

# Determine if we should use cloud LLM or local LLM container
use_cloud_llm = os.getenv("USE_CLOUD_LLM", "false").lower() == "true"
llm_container_name = os.getenv("LLM_CONTAINER_NAME")

if use_cloud_llm or not llm_container_name:
    # Use cloud LLM endpoint - use existing cloud chat UI variables
    cloud_endpoint = os.getenv("CLOUD_CHAT_UI_URL", "https://api.openai.com/v1/chat/completions")
    cloud_auth_token = os.getenv("CLOUD_CHAT_UI_AUTH_TOKEN", "")
    
    print(f"Cloud endpoint: {cloud_endpoint}")
    print(f"Cloud auth token length: {len(cloud_auth_token) if cloud_auth_token else 0}")
    
    if not cloud_auth_token:
        print("ERROR: No cloud chat UI auth token provided. Agent will not work correctly.")
        print("Please set CLOUD_CHAT_UI_AUTH_TOKEN environment variable with a valid API key.")
    
    # Create a custom LLM instance for cloud endpoint
    cloud_model_name = os.getenv("CLOUD_MODEL_NAME", "meta-llama/Llama-3.3-70B-Instruct")
    llm = CustomLLM(
        server_url=cloud_endpoint, 
        encoded_jwt=cloud_auth_token,  # Use cloud auth token instead of JWT
        streaming=True,
        is_cloud=True,
        cloud_model_name=cloud_model_name
    )
    print(f"Agent configured to use cloud LLM endpoint: {cloud_endpoint} with model: {cloud_model_name}")
else:
    # Use local LLM container
    llm = CustomLLM(
        server_url=f"http://{llm_container_name}:7000/v1/chat/completions", 
        encoded_jwt=encoded_jwt, 
        streaming=True,
        is_cloud=False
    )
    print(f"Agent configured to use local LLM container: {llm_container_name}")

memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)
os.environ["TAVILY_API_KEY"] = os.getenv("TAVILY_API_KEY")

search = TavilySearchResults(
    max_results=2,
    include_answer=True,
    include_raw_content=True)
tools = [search]
agent_executer = setup_executer(llm, memory, tools)

@app.post("/poll_requests")
async def handle_requests(payload: RequestPayload):
    config = {"configurable": {"thread_id": payload.thread_id}}
    try:
        # use await to prevent handle_requests from blocking, allow other tasks to execute
        return StreamingResponse(poll_requests(agent_executer, config, tools, memory, payload.message), media_type="text/plain")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# health check
@app.get("/")
def read_root():
    return {
        "message": "Agent server is running",
        "llm_mode": "cloud" if use_cloud_llm or not llm_container_name else "local",
        "llm_container": llm_container_name if llm_container_name else "N/A"
    }
