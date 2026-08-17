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

// Every gateway model is a chat model: TT-Studio's OpenAI surface serves
// /v1/chat/completions only, with no /v1/completions and so no fill-in-the-middle
// endpoint. Tools whose autocomplete needs FIM are told to keep that part local.
const NO_FIM_NOTE =
  "Inline autocomplete needs a fill-in-the-middle (FIM) completions endpoint, which the gateway does not serve — it exposes chat completions only. Keep completion on a local model and point chat, edit and refactor features at TT-Studio.";

const buildPiGuide = ({
  openaiBase,
  apiKey,
  models,
  activeModel,
}: GuideContext): Guide => {
  // Pi has no model discovery, so every deployed model is declared explicitly.
  // Costs are zero because the models run on your own hardware. compat turns off
  // two things the OpenAI API has that vLLM-backed servers do not: the developer
  // role, and reasoning_effort.
  const provider = {
    baseUrl: openaiBase,
    api: "openai-completions",
    apiKey,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    models: models.map((model) => ({
      id: model.name,
      name: model.name,
      reasoning: isThinking(model.name),
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.context_window ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: model.max_tokens ?? DEFAULT_MAX_TOKENS,
    })),
  };

  // Merge only the tt-studio provider into any existing models.json, leaving
  // other providers untouched. Pi re-reads the file whenever /model is opened.
  const setupScript = `python3 - <<'PY' && pi --model tt-studio/${activeModel}
import json, pathlib
p = pathlib.Path.home() / ".pi/agent/models.json"
cfg = json.loads(p.read_text()) if p.exists() else {}
cfg.setdefault("providers", {})["tt-studio"] = json.loads('''${JSON.stringify(provider)}''')
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(cfg, indent=2) + "\\n")
print(f"Updated {p}")
PY`;

  const config = JSON.stringify(
    { providers: { "tt-studio": provider } },
    null,
    2,
  );

  return {
    intro:
      "Pi reads custom providers from ~/.pi/agent/models.json. This merges a tt-studio provider into that file, keeping any others, and launches Pi on the selected model.",
    snippets: [
      {
        label: "Quick setup",
        language: "bash",
        code: setupScript,
        // The separator matters: pi reads provider/id, and treats ":" as the
        // thinking-level suffix (e.g. sonnet:high), not the provider separator.
        note: "Run pi --list-models to confirm the provider loaded, then switch models from inside Pi with /model. Model names are given as tt-studio/<model> — a colon there means a thinking level, not a provider.",
      },
      {
        label: "Config file",
        language: "json",
        code: config,
        note: "No Python? Save this to ~/.pi/agent/models.json yourself.",
      },
    ],
  };
};

const buildAiderGuide = ({ openaiBase, apiKey, activeModel }: GuideContext): Guide => ({
  intro:
    "Aider treats any OpenAI-compatible endpoint as its openai provider. The openai/ prefix on the model name is required — without it Aider routes the request to api.openai.com instead of your gateway.",
  snippets: [
    {
      label: "Quick setup",
      language: "bash",
      code: `export OPENAI_API_BASE=${openaiBase}
export OPENAI_API_KEY=${apiKey}
aider --model openai/${activeModel}`,
    },
    {
      label: "Config file",
      language: "yaml",
      code: `openai-api-base: ${openaiBase}
openai-api-key: ${apiKey}
model: openai/${activeModel}`,
      note: "Save as ~/.aider.conf.yml to make it the default for every project, or as .aider.conf.yml in one repo. Aider warns that it does not know the model's context limits; that is cosmetic.",
    },
  ],
});

