# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from pydantic.v1 import BaseModel
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
    Literal
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
    cloud_model_name: Optional[str] = None

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
    ) -> Iterator[ChatGenerationChunk]:
        """Stream the output of the model.

        This method should be implemented if the model can generate output
        in a streaming fashion. If the model does not support streaming,
        do not implement it. In that case streaming requests will be automatically
        handled by the _generate method.

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
        if self.is_cloud:
            # Handle cloud LLM endpoint (e.g., OpenAI API format)
            headers = {"Authorization": f"Bearer {self.encoded_jwt}"}
            
            # Convert LangChain messages to OpenAI format
            message_payload = []
            for msg in messages:
                if hasattr(msg, 'role'):
                    message_payload.append({"role": msg.role, "content": str(msg.content)})
                else:
                    # For system messages or other types, try to infer the role
                    content = str(msg.content)
                    if "system" in content.lower() or "assistant" in content.lower():
                        message_payload.append({"role": "system", "content": content})
                    else:
                        message_payload.append({"role": "user", "content": content})
            
            json_data = {
                "model": self.cloud_model_name,  # Use configurable model name
                "messages": message_payload,
                "temperature": 0.7,
                "max_tokens": 512,
                "stream": True,
            }
            
        else:
            # Handle local LLM container (existing logic)
            last_message = messages[-1] # take most recent message as input to chat 
            filled_template = str(last_message.content)

            # code to structure template into format llama 3.1 70b chat/completions endpoint expects
            end_of_template_substring = "Begin!"
            position = filled_template.find(end_of_template_substring)
            template = ""
            user_content = ""
            if position != -1:
                template = filled_template[:position + len(end_of_template_substring)]
                user_content = filled_template[position + len(end_of_template_substring):]
                content_position = user_content.find("New input:")
                if content_position != -1:
                    user_content = user_content[content_position:]
            # message format for llama 3.1 70b chat endpoint 
            message_payload = [{"role": "system", "content": template}, 
                               {"role": "user", "content": user_content}]
            
            headers = {"Authorization": f"Bearer {self.encoded_jwt}"}
            hf_model_path = os.getenv("HF_MODEL_PATH")
            json_data = {
                "model": hf_model_path,
                "messages": message_payload,
                "temperature": 1,
                "top_k": 20,
                "top_p": 0.9,
                "max_tokens": 512,
                "stream": True,
                "stop": ["<|eot_id|>"],
            }

        print(f"Making request to: {self.server_url}")
        redacted_headers = {key: ("<REDACTED>" if key.lower() == "authorization" else value) for key, value in headers.items()}
        print(f"Headers: {redacted_headers}")
        print(f"JSON data: {json.dumps(json_data, indent=2)}")
        
        try:
            with requests.post(
                self.server_url, json=json_data, headers=headers, stream=True, timeout=30
            ) as response:
                print(f"Response status: {response.status_code}")
                print(f"Response headers: {dict(response.headers)}")
                
                if response.status_code != 200:
                    print(f"Error response: {response.text}")
                    # Yield an error message instead of failing silently
                    error_chunk = ChatGenerationChunk(message=AIMessageChunk(content=f"Error: HTTP {response.status_code}"))
                    yield error_chunk
                    return
                
                chunk_count = 0
                for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                    chunk_count += 1
                    print(f"Received chunk {chunk_count}: {repr(chunk)}")
                    
                    if not chunk.strip():
                        continue
                        
                    if self.is_cloud:
                        # Handle cloud response format (standard OpenAI streaming)
                        if chunk.startswith("data: "):
                            chunk_data = chunk[6:].strip()
                            if chunk_data == "[DONE]":
                                new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=""))
                                yield new_chunk
                            else:
                                try:
                                    parsed_chunk = json.loads(chunk_data)
                                    if "choices" in parsed_chunk and len(parsed_chunk["choices"]) > 0:
                                        delta = parsed_chunk["choices"][0].get("delta", {})
                                        content = delta.get("content", "")
                                        if content:
                                            new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=content))
                                            yield new_chunk
                                except json.JSONDecodeError:
                                    continue
                    else:
                        # Handle local container response format (existing logic)
                        if chunk.startswith("data: "):
                            new_chunk = chunk[len("data: "):]
                            new_chunk = new_chunk.strip()
                            if new_chunk == "[DONE]":
                                # Yield [DONE] to signal that streaming is complete
                                new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=""))
                                yield new_chunk
                            else:
                                try:
                                    new_chunk = json.loads(new_chunk)
                                    new_chunk = new_chunk["choices"][0]
                                    # below format is used for v1/chat/completions endpoint
                                    new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=new_chunk["delta"]["content"]))
                                    yield new_chunk
                                except (json.JSONDecodeError, KeyError):
                                    continue
        except requests.RequestException as e:
            print(f"Request exception: {str(e)}")
            error_chunk = ChatGenerationChunk(message=AIMessageChunk(content=f"Request failed: {str(e)}"))
            yield error_chunk
        except Exception as e:
            print(f"Unexpected exception: {str(e)}")
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