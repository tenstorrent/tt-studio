# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import json
import uuid

from langchain.agents import AgentExecutor, create_react_agent
from langchain import hub

_TOOL_OUTPUT_TRUNCATE = 4000


def _truncate(text, limit=_TOOL_OUTPUT_TRUNCATE):
    s = text if isinstance(text, str) else str(text)
    if len(s) <= limit:
        return s
    return s[:limit] + f"\n…(truncated, {len(s) - limit} chars omitted)"


def _emit_event(event_type, **fields):
    """Format a structured event so Django can passthrough as raw SSE.

    The `[EVENT]` sentinel matches the branch in
    `backend/model_control/model_utils.stream_response_from_agent_api`.
    """
    payload = {"event": event_type, **fields}
    return "[EVENT]" + json.dumps(payload) + "\n"


async def poll_requests(agent_executor, config, tools, memory, message):
    """
    Enhanced polling function with better response processing and error handling.
    Only yields content after 'Final Answer: ' to prevent reasoning leakage.
    Tool start/end events are yielded as structured `[EVENT]` JSON lines so
    the frontend can render them as collapsible tool-call blocks.
    """
    complete_output = ""
    chat_history = memory.buffer_as_messages
    final_answer = False
    print(f"Processing message: {message}")
    received_done_signal = False
    # Map LangChain run_id -> our short id so on_tool_end can pair with on_tool_start.
    tool_run_ids = {}

    try:
        async for event in agent_executor.astream_events(
            {"input": message, "chat_history": chat_history}, version="v2", config=config
        ):
            kind = event["event"]

            # Handle agent lifecycle events
            if kind == "on_chain_start" and event["name"] == "Agent":
                print(f"[AGENT] Starting with input: {event['data'].get('input')}")

            elif kind == "on_chain_end" and event["name"] == "Agent":
                print(f"[AGENT] Completed with output")

            # Process streaming chat model responses
            elif kind == "on_chat_model_stream":
                content = event["data"]["chunk"].content
                complete_output += content

                # Detect when we reach the final answer
                if "Final Answer:" in complete_output and not final_answer:
                    final_answer = True
                    position = complete_output.find("Final Answer:")
                    # Extract only the content after "Final Answer: "
                    final_content = complete_output[position + len("Final Answer:"):].strip()
                    complete_output = ""  # Reset for next chunks

                    # Yield the clean final answer content
                    if final_content:
                        yield final_content

                elif final_answer and content:
                    # Continue yielding content in final answer mode
                    if content == "[DONE]":
                        received_done_signal = True
                        break
                    else:
                        yield content

            elif kind == "on_tool_start":
                tool_name = event.get("name", "tool")
                run_id = event.get("run_id")
                call_id = uuid.uuid4().hex[:12]
                if run_id is not None:
                    tool_run_ids[run_id] = call_id
                tool_input = event.get("data", {}).get("input")
                print(f"[TOOL] Starting: {tool_name} with {tool_input}")
                yield _emit_event(
                    "tool_call_started",
                    id=call_id,
                    tool=tool_name,
                    input=_truncate(tool_input, 1000),
                )

            elif kind == "on_tool_end":
                tool_name = event.get("name", "tool")
                run_id = event.get("run_id")
                call_id = tool_run_ids.pop(run_id, None) or uuid.uuid4().hex[:12]
                output = event.get("data", {}).get("output")
                print(f"[TOOL] Completed: {tool_name}")
                yield _emit_event(
                    "tool_call_completed",
                    id=call_id,
                    tool=tool_name,
                    output_summary=_truncate(output),
                )

    except Exception as e:
        print(f"[ERROR] Agent execution failed: {e}")
        yield f"Sorry, I encountered an error: {str(e)}"

def setup_executer(llm, memory, tools):
    # Use the React chat prompt which is better for conversational agents
    prompt = hub.pull("hwchase17/react-chat")
    agent = create_react_agent(llm, tools, prompt)
    
    # Enhanced agent executor with better error handling and performance settings
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        max_iterations=10,  # Reduced from 100 for better performance
        memory=memory,
        return_intermediate_steps=True,
        handle_parsing_errors=True,
        max_execution_time=30,  # Timeout after 30 seconds
        verbose=False  # Disable verbose to reduce noise
    )       

    return agent_executor