const buildContinueGuide = ({
  openaiBase,
  apiKey,
  models,
  activeModel,
}: GuideContext): Guide => {
  // Ordered so the model selected on this page is Continue's default.
  const ordered = [
    ...models.filter((m) => m.name === activeModel),
    ...models.filter((m) => m.name !== activeModel),
  ];
  const modelEntries = ordered.map(({ name }) => ({
    name,
    provider: "openai",
    model: name,
    apiBase: openaiBase,
    apiKey,
    roles: ["chat", "edit", "apply"],
  }));

  const config = `name: TT-Studio
version: 0.0.1
schema: v1
models:
${ordered
      .map(
        ({ name }) => `  - name: ${name}
    provider: openai
    model: ${name}
    apiBase: ${openaiBase}
    apiKey: ${apiKey}
    roles:
      - chat
      - edit
      - apply`,
      )
      .join("\n")}
`;

  // Merges the models into config.yaml rather than replacing it: Continue
  // auto-discovers that one file only — YAML dropped into ~/.continue/agents or
  // ~/.continue/assistants is not loaded — so a separate tt-studio.yaml would
  // never be read. Re-running replaces our own entries instead of duplicating
  // them, and the previous file is kept as config.yaml.bak.
  const setupScript = `python3 - <<'PY'
import json, pathlib, yaml
p = pathlib.Path.home() / ".continue/config.yaml"
cfg = yaml.safe_load(p.read_text()) if p.exists() else None
cfg = cfg if isinstance(cfg, dict) else {}
for key, value in (("name", "My Config"), ("version", "0.0.1"), ("schema", "v1")):
    cfg.setdefault(key, value)
new = json.loads('''${JSON.stringify(modelEntries)}''')
names = {m["name"] for m in new}
# Ours first: Continue picks the first chat model as the default.
cfg["models"] = new + [
    m for m in (cfg.get("models") or []) if m.get("name") not in names
]
p.parent.mkdir(parents=True, exist_ok=True)
if p.exists():
    p.with_name("config.yaml.bak").write_text(p.read_text())
p.write_text(yaml.safe_dump(cfg, sort_keys=False))
print(f"Updated {p}")
PY`;

  return {
    intro:
      "Continue reads one config file, ~/.continue/config.yaml, in both VS Code and JetBrains. This merges your deployed models into it, leaving any models you already had in place.",
    snippets: [
      {
        label: "Quick setup",
        language: "bash",
        code: setupScript,
        note: "Reload your editor and the models appear in the Continue panel's model dropdown. Needs PyYAML (pip install pyyaml) — without it, use the Config file tab instead. Rewriting the file through a YAML parser drops any comments you had in it; the original is kept as config.yaml.bak.",
      },
      {
        label: "Config file",
        language: "yaml",
        code: config,
        note: `${NO_FIM_NOTE} Over a remote-SSH session, run the setup on whichever machine the Continue extension is installed on — that is where it reads ~/.continue/config.yaml, and it is the laptop unless the extension is installed on the remote host. Either way apiBase has to be reachable from that machine: forward the gateway port over SSH, or use the TT-Studio host's address in place of localhost.`,
      },
    ],
  };
};

const buildVsCodeAgentGuide = (
  appName: string,
  panelPath: string,
  extra?: string,
) => ({ openaiBase, apiKey, activeModel }: GuideContext): Guide => ({
  intro: `${appName} stores model credentials in its own settings panel rather than a config file, so these three values are entered once in the extension. In a remote-SSH window the Base URL is resolved from wherever the extension is installed — on the remote host it reaches the gateway directly, on the laptop it needs the gateway port forwarded.`,
  snippets: [
    {
      label: "Add the provider",
      language: "text",
      code: `${panelPath}

API Provider    OpenAI Compatible
Base URL        ${openaiBase}
API Key         ${apiKey}
Model ID        ${activeModel}`,
      note: extra,
    },
  ],
});


export const GUIDE_BUILDERS: Record<string, (ctx: GuideContext) => Guide> = {
  dify: buildDifyGuide,
  "claude-code": buildClaudeCodeGuide,
  opencode: buildOpenCodeGuide,
  openclaw: buildOpenClawGuide,
  pi: buildPiGuide,
  aider: buildAiderGuide,
  continue: buildContinueGuide,
  cline: buildVsCodeAgentGuide(
    "Cline",
    "Cline panel -> settings (gear) -> API Configuration",
    "Leave the OpenAI-compatible defaults for everything else. Cline sends long system prompts, so prefer a model with a large context window.",
  ),
};
