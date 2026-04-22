# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

async def poll_requests(agent_executor, config, tools, memory, message):
    """
    Streams the agent's output with <think> tags for the frontend thinking UI.
    Tool invocations appear in the thinking panel; the final answer is streamed
    directly as content tokens.

    With native tool calling the LLM returns structured tool_calls (no text
    parsing needed).  Content tokens produced *after* all tool phases are the
    final answer and are streamed directly to the user.
    """
    import ast
    import json
    import re
    import time
    from urllib.parse import urlparse

    chat_history = memory.buffer_as_messages
    thinking_opened = False
    in_tool_phase = False
    emitted_queries = set()

    start_time = time.perf_counter()
    first_token_time = None
    token_count = 0
    llm_gen_start = None
    llm_gen_time = 0.0

    # Buffer to catch tool-call JSON that the model leaks as plain text
    # (e.g. {"name": "tavily_search_results_json", "parameters": {...}})
    _json_buf = ""
    _json_buffering = False
    _TOOL_CALL_RE = re.compile(r'"name"\s*:.*("parameters"|"arguments")\s*:', re.DOTALL)

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
                if llm_gen_start is not None:
                    llm_gen_time += time.perf_counter() - llm_gen_start
                    llm_gen_start = None
                # Flush or discard the JSON buffer at end of agent run
                if _json_buffering and _json_buf:
                    if not _TOOL_CALL_RE.search(_json_buf):
                        yield _json_buf
                    _json_buf = ""
                    _json_buffering = False
                if thinking_opened:
                    yield "</think>"
                    thinking_opened = False

            elif kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]

                # If the chunk carries tool_call_chunks, the model is
                # generating a tool call — enter tool phase immediately
                # so we don't accidentally stream tool-call JSON to the UI.
                if getattr(chunk, "tool_call_chunks", None):
                    in_tool_phase = True

                content = chunk.content
                if not content:
                    continue

                # Llama 3.x emits <|python_tag|> in various split forms.
                # Strip it from content (not drop the chunk, as the tag
                # can be glued to actual answer text).
                content = re.sub(r'[\[<|]*python_tag[\]>|]*', '', content)
                if not content:
                    continue

                now = time.perf_counter()
                if first_token_time is None:
                    first_token_time = now
                if llm_gen_start is None:
                    llm_gen_start = now
                token_count += 1

                if not in_tool_phase:
                    if thinking_opened:
                        yield "</think>"
                        thinking_opened = False

                    # Buffer content that might be leaked tool-call JSON.
                    # Start buffering on '{', flush or discard when we can decide.
                    combined = _json_buf + content if _json_buffering else content
                    stripped = combined.lstrip()
                    if stripped.startswith('{') or _json_buffering:
                        _json_buf = combined
                        _json_buffering = True
                        if _TOOL_CALL_RE.search(_json_buf):
                            _json_buf = ""
                            _json_buffering = False
                            continue
                        if len(_json_buf) > 300:
                            yield _json_buf
                            _json_buf = ""
                            _json_buffering = False
                    else:
                        if _json_buf:
                            yield _json_buf
                            _json_buf = ""
                            _json_buffering = False
                        yield content

            elif kind == "on_tool_start":
                if llm_gen_start is not None:
                    llm_gen_time += time.perf_counter() - llm_gen_start
                    llm_gen_start = None
                in_tool_phase = True
                tool_name = event["name"]
                if tool_name == "_Exception":
                    continue

                raw_input = event["data"].get("input", "")
                if isinstance(raw_input, dict):
                    query = raw_input.get("query", raw_input.get("input", ""))
                else:
                    query = str(raw_input) if raw_input else ""

                print(f"[TOOL] Starting: {tool_name} with {query}")

                if not thinking_opened:
                    thinking_opened = True
                    yield "<think>"
                    yield "[searching]\n"
                if query and query not in emitted_queries:
                    emitted_queries.add(query)
                    yield f"Searching: {query}\n"

            elif kind == "on_tool_end":
                tool_name = event.get("name", "")
                if tool_name == "_Exception":
                    continue
                in_tool_phase = False
                print(f"[TOOL] Completed: {tool_name}")

                if thinking_opened:
                    raw_output = event["data"].get("output", "")
                    sources = []
                    try:
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

    elapsed = time.perf_counter() - start_time
    ttft = (first_token_time - start_time) if first_token_time else None
    tpot = (llm_gen_time / max(token_count - 1, 1)
            if token_count > 1 and llm_gen_time > 0 else None)
    stats = {
        "tokens_decoded": token_count,
        "ttft": ttft,
        "tpot": tpot,
        "total_time": elapsed,
    }
    yield f"[STATS]{json.dumps(stats)}"

TOOL_CALLING_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You are a helpful Search Agent. Your primary job is to search the web "
     "and provide answers grounded in real, up-to-date information.\n\n"
     "RULES:\n"
     "1. Use the search tool for ANY factual question (weather, travel, news, "
     "prices, recommendations, people, places, events, etc.).\n"
     "2. After receiving search results, answer using ONLY information from "
     "the results. Do NOT invent facts, statistics, or details not present "
     "in the search results. If the results don't contain specific info, "
     "say so rather than guessing.\n"
     "3. Do NOT search again unless the first results were completely "
     "irrelevant. One search is almost always enough.\n"
     "4. Cite your sources naturally in the answer when possible."),
    MessagesPlaceholder("chat_history"),
    ("human", "{input}"),
    MessagesPlaceholder("agent_scratchpad"),
])


def setup_executer(llm, memory, tools):
    agent = create_tool_calling_agent(llm, tools, TOOL_CALLING_PROMPT)
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        max_iterations=10,
        memory=memory,
        return_intermediate_steps=True,
        handle_parsing_errors=True,
        max_execution_time=None,
        verbose=False,
    )
    return agent_executor