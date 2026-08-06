// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Connection guides for marketplace apps TT-Studio cannot launch itself.
// One builder per app id, keyed by the same ids as shared_config/marketplace_config.py.

// Fallbacks for a model whose limits the gateway hasn't reported yet.
// maxTokens mirrors the gateway's 75%-of-context ceiling.
const DEFAULT_CONTEXT_WINDOW = 32768;
const DEFAULT_MAX_TOKENS = Math.floor((DEFAULT_CONTEXT_WINDOW * 3) / 4);
// Per-turn output budget advertised to OpenClaw. Consistent with industry norms.
const OPENCLAW_MAX_OUTPUT_TOKENS = 8192;

export interface GuideModel {
  name: string;
  context_window?: number;
  max_tokens?: number;
}

export interface GuideContext {
  openaiBase: string;
  anthropicBase: string;
  apiKey: string;
  models: GuideModel[];
  activeModel: string;
}

export interface GuideSnippet {
  label: string;
  language: string;
  code: string;
  note?: string;
}

export interface Guide {
  intro: string;
  snippets: GuideSnippet[];
}

const isThinking = (name: string) => name.endsWith("-thinking");

const buildClaudeCodeGuide = ({
  anthropicBase,
  apiKey,
  activeModel,
}: GuideContext): Guide => ({
  intro:
    "Set these environment variables, then launch claude. Model discovery lets you switch models with the /model command.",
  snippets: [
    {
      label: "Quick setup",
      language: "bash",
      code: `export ANTHROPIC_BASE_URL=${anthropicBase}
export ANTHROPIC_AUTH_TOKEN=${apiKey}
export ANTHROPIC_MODEL=${activeModel}
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
claude`,
    },
  ],
});

const buildOpenCodeGuide = ({
  openaiBase,
  apiKey,
  models,
  activeModel,
}: GuideContext): Guide => {
  // OpenCode has no model discovery, so every deployed model is listed explicitly.
  const modelEntries = Object.fromEntries(
    models.map(({ name }) => [
      name,
      isThinking(name) ? { name, reasoning: true } : { name },
    ]),
  );
  const providerEntry = {
    npm: "@ai-sdk/openai-compatible",
    name: "TT-Studio",
    options: { baseURL: openaiBase, apiKey },
    models: modelEntries,
  };

  // Merge the provider into any existing config (creating it if absent), then launch.
  const setupScript = `python3 - <<'PY' && opencode --model tt-studio/${activeModel}
import json, pathlib
p = pathlib.Path.home() / ".config/opencode/opencode.json"
cfg = json.loads(p.read_text()) if p.exists() else {}
cfg.setdefault("provider", {})["tt-studio"] = json.loads('''${JSON.stringify(providerEntry)}''')
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(cfg, indent=2) + "\\n")
print(f"Updated {p}")
PY`;

  const config = JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      provider: { "tt-studio": providerEntry },
    },
    null,
    2,
  );

  return {
    intro:
      "Adds a tt-studio provider to your OpenCode config, keeping any existing one, and launches OpenCode on the selected model.",
    snippets: [
      { label: "Quick setup", language: "bash", code: setupScript },
      {
        label: "Config file",
        language: "json",
        code: config,
        note: "No Python? Save this to ~/.config/opencode/opencode.json yourself, then run opencode.",
      },
    ],
  };
};

const buildOpenClawGuide = ({
  openaiBase,
  apiKey,
  models,
  activeModel,
}: GuideContext): Guide => {
  // Like OpenCode, OpenClaw has no discovery, so models are listed explicitly.
  const providerEntry = {
    baseUrl: openaiBase,
    apiKey,
    api: "openai-completions",
    models: models.map((model) => ({
      id: model.name,
      name: model.name,
      input: ["text"],
      contextWindow: model.context_window ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: Math.min(
        model.max_tokens ?? DEFAULT_MAX_TOKENS,
        OPENCLAW_MAX_OUTPUT_TOKENS,
      ),
      ...(isThinking(model.name) ? { reasoning: true } : {}),
    })),
  };

  // Merge only the tt-studio provider into any existing openclaw.json, leaving
  // other providers / keys / plugins untouched. Memory search is disabled only
  // when the user hasn't already configured it.
  const setupScript = `python3 - <<'PY'
import json, pathlib
p = pathlib.Path.home() / ".openclaw/openclaw.json"
cfg = json.loads(p.read_text()) if p.exists() else {}
cfg.setdefault("models", {}).setdefault("providers", {})["tt-studio"] = json.loads('''${JSON.stringify(providerEntry)}''')
d = cfg.setdefault("agents", {}).setdefault("defaults", {})
d.setdefault("models", {})["tt-studio/*"] = {}
d.setdefault("model", {})["primary"] = "tt-studio/${activeModel}"
if "memorySearch" not in d:
    d["memorySearch"] = {"enabled": False}
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(cfg, indent=2) + "\\n")
print(f"Updated {p}")
PY`;

  const config = JSON.stringify(
    {
      models: { providers: { "tt-studio": providerEntry } },
      agents: {
        defaults: {
          // Allowlist the provider so its models show in the /model picker.
          models: { "tt-studio/*": {} },
          model: { primary: `tt-studio/${activeModel}` },
          // Memory search needs an embedding model; off by default here.
          memorySearch: { enabled: false },
        },
      },
    },
    null,
    2,
  );

  return {
    intro:
      "Merges a tt-studio model provider into ~/.openclaw/openclaw.json, leaving any other providers, keys, and plugins untouched.",
    snippets: [
      { label: "Quick setup", language: "bash", code: setupScript },
      {
        label: "Config file",
        language: "json",
        code: config,
        note: "No Python? Save this to ~/.openclaw/openclaw.json yourself.",
      },
    ],
  };
};

