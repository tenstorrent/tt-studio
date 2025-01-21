from langchain.agents import AgentExecutor, create_react_agent
from langchain_core.prompts import ChatPromptTemplate

async def poll_requests(agent_executor, config, tools, memory, message):
    # try:
        # while True:
            # message = input("\nSend a message\n ")
    complete_output = ""
    # final_ans_recieved = 0 

    # if message.lower() in ["exit", "quit"]:
    #     print("Exiting the program.")
    #     break

    # input_data = {
    #     "input": message,
    #     "agent_scratchpad": "",
    #     "tools": "\n".join([tool.name for tool in tools]),  # Add tool descriptions
    #     "tool_names": ", ".join([tool.name for tool in tools])  # Add tool names
    # }

    complete_output = ""  # Initialize an empty string to accumulate output
    async for event in agent_executor.astream_events(
    {"input": message}, version="v2", config=config
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
            if "Final Answer:" in complete_output:
                complete_output = ""
                if "[DONE]" in complete_output:
                    break 
            if content:
                yield content
            # if final_ans_recieved and content.strip().endswith("[DONE]"):
            #     break 
        elif kind == "on_tool_start":
            print("--")
            print(
                f"Starting tool: {event['name']} with inputs: {event['data'].get('input')}"
            )
        elif kind == "on_tool_end":
            print(f"Done tool: {event['name']}")
            print(f"Tool output was: {event['data'].get('output')}")
            print("--")


    # except KeyboardInterrupt:
    #     print("\nExiting due to keyboard interrupt.")


def setup_executer(llm, memory, tools):
    with open("./prompt_template.txt", "r") as f:
        template = f.read()

    prompt = ChatPromptTemplate.from_template(template)
    agent = create_react_agent(llm, tools, prompt)
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        max_iterations=10,
        memory=memory,
        return_intermediate_steps=True,
        handle_parsing_errors=True,
        )       

    return agent_executor
