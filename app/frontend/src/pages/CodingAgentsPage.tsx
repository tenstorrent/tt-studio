// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Terminal, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Badge } from "../components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Spinner } from "../components/ui/spinner";
import CopyableText from "../components/CopyableText";
import CodeBlock from "../components/chatui/CodeBlock";
import {
  fetchCodingAgentsInfo,
  type CodingAgentsInfo,
} from "../api/modelsDeployedApis";

const PLACEHOLDER_MODEL = "your-model-name";

export default function CodingAgentsPage() {
  const [info, setInfo] = useState<CodingAgentsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchCodingAgentsInfo();
        if (!cancelled) setInfo(data);
      } catch (e) {
        if (!cancelled)
          setError(
            "Could not reach the TT-Studio backend to load gateway info.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    // Refresh periodically so the model list / health stay current.
    const id = setInterval(load, 7000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Host-aware URLs so port-forwarded / remote access works (never hardcode localhost).
  const { anthropicBase, openaiBase, firstModel } = useMemo(() => {
    const host = window.location.hostname;
    const port = info?.gateway_port ?? 4000;
    const basePath = info?.openai_base_path ?? "/v1";
    return {
      anthropicBase: `http://${host}:${port}`,
      openaiBase: `http://${host}:${port}${basePath}`,
      firstModel: info?.models?.[0]?.name ?? PLACEHOLDER_MODEL,
    };
  }, [info]);

  const masterKey = info?.master_key || "";
  const hasModels = (info?.models?.length ?? 0) > 0;

  const claudeCodeSnippet = `export ANTHROPIC_BASE_URL=${anthropicBase}
export ANTHROPIC_AUTH_TOKEN=${masterKey || "<your-api-key>"}
export ANTHROPIC_MODEL=${firstModel}
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
claude`;

  const curlSnippet = `curl ${openaiBase}/chat/completions \\
  -H "Authorization: Bearer ${masterKey || "<your-api-key>"}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${firstModel}",
    "messages": [{"role": "user", "content": "Write a hello world in Python"}]
  }'`;

  const renderHealth = () => {
    if (!info) return null;
    if (info.health === "healthy")
      return (
        <Badge className="bg-TT-green-tint2 text-TT-green-shade border-TT-green flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" /> Gateway online
        </Badge>
      );
    if (info.health === "disabled")
      return (
        <Badge variant="outline" className="flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> Gateway disabled
        </Badge>
      );
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <XCircle className="h-3.5 w-3.5" /> Gateway unreachable
      </Badge>
    );
  };

  return (
    <div className="w-full min-h-screen overflow-y-auto dark:bg-black bg-white pl-[4.5rem] lg:pl-32 pr-4 py-10">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Terminal className="h-7 w-7 text-TT-purple" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Coding Agents
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Connect Claude Code or any OpenAI-compatible client to your
              locally deployed models.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-3 text-gray-500">
            <Spinner /> Loading gateway info…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && info && (
          <>
            {/* Status / connection card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Gateway</CardTitle>
                  {renderHealth()}
                </div>
                <CardDescription>
                  One endpoint and one API key for every deployed chat model.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {info.health === "unreachable" && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Gateway not reachable yet</AlertTitle>
                    <AlertDescription>
                      The LiteLLM gateway may still be starting. If this
                      persists, ensure the <code>tt_studio_litellm</code>{" "}
                      service is running.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                      Base URL (OpenAI)
                    </div>
                    <div className="font-mono text-sm rounded-md bg-gray-100 dark:bg-gray-900 px-3 py-2">
                      <CopyableText text={openaiBase} />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                      Base URL (Anthropic / Claude Code)
                    </div>
                    <div className="font-mono text-sm rounded-md bg-gray-100 dark:bg-gray-900 px-3 py-2">
                      <CopyableText text={anthropicBase} />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                    API Key
                  </div>
                  <div className="font-mono text-sm rounded-md bg-gray-100 dark:bg-gray-900 px-3 py-2">
                    <CopyableText text={masterKey || "(not configured)"} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Available models */}
            <Card>
              <CardHeader>
                <CardTitle>Available models</CardTitle>
                <CardDescription>
                  Use one of these names as the model in your coding agent.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {hasModels ? (
                  <div className="flex flex-wrap gap-2">
                    {info.models.map((m) => (
                      <span
                        key={m.name}
                        className="inline-flex items-center gap-2 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-1.5 font-mono text-sm"
                      >
                        <CopyableText text={m.name} isInsideButton />
                        <Badge variant="outline" className="text-[10px]">
                          {m.type}
                        </Badge>
                      </span>
                    ))}
                  </div>
                ) : (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>No chat models deployed</AlertTitle>
                    <AlertDescription>
                      Deploy a chat or VLM model first, then it will appear here
                      automatically.{" "}
                      <Link
                        to="/models-deployed"
                        className="text-TT-purple underline"
                      >
                        Go to Models Deployed
                      </Link>
                      .
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Setup instructions */}
            <Card>
              <CardHeader>
                <CardTitle>Setup</CardTitle>
                <CardDescription>
                  Pick your tool and paste the configuration.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="claude-code" className="w-full">
                  <TabsList>
                    <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
                    <TabsTrigger value="openai">OpenAI / cURL</TabsTrigger>
                  </TabsList>

                  <TabsContent value="claude-code" className="space-y-3">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Set these environment variables, then launch{" "}
                      <code>claude</code>. Model discovery lets you switch models
                      with the <code>/model</code> command.
                    </p>
                    <CodeBlock code={claudeCodeSnippet} language="bash" />
                  </TabsContent>

                  <TabsContent value="openai" className="space-y-3">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      Any OpenAI-compatible client works against the base URL
                      above. Example request:
                    </p>
                    <CodeBlock code={curlSnippet} language="bash" />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
