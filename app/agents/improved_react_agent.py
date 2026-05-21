# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Improved ReAct Agent implementation using modern LangGraph patterns.
This provides better performance, error handling, and response formatting.
"""

from typing import Annotated, Dict, Any, List, Optional
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.tools import BaseTool
from langchain_core.language_models import BaseLLM
from langchain.memory.chat_memory import BaseChatMemory
import json


class ImprovedReActAgent:
    """
    Enhanced ReAct Agent with better response processing and structured output.
    """
    
    def __init__(self, llm: BaseLLM, tools: List[BaseTool], memory: BaseChatMemory):
        self.llm = llm
        self.tools = {tool.name: tool for tool in tools}
        self.memory = memory
        self.max_iterations = 10
        self.timeout = 30
        
    def _format_tools(self) -> str:
        """Format tools for the prompt."""
        tool_descriptions = []
        for tool in self.tools.values():
            tool_descriptions.append(f"- {tool.name}: {tool.description}")
        return "\n".join(tool_descriptions)
    
    def _get_system_prompt(self) -> str:
        """Enhanced system prompt with better instructions."""
        return f"""You are a helpful AI assistant that can use tools to answer questions.

Available tools:
{self._format_tools()}

When responding, follow this exact format:

For using a tool:
Thought: [your reasoning about what to do]
Action: [tool name]
Action Input: [tool input]

For final answer:
Thought: [your final reasoning]
Final Answer: [your complete response to the user]

Important rules:
1. Always provide a clear, helpful final answer
2. Use tools only when necessary to gather information
3. Keep reasoning concise but clear
4. Never expose your thinking process in the final answer
5. If you encounter an error, try a different approach or provide the best answer you can

Begin!"""

    async def _execute_tool(self, tool_name: str, tool_input: str) -> str:
        """Execute a tool and return the result."""
        try:
            if tool_name not in self.tools:
                return f"Error: Tool '{tool_name}' not found. Available tools: {list(self.tools.keys())}"
            
            tool = self.tools[tool_name]
            result = await tool.ainvoke(tool_input) if hasattr(tool, 'ainvoke') else tool.invoke(tool_input)
            return str(result)
        except Exception as e:
            return f"Error executing {tool_name}: {str(e)}"
    
    async def _process_llm_response(self, response: str) -> Dict[str, Any]:
        """Process LLM response and extract action or final answer."""
        response = response.strip()
        
        # Check for final answer
        if "Final Answer:" in response:
            final_answer = response.split("Final Answer:")[-1].strip()
            return {"type": "final_answer", "content": final_answer}
        
        # Check for action
        if "Action:" in response and "Action Input:" in response:
            try:
                action_start = response.find("Action:") + len("Action:")
                action_input_start = response.find("Action Input:", action_start)
                
                if action_input_start == -1:
                    return {"type": "error", "content": "Invalid format: Missing Action Input"}
                
                action = response[action_start:action_input_start].strip()
                action_input = response[action_input_start + len("Action Input:"):].strip()
                
                return {
                    "type": "action", 
                    "action": action, 
                    "action_input": action_input,
                    "thought": response.split("Action:")[0].replace("Thought:", "").strip()
                }
            except Exception as e:
                return {"type": "error", "content": f"Failed to parse action: {str(e)}"}
        
        # If we get here, the response doesn't match expected format
        return {"type": "error", "content": "Invalid response format"}
    
    async def stream_response(self, message: str):
        """Stream the agent's response, yielding only the final answer content."""
        
        # Prepare conversation history
        chat_history = self.memory.buffer_as_messages
        messages = [HumanMessage(content=self._get_system_prompt())]
        messages.extend(chat_history)
        messages.append(HumanMessage(content=message))
        
        scratchpad = ""
        iteration = 0
        
        try:
            while iteration < self.max_iterations:
                iteration += 1
                
                # Add scratchpad to prompt if we have previous steps
                current_prompt = message
                if scratchpad:
                    current_prompt = f"{message}\n\nPrevious steps:\n{scratchpad}"
                
                # Get LLM response
                if hasattr(self.llm, 'astream'):
                    # Streaming LLM
                    full_response = ""
                    async for chunk in self.llm.astream(messages):
                        if hasattr(chunk, 'content'):
                            full_response += chunk.content
                else:
                    # Non-streaming LLM
                    response = await self.llm.ainvoke(messages) if hasattr(self.llm, 'ainvoke') else self.llm.invoke(messages)
                    full_response = response.content if hasattr(response, 'content') else str(response)
                
                # Process the response
                parsed = await self._process_llm_response(full_response)
                
                if parsed["type"] == "final_answer":
                    # Clean final answer - yield only the answer content
                    final_content = parsed["content"].strip()
                    # Save to memory
                    self.memory.save_context({"input": message}, {"output": final_content})
                    
                    # Stream the final answer character by character for better UX
                    for char in final_content:
                        yield char
                    break
                    
                elif parsed["type"] == "action":
                    # Execute the tool
                    tool_result = await self._execute_tool(parsed["action"], parsed["action_input"])
                    
                    # Add to scratchpad
                    scratchpad += f"\nThought: {parsed['thought']}\n"
                    scratchpad += f"Action: {parsed['action']}\n"
                    scratchpad += f"Action Input: {parsed['action_input']}\n"
                    scratchpad += f"Observation: {tool_result}\n"
                    
                    # Add tool result to messages
                    messages.append(AIMessage(content=full_response))
                    messages.append(ToolMessage(content=tool_result, tool_call_id=f"call_{iteration}"))
                    
                elif parsed["type"] == "error":
                    yield f"I encountered an issue: {parsed['content']}. Let me try to help you anyway."
                    break
                    
            else:
                # Max iterations reached
                yield "I've reached my maximum thinking steps. Let me provide the best answer I can with the information I have."
                
        except Exception as e:
            print(f"[ERROR] Agent execution failed: {e}")
            yield f"Sorry, I encountered an error while processing your request: {str(e)}"


# Factory function to create the improved agent
def create_improved_react_agent(llm: BaseLLM, tools: List[BaseTool], memory: BaseChatMemory) -> ImprovedReActAgent:
    """Create an improved ReAct agent with better performance and error handling."""
    return ImprovedReActAgent(llm, tools, memory)


# Alternative streaming function that can replace the existing poll_requests
async def poll_requests_improved(agent: ImprovedReActAgent, message: str):
    """Improved polling function using the enhanced ReAct agent."""
    async for content in agent.stream_response(message):
        yield content