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

    _PTAG_RE = re.compile(r'[\[<|]*python_tag[\]>|]*', re.IGNORECASE)
    # Partial prefix detector: matches tail strings that could be the
    # beginning of a <|python_tag|> token split across chunks.
    _PTAG_PARTIAL = re.compile(
        r'[\[<|]*(?:p(?:y(?:t(?:h(?:o(?:n(?:_(?:t(?:a(?:g[\]>|]*)?)?)?)?)?)?)?)?)?)?$',
        re.IGNORECASE,
    )
    _PTAG_MAX_LEN = 16  # len("<|python_tag|>")

    chat_history = memory.buffer_as_messages
    thinking_opened = False
    in_tool_phase = False
    emitted_queries = set()

    start_time = time.perf_counter()
    first_token_time = None
    token_count = 0
    llm_gen_start = None
    llm_gen_time = 0.0

    # Buffer to catch tool-call JSON that the model leaks as plain text.
    # Covers multiple formats models may emit:
    #   {"name": "tavily_...", "parameters": {...}}
    #   {"name": "tavily_...", "arguments": {...}}
    #   {"tool": "tavily_...", ...}
    _json_buf = ""
    _json_buffering = False
    _TOOL_CALL_RE = re.compile(
        r'"name"\s*:\s*"[^"]*(?:tavily|search)[^"]*"'
        r'|"(?:parameters|arguments)"\s*:\s*\{'
        r'|"tool"\s*:\s*"[^"]*(?:tavily|search)[^"]*"'
        r'|"tool_calls"\s*:',
        re.DOTALL | re.IGNORECASE,
    )

    # Buffer to catch <|python_tag|> split across SSE chunks
    _ptag_buf = ""

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
                # Flush remaining python_tag buffer
                if _ptag_buf:
                    cleaned = _PTAG_RE.sub('', _ptag_buf)
                    if cleaned and not _TOOL_CALL_RE.search(cleaned):
                        yield cleaned
                    _ptag_buf = ""
                # Flush or discard the JSON buffer at end of agent run
                if _json_buffering and _json_buf:
                    if not _TOOL_CALL_RE.search(_json_buf):
                        yield _json_buf
                    else:
                        print(f"[AGENT] Discarded leaked tool-call JSON at end of run ({len(_json_buf)} chars)")
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
                # Buffer content so we can strip the tag even when it
                # arrives split across consecutive SSE chunks.
                _ptag_buf += content
                _ptag_buf = _PTAG_RE.sub('', _ptag_buf)
                if not _ptag_buf:
                    continue

                # If the tail of the buffer looks like a partial python_tag
                # prefix (e.g. "<|pyth"), keep buffering.
                tail = _ptag_buf[-_PTAG_MAX_LEN:]
                if _PTAG_PARTIAL.search(tail) and len(_ptag_buf) <= _PTAG_MAX_LEN:
                    continue

                content = _ptag_buf
                _ptag_buf = ""

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
                        if len(_json_buf) > 600:
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
                _ptag_buf = ""
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
        import traceback
        print(f"[ERROR] Agent execution failed: {e}")
        traceback.print_exc()
        if thinking_opened:
            yield "</think>"
        err_msg = str(e)
        if "Could not parse LLM output" in err_msg or "OutputParserException" in err_msg:
            yield (
                "I wasn't able to process that request properly. "
                "The model had trouble formatting its response. "
                "Please try rephrasing your question."
            )
        elif "rate limit" in err_msg.lower() or "429" in err_msg:
            yield "The search service is temporarily rate-limited. Please wait a moment and try again."
        elif "timeout" in err_msg.lower() or "timed out" in err_msg.lower():
            yield "The request timed out. Please try again with a simpler query."
        elif "connection" in err_msg.lower() or "unreachable" in err_msg.lower():
            yield "I'm having trouble connecting to the search service. Please try again shortly."
        else:
            yield f"Sorry, I encountered an error while processing your request. Please try again."

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
     "1. ALWAYS use the search tool FIRST for ANY user question — weather, "
     "travel, news, prices, recommendations, people, places, events, "
     "itineraries, how-to guides, or anything that benefits from current data.\n"
     "2. After receiving search results, synthesize a thorough, complete "
     "answer using ONLY information from the results. Do NOT invent facts, "
     "statistics, or details not present in the search results.\n"
     "3. Do NOT search more than once unless the first results were completely "
     "irrelevant. One well-crafted search query is almost always enough.\n"
     "4. Do NOT include a \"Sources\" or \"References\" section at the end of "
     "your answer. Do NOT list URLs or links in your response. Sources are "
     "displayed separately by the UI — your job is ONLY to write the answer "
     "text. You may mention a source name naturally in prose (e.g. "
     "\"according to Reuters\") but never list bare URLs.\n"
     "5. NEVER output raw tags, JSON, or tool-call syntax in your response — "
     "only produce clean, natural-language text.\n"
     "6. Provide actionable, detailed answers. For travel, include specific "
     "recommendations; for factual questions, give precise figures."),
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