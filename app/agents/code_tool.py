# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
import json
from typing import List, Sequence, Tuple, Any

from pydantic import BaseModel, Field
from langchain_core.messages import BaseMessage, ToolMessage
from langchain.agents.output_parsers.tools import ToolAgentAction
from e2b_code_interpreter import Sandbox
from langchain_core.tools import Tool


class LangchainCodeInterpreterToolInput(BaseModel):
    """Input schema for the Langchain Code Interpreter tool."""
    code: str = Field(description="Python code to execute.")


class CodeInterpreterFunctionTool:
    """
    This class calls arbitrary code against a Python Jupyter notebook.
    It requires an E2B_API_KEY to create a sandbox and is designed
    as a context manager to ensure the sandbox is always closed.
    """
    tool_name: str = "code_interpreter"

    def __init__(self, timeout: int = 1800):
        """
        Initializes the E2B sandbox.
        Requires the E2B_API_KEY environment variable to be set.
        """
        if "E2B_API_KEY" not in os.environ:
            raise ValueError(
                "E2B_API_KEY environment variable not set. Get your key at https://e2b.dev/docs and set it."
            )
        self.code_interpreter = Sandbox(timeout=timeout)

    def __enter__(self):
        """Allows the class to be used as a context manager."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Ensures the sandbox is closed when exiting the context."""
        self.close()

    def call(self, parameters: dict, **kwargs: Any) -> dict:
        """
        Executes the given Python code in the sandbox.
        """
        code = parameters.get("code", "")

        # A cleaner way to strip common markdown fences and whitespace
        if code.startswith("```"):
            code = code.strip()
            if code.startswith("```python"):
                code = code[9:]
            elif code.startswith("```"):
                code = code[3:]
            if code.endswith("```"):
                code = code[:-3]
        
        print(f"--- Executing Code ---\n{code}\n----------------------")
        execution = self.code_interpreter.run_code(code)
        
        return {
            "results": execution.results,
            "stdout": execution.logs.stdout,
            "stderr": execution.logs.stderr,
            "error": execution.error,
        }

    def close(self):
        """Kills the sandbox instance."""
        print("--- Closing E2B Sandbox ---")
        self.code_interpreter.kill()

    def langchain_call(self, code: str) -> dict:
        """An adapter to call the tool with a simple string input from LangChain."""
        return self.call({"code": code})

    def to_langchain_tool(self) -> Tool:
        """Converts this class into a LangChain Tool instance."""
        tool = Tool(
            name=self.tool_name,
            description="Execute python code in a Jupyter notebook cell and returns any rich data (eg charts), stdout, stderr, and error.",
            func=self.langchain_call,
            args_schema=LangchainCodeInterpreterToolInput
        )
        return tool

    @staticmethod
    def _format_results_for_llm(results: list) -> str:
        """Creates a concise, text-based summary of rich results for the LLM."""
        if not results:
            return "No results."

        summary = []
        for result in results:
            if result.is_main_result and result.text:
                summary.append(f"Result: {result.text}")
            elif result.png:
                summary.append("Result: [An image/chart (PNG) was generated.]")
            elif result.jpeg:
                summary.append("Result: [A JPEG image was generated.]")
            elif result.pdf:
                summary.append("Result: [A PDF file was generated.]")
        return "\n".join(summary) if summary else "No displayable results produced."

    @staticmethod
    def format_to_tool_message(
        agent_action: ToolAgentAction,
        observation: dict,
    ) -> List[BaseMessage]:
        """
        Formats the tool's output observation into a ToolMessage for the LLM.
        This now includes a summary of the rich results.
        """
        new_messages = list(agent_action.message_log)

        results_summary = CodeInterpreterFunctionTool._format_results_for_llm(observation.get("results", []))

        content_parts = {
            "results_summary": results_summary,
            "stdout": observation.get("stdout"),
            "stderr": observation.get("stderr"),
            "error": str(observation.get("error")) if observation.get("error") else None,
        }
        
        content_dict = {k: v for k, v in content_parts.items() if v}
        content = json.dumps(content_dict, indent=2)

        new_messages.append(
            ToolMessage(content=content, tool_call_id=agent_action.tool_call_id)
        )

        return new_messages

    @staticmethod
    def format_intermediate_steps(
        intermediate_steps: Sequence[Tuple[ToolAgentAction, dict]],
    ) -> List[BaseMessage]:
        """
        Processes a sequence of agent actions and observations, formatting them
        into a list of messages that can be sent to the model.
        """
        messages = []
        for agent_action, observation in intermediate_steps:
            if agent_action.tool == CodeInterpreterFunctionTool.tool_name:
                tool_messages = CodeInterpreterFunctionTool.format_to_tool_message(
                    agent_action,
                    observation,
                )
                messages.extend(tool_messages)
            else:
                # Gracefully handle other tools if they exist
                messages.append(
                    ToolMessage(
                        content=json.dumps(observation), 
                        tool_call_id=agent_action.tool_call_id
                    )
                )
        return messages