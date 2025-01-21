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

import requests
import json 
import os


class CustomLLM(BaseChatModel):
    server_url: str
    encoded_jwt: str

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

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

    def _stream(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
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
        last_message = messages[-1] # take most recent message as input to chat 
        filled_template = str(last_message.content)

        # code to strucuture template into format llama 3.1 70b chat/completions endpoint exepcts
        end_of_template_substring = "Begin!"
        position = filled_template.find(end_of_template_substring)
        template = ""
        user_content = ""
        if position != -1:
            template = filled_template[:position + len(end_of_template_substring)]
            user_content = filled_template[position + len(end_of_template_substring):]
            content_position = user_content.find("Question:")
            if content_position != -1:
                user_content = user_content[content_position:]
        # message format for llama 3.1 70b chat endpoint 
        message_payload = [{"role": "system", "content": template}, 
                           {"role": "user", "content": user_content}]

        headers = {"Authorization": f"Bearer {self.encoded_jwt}"}
        json_data = {
            "model": "meta-llama/Llama-3.1-70B-Instruct",
            "messages": message_payload,
            "temperature": 1,
            "top_k": 20,
            "top_p": 0.9,
            "max_tokens": 128,
            "stream": True,
            "stop": ["<|eot_id|>"],
            }
        with requests.post(
            self.server_url, json=json_data, headers=headers, stream=True, timeout=None
        ) as response:
            for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                new_chunk = chunk[len("data: "):]
                new_chunk =  new_chunk.strip()
                if new_chunk == "[DONE]":
                        # Yield [DONE] to signal that streaming is complete
                        new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=new_chunk))
                        yield new_chunk
                else:
                    new_chunk = json.loads(new_chunk)
                    # print(new_chunk)
                    new_chunk = new_chunk["choices"][0]
                    # below format is used for v1/completions endpoint
                    # new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=new_chunk["text"]))
                    # below format is used for v1/chat/completions endpoint
                    new_chunk = ChatGenerationChunk(message=AIMessageChunk(content=new_chunk["delta"]["content"]))
                    yield new_chunk
                if run_manager:
                    run_manager.on_llm_new_token(
                        new_chunk.text, chunk=new_chunk
                    )


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