from custom_llm import CustomLLM
from utils import poll_requests, setup_executer
from code_tool import CodeInterpreterFunctionTool
from langchain.memory import ConversationBufferMemory
from langchain_community.tools.tavily_search import TavilySearchResults
import asyncio
import os 
import jwt
import json
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import StreamingResponse


app = FastAPI()
json_payload = json.loads('{"team_id": "tenstorrent", "token_id":"debug-test"}')
jwt_secret = os.getenv("JWT_SECRET")
encoded_jwt = jwt.encode(json_payload, jwt_secret, algorithm="HS256")

class RequestPayload(BaseModel):
    message: str
    thread_id: str


llm_container_name = os.getenv("LLM_CONTAINER_NAME")
llm = CustomLLM(server_url=f"http://{llm_container_name}:7000/v1/chat/completions", encoded_jwt=encoded_jwt)
# llm = CustomLLM(server_url=f"http://model:7000/v1/chat/completions")
memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)
os.environ["TAVILY_API_KEY"] = os.getenv("TAVILY_API_KEY")

search = TavilySearchResults(
    max_results=2,
    include_answer=True,
    include_raw_content=True)

# TODO: enable code agent
# os.environ["E2B_API_KEY"] = os.getenv("E2B_API_KEY")
# code_interpreter = CodeInterpreterFunctionTool()
# code_interpreter_tool = code_interpreter.to_langchain_tool()
tools = [search]
agent_executer = setup_executer(llm, memory, tools)
config = {"configurable": {"thread_id": "abc-123"}}
# asyncio.run(poll_requests(agent_executer, config, tools, memory)) # TODO: enable to run without server 

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
    return {"message": "Server is running"}
