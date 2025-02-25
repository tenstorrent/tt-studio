# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from langchain.agents import AgentExecutor, create_react_agent
from langchain import hub

async def poll_requests(agent_executor, config, tools, memory, message):
    complete_output = ""  # Initialize an empty string to accumulate output
    chat_history = memory.buffer_as_messages
    final_answer = False
    mainstring = "Final Answer: "
    possible_substrings = await gen_substrings(mainstring)
    first_final_response = False
    print(message)
    recieved_done_signal = False
    async for event in agent_executor.astream_events(
    {"input": message, "chat_history": chat_history}, version="v2", config=config
):
        kind = event["event"]
        if kind == "on_chain_start":
            if (
                event["name"] == "Agent"
            ):  # Was assigned when creating the agent with `.with_config({"run_name": "Agent"})`
                print(
                    f"Starting agent: {event['name']} with input: {event['data'].get('input')}"
                )
                # pass
        elif kind == "on_chain_end":
            if (
                event["name"] == "Agent"
            ):  # Was assigned when creating the agent with `.with_config({"run_name": "Agent"})`
                print()
                print("--")
                print(
                    f"Done agent: {event['name']} with output: {event['data'].get('output')['output']}"
                )
        if kind == "on_chat_model_stream":
            content = event["data"]["chunk"].content
            complete_output += content 
            if "Final Answer: " in complete_output:
                final_answer = True
                position = complete_output.find("Final Answer: ")
                complete_output = complete_output[position + len("Final Answer: "):]
                content = complete_output
                complete_output = ""
            if recieved_done_signal:
                break # to prevent further response if final answer block is already sent 
            if content and final_answer:
                if content == "[DONE]":
                    recieved_done_signal = True 
                yield content
    
        elif kind == "on_tool_start":
            print("--")
            print(
                f"Starting tool: {event['name']} with inputs: {event['data'].get('input')}"
            )
        elif kind == "on_tool_end":
            print(f"Done tool: {event['name']}")
            print(f"Tool output was: {event['data'].get('output')}")
            print("--")


async def gen_substrings(string_to_check):
    return [string_to_check[i:j] for i in range(len(string_to_check)) for j in range(len(string_to_check))]

def setup_executer(llm, memory, tools):
    prompt = hub.pull("hwchase17/react-chat")
    agent = create_react_agent(llm, tools, prompt)
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        max_iterations=100,
        memory=memory,
        return_intermediate_steps=True,
        handle_parsing_errors=True
        )       

    return agent_executor