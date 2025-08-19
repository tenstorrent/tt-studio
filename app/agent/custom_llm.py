# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from pydantic import BaseModel
from typing import (
    List,
    Sequence,
    Any,
    Optional,
    Iterator,
    Union,
    Dict,
    Type,
    Callable,
    Literal,
    AsyncGenerator
)

from langchain_core.language_models import BaseChatModel, LanguageModelInput
from langchain_core.messages import AIMessageChunk, BaseMessage
from langchain_core.callbacks.manager import CallbackManagerForLLMRun
from langchain_core.outputs import ChatGenerationChunk, ChatResult
from langchain_core.tools import BaseTool
from langchain_core.runnables import Runnable
from langchain_core.utils.function_calling import convert_to_openai_tool
from langchain.callbacks.streaming_stdout_final_only import FinalStreamingStdOutCallbackHandler
import requests
import json 
import os 


class CustomLLM(BaseChatModel):
    server_url: str
    encoded_jwt: str
    is_cloud: bool = False
    is_discovered: bool = False
    cloud_model_name: Optional[str] = None
    llm_info: Optional[Dict] = None

    class Config:
        arbitrary_types_allowed = True

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Set default cloud model name if not provided
        if self.is_cloud and not self.cloud_model_name:
            self.cloud_model_name = os.getenv("CLOUD_MODEL_NAME", "meta-llama/Llama-3.3-70B-Instruct")

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Override the _generate method to implement the chat model logic.

        This can be a call to an API, a call to a local model, or any other
        implementation that generates a response to the input prompt.

        Args:
            messages: the prompt composed of a list of messages.
            stop: a list of strings on which the model should stop generating.
                  If generation stops due to a stop token, the stop token itself
                  SHOULD BE INCLUDED as part of the output. This is not enforced
                  across models right now, but it's a good practice to follow since
                  it makes it much easier to parse the output of the model
                  downstream and understand why generation stopped.
            run_manager: A run manager with callbacks for the LLM.
        """
        pass

    async def _astream(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = FinalStreamingStdOutCallbackHandler(),
        **kwargs: Any,
    ) -> AsyncGenerator[ChatGenerationChunk, None]:
        print('[TRACE_FLOW_STEP_5_AGENT_TO_LLM] _astream called', {'server_url': self.server_url, 'is_cloud': self.is_cloud, 'is_discovered': self.is_discovered, 'llm_info': self.llm_info})
        
        # Convert LangChain messages to standard role/content format
        message_payload = []
        for msg in messages:
            if msg.type == "system":
                role = "system"
            elif msg.type in ("human", "chat"):
                role = "user"
            elif msg.type == "ai":
                role = "assistant"
            elif msg.type == "function" or msg.type == "tool":
                role = "assistant"  # Treat function calls as assistant responses
            else:
                role = "user"  # Fallback
            message_payload.append({"role": role, "content": str(msg.content)})
        
        # Check if tools are available in kwargs
        tools = kwargs.get("tools", [])
        if tools:
            print(f"[DEBUG] Tools available: {[tool.get('function', {}).get('name', 'unknown') for tool in tools]}")
        
        if self.is_cloud:
            # Handle cloud LLM endpoint (e.g., OpenAI API format)
            headers = {"Authorization": f"Bearer {self.encoded_jwt}"}
            
            json_data = {
                "model": self.cloud_model_name,  # Use configurable model name
                "messages": message_payload,
                "temperature": 0.7,
                "max_tokens": 512,
                "stream": True,
            }
            
            # Add tools if available
            if tools:
                json_data["tools"] = tools
                json_data["tool_choice"] = "auto"
            
        else:
            # Handle local or discovered LLM containers
            headers = {"Authorization": f"Bearer {self.encoded_jwt}"}
            
            # Prioritize hf_model_id if available, then model_name, then env var
            if self.llm_info:
                print(f"[DEBUG] llm_info contents: {self.llm_info}")
                hf_model_id = self.llm_info.get('hf_model_id')
                model_name = self.llm_info.get('model_name')
                print(f"[DEBUG] hf_model_id from llm_info: {hf_model_id}")
                print(f"[DEBUG] model_name from llm_info: {model_name}")
                
                # Use hf_model_id if it exists and is not None/empty, otherwise fall back to model_name
                if hf_model_id and hf_model_id.strip():
                    hf_model_path = hf_model_id
                    print(f"[DEBUG] Using hf_model_id: {hf_model_path}")
                else:
                    hf_model_path = model_name
                    print(f"[DEBUG] Falling back to model_name: {hf_model_path}")
                print(f"[DEBUG] Final model path selected: {hf_model_path}")
            else:
                hf_model_path = os.getenv("HF_MODEL_PATH")
                print(f"Using model from environment variable: {hf_model_path}")
            
            json_data = {
                "model": hf_model_path,
                "messages": message_payload,
                "temperature": 1,
                "top_k": 20,
                "top_p": 0.9,
                "max_tokens": 512,
                "stream": True,
                "stop": ["<|eot_id|>"],
                "stream_options": {"include_usage": True, "continuous_usage_stats": True}
            }
            
            # Add tools if available
            if tools:
                json_data["tools"] = tools
                json_data["tool_choice"] = "auto"

        print(f"***Making request to: {self.server_url}")
        redacted_headers = {key: ("<REDACTED>" if key.lower() == "authorization" else value) for key, value in headers.items()}
        print(f"Headers: {redacted_headers}")
        print(f"[LLM REQUEST PAYLOAD] Sending to LLM: {json.dumps(json_data, indent=2)}")
        print(f"[DEBUG] Request URL: {self.server_url}")
        print(f"[DEBUG] Request method: POST")
        print(f"[DEBUG] Request timeout: 30 seconds")
        
        try:
            print(f"[DEBUG] Starting HTTP request to LLM...")
            with requests.post(
                self.server_url, json=json_data, headers=headers, stream=True, timeout=30
            ) as response:
                print(f"[DEBUG] Response received - Status: {response.status_code}")
                print(f"[DEBUG] Response headers: {dict(response.headers)}")
                if response.status_code == 404 and 'does not exist' in response.text:
                    print(f"[ERROR] LLM model not found (404): {response.text.splitlines()[0]}")
                    error_chunk = ChatGenerationChunk(message=AIMessageChunk(content=f"Error: LLM model not found (404). Please check model name."))
                    yield error_chunk
                    return
                if response.status_code != 200:
                    print(f"[ERROR] LLM returned non-200 status: {response.status_code}")
                    print(f"[ERROR] Response text: {response.text.splitlines()[0] if response.text else ''}")
                    error_chunk = ChatGenerationChunk(message=AIMessageChunk(content=f"Error: HTTP {response.status_code}"))
                    yield error_chunk
                    return
                
                print(f"[DEBUG] LLM request successful, starting to stream response...")
                chunk_count = 0
                for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                    chunk_count += 1
                    print(f"[DEBUG] Received chunk {chunk_count}: {repr(chunk)}")
                    
                    if not chunk.strip():
                        print(f"[DEBUG] Skipping empty chunk")
                        continue
                        
                    if self.is_cloud:
                        # Handle cloud response format (standard OpenAI streaming)
                        if chunk.startswith("data: "):
                            chunk_data = chunk[6:].strip()
                            if chunk_data == "[DONE]":
                                print(f"[DEBUG] Received [DONE] marker")
                                new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=""))
                                yield new_chunk
                            else:
                                try:
                                    parsed_chunk = json.loads(chunk_data)
                                    if "choices" in parsed_chunk and len(parsed_chunk["choices"]) > 0:
                                        delta = parsed_chunk["choices"][0].get("delta", {})
                                        
                                        # Handle tool calls
                                        if "tool_calls" in delta:
                                            tool_calls = delta["tool_calls"]
                                            for tool_call in tool_calls:
                                                # Create a tool call message
                                                new_chunk = ChatGenerationChunk(
                                                    message=AIMessageChunk(
                                                        content="",
                                                        tool_calls=[tool_call]
                                                    )
                                                )
                                                yield new_chunk
                                        else:
                                            # Handle regular content
                                            content = delta.get("content", "")
                                            if content:
                                                new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=content))
                                                yield new_chunk
                                except json.JSONDecodeError as e:
                                    print(f"[DEBUG] JSON decode error in cloud response: {e}")
                                    continue
                    else:
                        # Handle local container response format (existing logic)
                        if chunk.startswith("data: "):
                            new_chunk = chunk[len("data: "):]
                            new_chunk = new_chunk.strip()
                            print(f"[DEBUG] Processing local chunk: {repr(new_chunk)}")
                            if new_chunk == "[DONE]":
                                print(f"[DEBUG] Received [DONE] marker from local LLM")
                                # Yield [DONE] to signal that streaming is complete
                                new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=""))
                                yield new_chunk
                            else:
                                try:
                                    parsed_chunk = json.loads(new_chunk)
                                    print(f"[DEBUG] Parsed chunk: {parsed_chunk}")
                                    if "choices" in parsed_chunk and len(parsed_chunk["choices"]) > 0:
                                        choice = parsed_chunk["choices"][0]
                                        if "delta" in choice:
                                            delta = choice["delta"]
                                            
                                            # Handle tool calls
                                            if "tool_calls" in delta:
                                                tool_calls = delta["tool_calls"]
                                                for tool_call in tool_calls:
                                                    print(f"[DEBUG] Tool call: {tool_call}")
                                                    new_chunk = ChatGenerationChunk(
                                                        message=AIMessageChunk(
                                                            content="",
                                                            tool_calls=[tool_call]
                                                        )
                                                    )
                                                    yield new_chunk
                                            elif "content" in delta:
                                                content = delta["content"]
                                                print(f"[DEBUG] Extracted content: {repr(content)}")
                                                new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=content))
                                                yield new_chunk
                                            else:
                                                print(f"[DEBUG] No content or tool_calls in delta: {delta}")
                                        else:
                                            print(f"[DEBUG] No delta in choice: {choice}")
                                    else:
                                        print(f"[DEBUG] No choices in response: {parsed_chunk}")
                                except (json.JSONDecodeError, KeyError) as e:
                                    print(f"[DEBUG] Error parsing local response: {e}")
                                    print(f"[DEBUG] Problematic chunk: {repr(new_chunk)}")
                                    continue
                        else:
                            print(f"[DEBUG] Non-data chunk received: {repr(chunk)}")
                
                print(f"[DEBUG] Stream completed after {chunk_count} chunks")
        except requests.RequestException as e:
            print(f"[ERROR] Request exception: {str(e)}")
            print(f"[ERROR] Request exception type: {type(e)}")
            error_chunk = ChatGenerationChunk(message=AIMessageChunk(content=f"Request failed: {str(e)}"))
            yield error_chunk
        except Exception as e:
            print(f"[ERROR] Unexpected exception: {str(e)}")
            print(f"[ERROR] Exception type: {type(e)}")
            import traceback
            print(f"[ERROR] Traceback: {traceback.format_exc()}")
            error_chunk = ChatGenerationChunk(message=AIMessageChunk(content=f"Unexpected error: {str(e)}"))
            yield error_chunk


    def bind_tools(
        self,
        tools: Sequence[Union[Dict[str, Any], Type[BaseModel], Callable, BaseTool]],
        *,
        tool_choice: Optional[
            Union[dict, str, Literal["auto", "any", "none"], bool]
        ] = None,
        **kwargs: Any,
    ) -> Runnable[LanguageModelInput, BaseMessage]:
        """Bind tool-like objects to this chat model.

        Args:
            tools: A list of tool definitions to bind to this chat model.
                Supports any tool definition handled by
                :meth:`langchain_core.utils.function_calling.convert_to_openai_tool`.
            tool_choice: Which tool to require the model to call.
                Must be the name of the single provided function,
                "auto" to automatically determine which function to call
                with the option to not call any function, "any" to enforce that some
                function is called, or a dict of the form:
                {"type": "function", "function": {"name": <<tool_name>>}}.
            **kwargs: Any additional parameters to pass to the
                :class:`~langchain.runnable.Runnable` constructor.
        """
        formatted_tools = [convert_to_openai_tool(tool) for tool in tools]
        if tool_choice is not None and tool_choice:
            if tool_choice == "any":
                tool_choice = "required"
            if isinstance(tool_choice, str) and (
                tool_choice not in ("auto", "none", "required")
            ):
                tool_choice = {"type": "function", "function": {"name": tool_choice}}
            if isinstance(tool_choice, bool):
                if len(tools) > 1:
                    raise ValueError(
                        "tool_choice can only be True when there is one tool. Received "
                        f"{len(tools)} tools."
                    )
                tool_name = formatted_tools[0]["function"]["name"]
                tool_choice = {
                    "type": "function",
                    "function": {"name": tool_name},
                }

            kwargs["tool_choice"] = tool_choice
        return super().bind(tools=formatted_tools, **kwargs)
    
    @property
    def _llm_type(self) -> str:
        """Get the type of language model used by this chat model. Used for logging purposes only."""
        return "custom"