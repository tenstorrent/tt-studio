from pydantic import BaseModel, Field
from typing import List, Sequence, Tuple, Any
from langchain_core.messages import BaseMessage
from langchain.agents.output_parsers.tools import ToolAgentAction
from e2b_code_interpreter import Sandbox
from langchain_core.tools import Tool
from langchain_core.messages import ToolMessage


import os
import json 

def format_to_tool_messages(
    intermediate_steps: Sequence[Tuple[ToolAgentAction, dict]],
) -> List[BaseMessage]:
    messages = []
    for agent_action, observation in intermediate_steps:
        if agent_action.tool == CodeInterpreterFunctionTool.tool_name:
            new_messages = CodeInterpreterFunctionTool.format_to_tool_message(
                agent_action,
                observation,
            )
            messages.extend([new for new in new_messages if new not in messages])
        else:
            # Handle other tools
            print("Not handling tool: ", agent_action.tool)

    return messages

class LangchainCodeInterpreterToolInput(BaseModel):
    code: str = Field(description="Python code to execute.")


class CodeInterpreterFunctionTool:
    """
    This class calls arbitrary code against a Python Jupyter notebook.
    It requires an E2B_API_KEY to create a sandbox.
    """

    tool_name: str = "code_interpreter"

    def __init__(self):
        # Instantiate the E2B sandbox - this is a long lived object
        # that's pinging E2B cloud to keep the sandbox alive.
        if "E2B_API_KEY" not in os.environ:
            raise Exception(
                "Code Interpreter tool called while E2B_API_KEY environment variable is not set. Please get your E2B api key here https://e2b.dev/docs and set the E2B_API_KEY environment variable."
            )
        self.code_interpreter = Sandbox(timeout=1800)

    def call(self, parameters: dict, **kwargs: Any):
        code = parameters.get("code", "")
        if code.startswith("```"):
            code = code[3:]
        if code.endswith("[DONE]"):
            # TODO: check if this needs to be parsed 
            pass 
        if code.endswith("```"):
            code = code[:-3]
        elif code.endswith("```\n"):
            code = code[:-4]
        print(f"***Code Interpreting...\n{code}\n====")
        execution = self.code_interpreter.run_code(code)
        return {
            "results": execution.results,
            "stdout": execution.logs.stdout,
            "stderr": execution.logs.stderr,
            "error": execution.error,
        }

    def close(self):
        self.code_interpreter.kill()

    # langchain does not return a dict as a parameter, only a code string
    def langchain_call(self, code: str):
        return self.call({"code": code})

    def to_langchain_tool(self) -> Tool:
        tool = Tool(
            name=self.tool_name,
            description="Execute python code in a Jupyter notebook cell and returns any rich data (eg charts), stdout, stderr, and error.",
            func=self.langchain_call,
        )
        tool.args_schema = LangchainCodeInterpreterToolInput
        return tool

    @staticmethod
    def format_to_tool_message(
        agent_action: ToolAgentAction,
        observation: dict,
    ) -> List[BaseMessage]:
        """
        Format the output of the CodeInterpreter tool to be returned as a ToolMessage.
        """
        new_messages = list(agent_action.message_log)

        # TODO: Add info about the results for the LLM
        content = json.dumps(
            {k: v for k, v in observation.items() if k not in ("results")}, indent=2
        )
        print(observation, agent_action, content)
        new_messages.append(
            ToolMessage(content=content, tool_call_id=agent_action.tool_call_id)
        )

        return new_messages