// Internal gateway URL, usable once Dify's containers share tt_studio_network.
const GATEWAY_INTERNAL_BASE = "http://tt-studio-litellm:4000/v1";

const buildDifyGuide = ({
  openaiBase,
  apiKey,
  models,
  activeModel,
}: GuideContext): Guide => {
  const model = models.find((m) => m.name === activeModel) ?? models[0];
  const contextSize = model?.context_window ?? DEFAULT_CONTEXT_WINDOW;
  const maxTokens = model?.max_tokens ?? DEFAULT_MAX_TOKENS;
  // Dify's containers resolve localhost to themselves, so the browser-facing
  // host is only usable when it isn't loopback (e.g. an SSH-forwarded session).
  const hostBase = openaiBase.replace(
    /\/\/(localhost|127\.0\.0\.1)(?=[:/])/,
    "//<tt-studio-host>",
  );

  return {
    intro:
      "Dify runs as its own Docker Compose stack, so it is started from its compose file rather than launched here. Two changes are needed before it works against TT-Studio: reaching our network, and turning collaboration mode off.",
    snippets: [
      {
        label: "Set up and start Dify",
        language: "bash",
        // The network is added through an override file rather than
        // `docker network connect`, which is lost whenever containers are
        // recreated. plugin_daemon matters most of the three: Dify 1.x runs model
        // providers as plugins there, so model calls originate from it, not api.
        code: `git clone https://github.com/langgenius/dify.git
cd dify/docker
cp .env.example .env

# Collaboration mode's Redis subscriber drops out repeatedly, which leaves the
# workflow editor stuck on "Syncing data…" with the canvas unclickable.
sed -i 's/^ENABLE_COLLABORATION_MODE=.*/ENABLE_COLLABORATION_MODE=false/' .env
sed -i 's/,collaboration//' .env

# Let the services that call models reach the gateway, across restarts.
cat > docker-compose.override.yaml <<'YAML'
services:
  api:
    networks: [default, ssrf_proxy_network, tt_studio_network]
  worker:
    networks: [default, ssrf_proxy_network, tt_studio_network]
  plugin_daemon:
    networks: [default, ssrf_proxy_network, tt_studio_network]
networks:
  tt_studio_network:
    external: true
YAML

docker compose up -d   # Dify's UI is then on http://localhost:80`,
        note: `Pulls roughly a dozen service images the first time; on macOS use sed -i '' rather than sed -i. Without the network override, saving credentials fails with "Failed to resolve tt-studio-litellm". If you would rather not join the network at all, use ${hostBase} in place of ${GATEWAY_INTERNAL_BASE} below — never localhost, which inside Dify's containers means Dify itself.`,
      },
      {
        label: "Add the model",
        language: "text",
        // Dify defaults context size and max tokens to 4096 and function calling
        // to no_call, which silently truncates prompts and disables agent tools.
        code: `Integrations -> Model Provider -> OpenAI-API-compatible -> Add Model

Model Name                  ${activeModel}
API Key                     ${apiKey}
API Base URL                ${GATEWAY_INTERNAL_BASE}
Completion mode             Chat
Model context size          ${contextSize}
Upper bound for max tokens  ${maxTokens}
Function Call Type          Tool Call
Vision Support              No Support${isThinking(activeModel)
            ? "\nThinking Mode Support       Supported"
            : ""
          }`,
        note: "Dify defaults the two size fields to 4096 and Function Call Type to No Call — leaving them would truncate long prompts and stop agents from using tools. Repeat for each model you want, using the model's own name.",
      },
      {
        label: "In each new app, pick the model",
        language: "text",
        // A new node's model is empty, and Dify's editor falls back to a
        // gpt-* model on the langgenius/openai plugin, which isn't installed.
        code: `Open the app -> click the LLM node -> choose ${activeModel} from the dropdown`,
        note: 'A freshly created node has no model set, and Dify falls back to a GPT model from its OpenAI plugin rather than your workspace default. Since that plugin is not installed, the editor sits on "Syncing data…" and its network calls return 400 until you select the model yourself. Same for any Agent, Question Classifier or Parameter Extractor node.',
      },
    ],
  };
};

export const GUIDE_BUILDERS: Record<string, (ctx: GuideContext) => Guide> = {
  dify: buildDifyGuide,
  "claude-code": buildClaudeCodeGuide,
  opencode: buildOpenCodeGuide,
  openclaw: buildOpenClawGuide,
};
