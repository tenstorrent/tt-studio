# Point a coding agent at your own box

## What you'll build

Claude Code, OpenCode, or any OpenAI-compatible client talking to a model running on your own
Tenstorrent hardware instead of a paid API. Your code and prompts stay on the machine, and there is
no per-token cost.

## You'll need

- A deployed chat model that the gateway accepts. Currently that's **Llama-3.1-8B-Instruct**,
  **Llama-3.3-70B-Instruct**, or **Qwen3-32B**.
- The LiteLLM gateway, which starts with the rest of the stack on port 4000.

:::{note} Why only those models
A coding agent leans hard on tool calling — reading files, running commands, applying edits. A
model that gets tool calls subtly wrong is worse than no agent at all, so the gateway only offers
models whose native tool calling has been verified.
:::

## Steps

### 1. Deploy an eligible model

Deploy one of the three above. On a single N150 or N300, Llama-3.1-8B-Instruct is your option; a
T3K, QuietBox 2 or Galaxy can host the larger two, which are noticeably better at multi-step work.

Wait for the model to report healthy. **Connect Agents** then appears in the navigation — it's
hidden until a gateway-eligible model is actually up.

### 2. Copy the generated configuration

Open **Connect Agents**. The page detects your deployment and generates a ready-to-paste snippet
for each client, with the base URL, auth token and model name already filled in. The URLs are built
from however you reached the page, so a port-forwarded or HTTPS setup gets the right host rather
than a hardcoded `localhost`.

For Claude Code the snippet sets:

```bash
export ANTHROPIC_BASE_URL=...
export ANTHROPIC_AUTH_TOKEN=...
export ANTHROPIC_MODEL=...
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
```

OpenCode and OpenClaw get provider entries written into their own config files. The OpenAI tab
gives you a plain `curl` against `/v1/chat/completions` for anything else.

### 3. Run your client

Start Claude Code (or your client of choice) in the shell where you exported those variables. It
will connect to your box. Ask it to read a file to confirm tool calling is working end to end.

## Make it yours

**Turn on thinking mode.** Qwen3-32B is also exposed as `Qwen3-32B-thinking`. Point
`ANTHROPIC_MODEL` at that variant when you want the model to deliberate before answering; use the
plain name when you want speed. The reasoning tokens are hidden from the agent so they don't end up
in your diffs.

**Use it from scripts.** The same gateway speaks the OpenAI API, so anything that takes a base URL
and a key works — LangChain, the OpenAI SDK, a shell one-liner.

**Reach it from another machine.** The generated snippets follow the host you loaded the page from,
so if you access TT-Studio over a tunnel or a LAN address the config will point there too.

## Troubleshooting

**Connect Agents isn't in the navigation.** No eligible model is deployed and healthy yet. Check
the model list — an eligible model that's still starting won't count.

**The client connects but every request fails.** The gateway key and the model name have to match
what the page generated. Regenerate rather than editing by hand; the model name includes details
you won't guess.

**Tool calls come back malformed.** You're likely pointed at a model outside the eligible set. Some
names appear in the configuration source that aren't in the shipped catalog — go by what the
Connect Agents page offers, not by what you can deploy.

## Next steps

- [Deploy a model in one command](unattended-deploy.md) — bring the box up with the model already running
- [Chat with your documents](chat-with-your-documents.md) — add retrieval over your own material
