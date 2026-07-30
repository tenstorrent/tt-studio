// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Download, AlertTriangle, CheckCircle2, Loader2, Square } from "lucide-react";

import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { customToast } from "../components/CustomToaster";

const dockerAPIURL = "/docker-api/";

interface ModelInfo {
  repo_id: string;
  architecture: string;
  model_type: string;
  param_count: number | null;
  estimated_gb: number | null;
  max_position_embeddings: number | null;
  has_chat_template: boolean;
  total_chips?: number;
}

type Phase = "idle" | "checking" | "checked" | "launching" | "launched" | "rejected";

interface RunningStatus {
  running: boolean;
  model?: string;
  port?: number;
}

export default function ForgeLoaderPage() {
  const navigate = useNavigate();
  const [modelCardUrl, setModelCardUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState<RunningStatus | null>(null);
  const [stopping, setStopping] = useState(false);

  const busy = phase === "checking" || phase === "launching";

  // Only one bare-metal Forge model can run at a time (a device-masking bug means any
  // chip but 0 fails outright), so show what's already running instead of the input --
  // otherwise "Compile and serve" would just 409.
  const refreshRunningStatus = async () => {
    try {
      const { data } = await axios.get<RunningStatus>(`${dockerAPIURL}forge-loader/status/`);
      setRunning(data.running ? data : null);
    } catch {
      // inference-api unreachable — fall back to the normal input; deploy will surface
      // the same error if it's actually down.
      setRunning(null);
    }
  };

  useEffect(() => {
    refreshRunningStatus();
  }, []);

  const handleStop = async () => {
    setStopping(true);
    try {
      await axios.post(`${dockerAPIURL}forge-loader/stop/`);
      customToast.success("Stopped.");
      setRunning(null);
      setPhase("idle");
      setModel(null);
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.message ?? error.message
        : "Stop failed.";
      customToast.error(detail);
    } finally {
      setStopping(false);
    }
  };

  // Preflight first: it rejects models Forge cannot compile (hybrid / linear-attention
  // architectures) and models too large to fit, so the user finds out in seconds rather
  // than after a ten-minute compile.
  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = modelCardUrl.trim();
    if (!url) return;
    setPhase("checking");
    setMessage(null);
    setModel(null);
    try {
      const { data } = await axios.post(`${dockerAPIURL}forge-loader/preflight/`, {
        model_card_url: url,
      });
      setModel(data.model);
      setPhase("checked");
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.message ?? error.message
        : "Preflight failed.";
      setMessage(detail);
      setPhase("rejected");
    }
  };

  const handleLoad = async () => {
    if (!model) return;
    setPhase("launching");
    setMessage(null);
    try {
      // The backend launches this bare metal (no container) and registers it itself
      // once it starts answering, so there is nothing further to call here.
      await axios.post(`${dockerAPIURL}forge-loader/deploy/`, {
        model_card_url: modelCardUrl.trim(),
      });
      setPhase("launched");
      customToast.success(`${model.repo_id} is compiling — this takes a few minutes.`);
      refreshRunningStatus();
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? error.response?.data?.message ?? error.message
        : "Launch failed.";
      setMessage(detail);
      setPhase("rejected");
    }
  };

  return (
    <div className="flex flex-col w-full min-h-screen bg-grid-pattern dark:bg-grid-pattern-dark">
      <div className="flex grow justify-center w-full pt-16 pb-0">
        <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto px-6 md:px-8 lg:px-12 pt-8 pb-16 md:pt-12 md:pb-24">
          <Card className="h-auto py-8 px-8 md:px-12 lg:px-16 border-2">
            <CardContent className="p-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 rounded-lg bg-TT-purple/10 text-TT-purple">
                  <Download className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-semibold text-gray-800 dark:text-white">
                  Forge Loader
                </h1>
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                Paste a Hugging Face model card. Forge compiles the model for this machine
                and serves it — no catalog entry or hand-written support needed.
              </p>

              {/* Only one bare-metal Forge model can run at a time. Show it (with a way to
                  free the slot) instead of an input that would just 409. */}
              {running?.running && (
                <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border-2 border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-950">
                  <div>
                    <span className="font-semibold text-gray-800 dark:text-white">
                      Running on bare metal:{" "}
                    </span>
                    <span className="font-mono">{running.model}</span>
                    {running.port && (
                      <span className="text-gray-500 dark:text-gray-400">
                        {" "}
                        (port {running.port})
                      </span>
                    )}
                  </div>
                  <Button variant="outline" onClick={handleStop} disabled={stopping}>
                    {stopping ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Stopping
                      </>
                    ) : (
                      <>
                        <Square className="mr-2 h-3.5 w-3.5" /> Stop
                      </>
                    )}
                  </Button>
                </div>
              )}

              <form onSubmit={handleCheck} className="flex flex-col gap-3 sm:flex-row">
                <Input
                  type="text"
                  value={modelCardUrl}
                  onChange={(e) => {
                    setModelCardUrl(e.target.value);
                    if (phase !== "idle") setPhase("idle");
                  }}
                  placeholder="https://huggingface.co/ibm-granite/granite-4.1-8b"
                  aria-label="Hugging Face model card URL"
                  className="flex-1"
                  disabled={busy || running?.running}
                />
                <Button type="submit" disabled={busy || running?.running || !modelCardUrl.trim()}>
                  {phase === "checking" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking
                    </>
                  ) : (
                    "Check"
                  )}
                </Button>
              </form>

              {/* Rejected: Forge can't compile it, or it won't fit */}
              {phase === "rejected" && message && (
                <div className="mt-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <p>{message}</p>
                </div>
              )}

              {/* Passed preflight: show what we found, offer to compile */}
              {model && (phase === "checked" || phase === "launching") && (
                <div className="mt-6 rounded-lg border-2 border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-950">
                  <div className="flex items-center gap-2 mb-3 font-semibold">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span>Supported</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-gray-600 dark:text-gray-300">
                    <dt>Model</dt>
                    <dd className="font-mono break-all">{model.repo_id}</dd>
                    <dt>Architecture</dt>
                    <dd className="font-mono">{model.architecture}</dd>
                    {model.estimated_gb && (
                      <>
                        <dt>Size</dt>
                        <dd>~{model.estimated_gb} GB at 8-bit</dd>
                      </>
                    )}
                    <dt>Chat</dt>
                    <dd>
                      {model.has_chat_template
                        ? "chat template found"
                        : "no chat template — completions only"}
                    </dd>
                  </dl>
                  <Button className="mt-4" onClick={handleLoad} disabled={busy}>
                    {phase === "launching" ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Launching
                      </>
                    ) : (
                      "Compile and serve"
                    )}
                  </Button>
                </div>
              )}

              {/* Launched: compiling in the background */}
              {phase === "launched" && model && (
                <div className="mt-6 rounded-lg border-2 border-stone-200 bg-white p-4 text-sm dark:border-stone-800 dark:bg-stone-950">
                  <div className="flex items-center gap-2 mb-2 font-semibold">
                    <Loader2 className="h-4 w-4 animate-spin text-TT-purple" />
                    <span>Compiling {model.repo_id}</span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300">
                    Weights are downloading and the graph is being compiled and traced.
                    This takes several minutes on a first run; the model becomes available
                    once it finishes warming up.
                  </p>
                  <div className="mt-4 flex gap-3">
                    <Button variant="outline" onClick={() => navigate("/models-deployed")}>
                      View deployed models
                    </Button>
                    <Button onClick={() => navigate("/chat")}>Open chat</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
