# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from langchain.agents import AgentExecutor, create_react_agent
from langchain_core.prompts import PromptTemplate

async def poll_requests(agent_executor, config, tools, memory, message):
    """
    Streams the agent's output with <think> tags for the frontend thinking UI.
    Only tool events appear in the thinking panel; raw ReAct scaffolding is
    suppressed.  The Final Answer is streamed as clean content after </think>.

    Handles multi-iteration correctly: if the agent gives a preliminary answer
    then decides to use a tool, the earlier answer is discarded and only the
    final one (after the last tool call) is shown.
    """
    import re
    import ast
    import json
    from urllib.parse import urlparse

    complete_output = ""
    chat_history = memory.buffer_as_messages
    thinking_opened = False
    emitted_queries = set()
    print(f"Processing message: {message}")

    try:
        async for event in agent_executor.astream_events(
            {"input": message, "chat_history": chat_history}, version="v2", config=config
        ):
            kind = event["event"]

            if kind == "on_chain_start" and event["name"] == "AgentExecutor":
                print(f"[AGENT] Starting with input: {event['data'].get('input')}")

            elif kind == "on_chain_end" and event["name"] == "AgentExecutor":
                print(f"[AGENT] Completed")
                if thinking_opened:
                    yield "</think>"
                    thinking_opened = False

                # Extract the LAST "Final Answer:" from the full accumulated
                # text so multi-iteration answers don't leak scaffolding.
                last_fa = complete_output.rfind("Final Answer:")
                if last_fa != -1:
                    answer = complete_output[last_fa + len("Final Answer:"):].strip()
                    if answer:
                        yield answer
                else:
                    # No Final Answer marker — yield whatever we have
                    stripped = complete_output.strip()
                    if stripped:
                        yield stripped

            elif kind == "on_chat_model_stream":
                content = event["data"]["chunk"].content
                if not content:
                    continue
                complete_output += content

                # Open the search panel as soon as the LLM decides to
                # use the search tool.  The [searching] marker tells the
                # frontend to show the "Searching the web…" animation
                # immediately, before the actual query arrives.
                if not thinking_opened and "Action: tavily" in complete_output:
                    thinking_opened = True
                    yield "<think>"
                    yield "[searching]\n"

            elif kind == "on_tool_start":
                tool_name = event["name"]
                if tool_name == "_Exception":
                    continue

                # Extract query from the LLM's ReAct output (event data is
                # often empty for TavilySearchResults).
                query = ""
                matches = list(re.finditer(
                    r"Action Input:\s*[\"']?(.+?)[\"']?\s*$",
                    complete_output, re.MULTILINE,
                ))
                if matches:
                    query = matches[-1].group(1).strip()

                if not query:
                    raw_input = event["data"].get("input", "")
                    if isinstance(raw_input, dict):
                        query = raw_input.get("query", raw_input.get("input", ""))
                    else:
                        query = str(raw_input) if raw_input else ""

                print(f"[TOOL] Starting: {tool_name} with {query}")

                if not thinking_opened:
                    thinking_opened = True
                    yield "<think>"
                if query and query not in emitted_queries:
                    emitted_queries.add(query)
                    yield f"Searching: {query}\n"

            elif kind == "on_tool_end":
                tool_name = event.get("name", "")
                if tool_name == "_Exception":
                    continue
                print(f"[TOOL] Completed: {tool_name}")

                # Extract source URLs from Tavily search results
                if thinking_opened:
                    raw_output = event["data"].get("output", "")
                    sources = []
                    try:
                        # LangChain BaseTool.invoke() stringifies results
                        # with str() which uses single quotes — json.loads
                        # rejects those, so fall back to ast.literal_eval.
                        if isinstance(raw_output, str):
                            try:
                                parsed = json.loads(raw_output)
                            except (json.JSONDecodeError, ValueError):
                                parsed = ast.literal_eval(raw_output)
                        else:
                            parsed = raw_output
                        if isinstance(parsed, list):
                            for item in parsed:
                                if isinstance(item, dict) and "url" in item:
                                    url = item["url"].strip()
                                    if not url:
                                        continue
                                    title = item.get("title", "").strip()
                                    if not title:
                                        host = urlparse(url).netloc
                                        title = host.removeprefix("www.")
                                    sources.append((title, url))
                    except (json.JSONDecodeError, TypeError, ValueError, SyntaxError):
                        pass

                    if sources:
                        for title, url in sources:
                            yield f"Source: [{title}]({url})\n"
                    else:
                        yield "Done.\n"

    except Exception as e:
        print(f"[ERROR] Agent execution failed: {e}")
        if thinking_opened:
            yield "</think>"
        yield f"Sorry, I encountered an error: {str(e)}"

REACT_SEARCH_PROMPT = PromptTemplate.from_template(
    """\
You are a helpful Search Agent. Your primary job is to search the web and \
provide answers grounded in real, up-to-date information.

IMPORTANT: You MUST use the search tool for ANY question that involves facts, \
recommendations, prices, events, travel, news, people, places, or anything \
that benefits from current information. NEVER answer from memory alone when a \
web search could give a better, more accurate answer. When in doubt, search.

TOOLS:
------
You have access to the following tools:

{tools}

To use a tool, you MUST use EXACTLY this format:

```
Thought: Do I need to use a tool? Yes
Action: the action to take, should be one of [{tool_names}]
Action Input: the input to the action
```

IMPORTANT: After writing "Action Input:", you MUST stop and wait for the \
Observation. Do NOT write the Observation yourself.

When you have gathered enough information and are ready to respond to the \
Human, you MUST use this format:

```
Thought: Do I need to use a tool? No
Final Answer: [your response here, citing the information you found]
```

Begin!

Previous conversation history:
{chat_history}

New input: {input}
{agent_scratchpad}"""
)


def setup_executer(llm, memory, tools):
    agent = create_react_agent(llm, tools, REACT_SEARCH_PROMPT)
    
    # Enhanced agent executor with better error handling and performance settings
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        max_iterations=10,
        memory=memory,
        return_intermediate_steps=True,
        handle_parsing_errors=True,
        max_execution_time=180,  # TT hardware TTFT can be 30s+; allow enough time
        verbose=False,
    )       

    return agent_executor