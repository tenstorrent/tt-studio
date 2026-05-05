// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  Mic,
  Volume2,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Zap,
  FlaskConical,
  Info,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Button } from "./ui/button";
import { customToast } from "./CustomToaster";
import { Model, getModelsUrl } from "./SelectionSteps";

// ---- types ----------------------------------------------------------------

interface DeployState {
  status: "idle" | "deploying" | "done" | "error";
  error?: string;
}

interface OccupiedDevice {
  device_id: number;
  name: string;
}

interface VoiceAgentSolutionStepProps {
  onBack: () => void;
}

// ---- constants ------------------------------------------------------------

const STATUS_CONFIG = {
  COMPLETE: {
    label: "Complete",
    icon: CheckCircle2,
    color: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-900/20",
  },
  FUNCTIONAL: {
    label: "Functional",
    icon: Zap,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
  },
  EXPERIMENTAL: {
    label: "Experimental",
    icon: FlaskConical,
    color: "text-amber-500",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
  },
};

const STATUS_ORDER: Record<string, number> = { COMPLETE: 3, FUNCTIONAL: 2, EXPERIMENTAL: 1 };

// ---- helpers --------------------------------------------------------------


async function pollDeployProgress(jobId: string): Promise<"done" | "error"> {
  const POLL_INTERVAL_MS = 5000;
  // Wait for terminal status so cards only mark as deployed after container startup.
  // Keep a long safety timeout so a stalled backend does not leave UI stuck forever.
  const SAFETY_TIMEOUT_MS = 30 * 60 * 1000;
  const deadline = Date.now() + SAFETY_TIMEOUT_MS;
  const TERMINAL_ERRORS = ["error", "failed", "cancelled", "timeout", "not_found"];
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`/docker-api/deploy/progress/${jobId}/`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.status === "completed") return "done";
        if (TERMINAL_ERRORS.includes(data.status)) return "error";
      }
    } catch (_) {
      // network hiccup — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return "error";
}

async function deployOneModel(modelId: string, deviceId: number): Promise<{ jobId?: string; error?: string }> {
  const resp = await fetch("/docker-api/deploy/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, weights_id: "", device_id: deviceId }),
  });
  const data = await resp.json();
  if (data.status === "error") return { error: data.message || "Deployment failed" };
  return { jobId: data.job_id };
}

type CompatGroup = { compatible: Model[]; incompatible: Model[]; unknown: Model[] };
function groupByStatus(models: Model[]): Record<string, CompatGroup> {
  const grouped: Record<string, CompatGroup> = {};
  for (const model of models) {
    const s = model.status || "EXPERIMENTAL";
    if (!grouped[s]) grouped[s] = { compatible: [], incompatible: [], unknown: [] };
    if (model.is_compatible === true) grouped[s].compatible.push(model);
    else if (model.is_compatible === false) grouped[s].incompatible.push(model);
    else grouped[s].unknown.push(model);
  }
  return grouped;
}

// ---- ModelSelectItems -----------------------------------------------------

function ModelSelectItems({ models }: { models: Model[] }) {
  const grouped = groupByStatus(models);
  if (models.length === 0) return (
    <div className="px-2 py-3 text-center text-xs text-muted-foreground">No models available</div>
  );
  return (
    <>
      {Object.entries(grouped)
        .sort(([a], [b]) => (STATUS_ORDER[b] ?? 0) - (STATUS_ORDER[a] ?? 0))
        .map(([modelStatus, byCompat]) => {
          const cfg = STATUS_CONFIG[modelStatus as keyof typeof STATUS_CONFIG];
          const Icon = cfg?.icon ?? FlaskConical;
          const hasAny = byCompat.compatible.length + byCompat.incompatible.length + byCompat.unknown.length > 0;
          if (!hasAny) return null;
          return (
            <div key={modelStatus}>
              <div className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${cfg?.color ?? "text-gray-600"} ${cfg?.bgColor ?? "bg-gray-50 dark:bg-gray-900/20"}`}>
                <Icon className="w-3 h-3" /><span>{cfg?.label ?? modelStatus}</span>
              </div>
              {byCompat.compatible.map((m) => (
                <SelectItem key={m.id} value={m.id} className="pl-8 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden">
                  <div className="flex items-center w-full">
                    <span className="text-green-500 mr-2 text-xs">●</span>
                    <span className="flex-1">{m.name}</span>
                    <span className="text-xs text-green-600 ml-2">Compatible</span>
                  </div>
                </SelectItem>
              ))}
              {byCompat.unknown.map((m) => (
                <SelectItem key={m.id} value={m.id} className="pl-8 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden">
                  <div className="flex items-center w-full">
                    <span className="text-yellow-500 mr-2 text-xs">●</span>
                    <span className="flex-1">{m.name}</span>
                    <span className="text-xs text-yellow-600 ml-2">Unknown</span>
                  </div>
                </SelectItem>
              ))}
              {byCompat.incompatible.map((m) => (
                <SelectItem key={m.id} value={m.id} disabled className="pl-8 opacity-50 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden">
                  <div className="flex items-center w-full">
                    <span className="text-red-500 mr-2 text-xs">●</span>
                    <span className="text-gray-500 flex-1">{m.name}</span>
                    <span className="text-xs text-red-500 ml-2">Incompatible</span>
                  </div>
                </SelectItem>
              ))}
            </div>
          );
        })}
    </>
  );
}

// ---- main component -------------------------------------------------------

const AUTO_REDIRECT_MS = 3000;

export function VoiceAgentSolutionStep({ onBack }: VoiceAgentSolutionStepProps) {
  const navigate = useNavigate();
  const [allModels, setAllModels] = useState<Model[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [occupiedDevices, setOccupiedDevices] = useState<OccupiedDevice[]>([]);

  const [selectedLlmId, setSelectedLlmId] = useState<string>("");
  const [selectedWhisperId, setSelectedWhisperId] = useState<string>("");
  const [speechT5Id, setSpeechT5Id] = useState<string>("");

  const [llmState, setLlmState] = useState<DeployState>({ status: "idle" });
  const [whisperState, setWhisperState] = useState<DeployState>({ status: "idle" });
  const [ttsState, setTtsState] = useState<DeployState>({ status: "idle" });

  const [isDeploying, setIsDeploying] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_REDIRECT_MS / 1000);

  useEffect(() => {
    const loadModels = fetch(getModelsUrl)
      .then((r) => r.json())
      .then((models: Model[]) => {
        setAllModels(models);
        const singleDeviceBoards = ["n150", "n300"];
        const isSingleDevice = (m: Model) =>
          (m.chips_required ?? 1) === 1 &&
          m.compatible_boards.some((b) => singleDeviceBoards.includes(b.toLowerCase()));
        const singleChip = (m: Model) => (m.chips_required ?? 1) === 1;
        const firstCompat = (type: string) => {
          const filter = type === "chat" ? isSingleDevice : singleChip;
          return (
            models.find((m) => m.model_type === type && filter(m) && m.is_compatible === true)?.id ??
            models.find((m) => m.model_type === type && filter(m))?.id ?? ""
          );
        };
        setSelectedLlmId(firstCompat("chat"));
        setSelectedWhisperId(firstCompat("speech_recognition"));
        setSpeechT5Id(firstCompat("tts"));
      })
      .catch(() => customToast.error("Failed to load model catalog"));

    const loadSlots = fetch("/docker-api/status/")
      .then((r) => r.json())
      .then((data: Record<string, { name: string; device_id?: number | null }>) => {
        const occupied = Object.values(data)
          .filter((c) => c.device_id != null)
          .map((c) => ({ device_id: c.device_id as number, name: c.name }));
        setOccupiedDevices(occupied);
      })
      .catch(() => { /* non-fatal — just no pre-flight warnings */ });

    Promise.all([loadModels, loadSlots]).finally(() => setLoadingModels(false));
  }, []);

  // Auto-redirect countdown after all done
  useEffect(() => {
    if (!allDone) return;
    setCountdown(AUTO_REDIRECT_MS / 1000);
    const tick = setInterval(() => setCountdown((c) => c - 1), 1000);
    const redirect = setTimeout(() => navigate("/models-deployed"), AUTO_REDIRECT_MS);
    return () => { clearInterval(tick); clearTimeout(redirect); };
  }, [allDone, navigate]);

  const SINGLE_DEVICE_BOARDS = ["n150", "n300"];
  const isSingleDevice = (m: Model) =>
    (m.chips_required ?? 1) === 1 &&
    m.compatible_boards.some((b) => SINGLE_DEVICE_BOARDS.includes(b.toLowerCase()));
  const isSingleChip = (m: Model) => (m.chips_required ?? 1) === 1;
  const chatModels = allModels.filter((m) => m.model_type === "chat" && isSingleDevice(m));
  const whisperModels = allModels.filter((m) => m.model_type === "speech_recognition" && isSingleChip(m));
  const ttsModels = allModels.filter((m) => m.model_type === "tts" && isSingleChip(m));
  const speechT5Model = allModels.find((m) => m.id === speechT5Id);

  const hasErrors =
    llmState.status === "error" ||
    whisperState.status === "error" ||
    ttsState.status === "error";

  const occupiedByDevice = (id: number) => occupiedDevices.find((d) => d.device_id === id);
  const occupiedSlots = ([0, 1, 2] as const)
    .map((id) => occupiedByDevice(id))
    .filter((d): d is OccupiedDevice => d !== undefined);

  const canDeploy =
    !isDeploying && !allDone && !!selectedLlmId && !!selectedWhisperId && !!speechT5Id;

  const handleDeploy = async () => {
    if (!selectedLlmId || !selectedWhisperId || !speechT5Id) {
      customToast.error("Some models are not available in the catalog");
      return;
    }
    setIsDeploying(true);

    const submitOne = async (
      modelId: string,
      deviceId: number,
      setState: (s: DeployState) => void,
      currentState: DeployState,
      label: string,
      pollProgress: boolean = false
    ) => {
      // Skip already-deployed cards on retry
      if (currentState.status === "done") return true;
      setState({ status: "deploying" });
      try {
        const result = await deployOneModel(modelId, deviceId);
        if (result.error || !result.jobId) {
          setState({ status: "error", error: result.error ?? "No job ID returned" });
          return false;
        }
        if (pollProgress) {
          const outcome = await pollDeployProgress(result.jobId);
          if (outcome === "error") {
            setState({ status: "error", error: "Deployment failed or timed out" });
            return false;
          }
        }
        setState({ status: "done" });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Deployment request failed";
        setState({ status: "error", error: message });
        return false;
      }
    };

    const steps: [string, number, (s: DeployState) => void, DeployState, string, boolean][] = [
      [selectedLlmId,    0, setLlmState,     llmState,     "LLM",      true],
      [selectedWhisperId, 1, setWhisperState, whisperState, "Whisper",  true],
      [speechT5Id,       2, setTtsState,     ttsState,     "SpeechT5", true],
    ];

    const results = await Promise.all(
      steps.map(async ([modelId, deviceId, setState, currentState, label, poll]) => ({
        label,
        ok: await submitOne(modelId, deviceId, setState, currentState, label, poll),
      }))
    );

    const failures = results.filter((r) => !r.ok);
    setIsDeploying(false);
    if (failures.length === 0) {
      setAllDone(true);
      customToast.success("Voice Agent pipeline submitted! Redirecting…");
      return;
    }

    customToast.error(
      `Deployed ${results.length - failures.length}/${results.length} — failed: ${failures
        .map((f) => f.label)
        .join(", ")}`
    );
  };

  return (
    <>
      {/* Keyframes */}
      <style>{`
        @keyframes va-pop { 0%,100%{transform:scale(1)} 50%{transform:scale(1.025)} }
        @keyframes va-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
        @keyframes va-shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
        @keyframes va-glow-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,0)} 50%{box-shadow:0 0 20px 4px rgba(74,222,128,0.35)} }
      `}</style>

      <div className="flex flex-col gap-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="w-4 h-4" />Back
        </button>

        <div>
          <h2 className="text-lg font-semibold mb-1">Voice Agent Solution</h2>
          <p className="text-sm text-muted-foreground">
            Deploys the full voice pipeline: LLM on device 0, Whisper on device 1, SpeechT5 on device 2.
          </p>
        </div>

        {loadingModels ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />Loading model catalog…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ModelCard icon={<Bot className="w-5 h-5" />} label="LLM" deviceLabel="Device 0" deployState={llmState} accent="blue" occupiedBy={occupiedByDevice(0)?.name}>
                <Select value={selectedLlmId} onValueChange={setSelectedLlmId} disabled={isDeploying || allDone}>
                  <SelectTrigger className="w-full text-xs h-8"><SelectValue placeholder="Select LLM" /></SelectTrigger>
                  <SelectContent><ModelSelectItems models={chatModels} /></SelectContent>
                </Select>
              </ModelCard>

              <ModelCard icon={<Mic className="w-5 h-5" />} label="Whisper" deviceLabel="Device 1" deployState={whisperState} accent="purple" occupiedBy={occupiedByDevice(1)?.name}>
                <Select value={selectedWhisperId} onValueChange={setSelectedWhisperId} disabled={isDeploying || allDone}>
                  <SelectTrigger className="w-full text-xs h-8"><SelectValue placeholder="Select Whisper" /></SelectTrigger>
                  <SelectContent><ModelSelectItems models={whisperModels} /></SelectContent>
                </Select>
              </ModelCard>

              <ModelCard icon={<Volume2 className="w-5 h-5" />} label="SpeechT5 TTS" deviceLabel="Device 2" deployState={ttsState} accent="green" occupiedBy={occupiedByDevice(2)?.name}>
                {ttsModels.length > 1 ? (
                  <Select value={speechT5Id} onValueChange={setSpeechT5Id} disabled={isDeploying || allDone}>
                    <SelectTrigger className="w-full text-xs h-8"><SelectValue placeholder="Select TTS" /></SelectTrigger>
                    <SelectContent><ModelSelectItems models={ttsModels} /></SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center h-8 px-3 rounded-md border border-input bg-muted/50 text-xs text-muted-foreground">
                    {speechT5Model?.name ?? "speecht5_tts"}
                    <span className="ml-auto text-[10px] opacity-60">fixed</span>
                  </div>
                )}
              </ModelCard>
            </div>

            {occupiedSlots.length > 0 && !isDeploying && !allDone && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-300/50 dark:border-amber-700/50 bg-amber-50/80 dark:bg-amber-900/20 px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="flex-1 text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                  <span className="font-semibold">Slots may be in use: </span>
                  {occupiedSlots.map((d) => `Device ${d.device_id} (${d.name})`).join(", ")}
                  {" — deployment will fail if these are still running."}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/models-deployed")}
                  className="shrink-0 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                >
                  Go to Models Deployed
                </Button>
              </div>
            )}

            {hasErrors && !allDone && !isDeploying && (
              <div className="flex items-start gap-3 rounded-lg border border-red-300/50 dark:border-red-700/50 bg-red-50/80 dark:bg-red-900/20 px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <div className="flex-1 text-sm text-red-800 dark:text-red-300 leading-relaxed">
                  <span className="font-semibold">Some deployments failed.</span>{" "}
                  Check the error on each card. Already-submitted models won't be re-sent.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDeploy}
                  className="shrink-0 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
                >
                  Retry failed
                </Button>
              </div>
            )}

            {allDone ? (
              <div className="flex flex-col gap-3 pt-2">
                {/* Info banner */}
                <div className="flex items-start gap-3 rounded-lg border border-green-300/50 dark:border-green-700/50 bg-green-50/80 dark:bg-green-900/20 px-4 py-3">
                  <Info className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                  <div className="text-sm text-green-800 dark:text-green-300 leading-relaxed">
                    <span className="font-semibold">Models are starting up.</span>{" "}
                    Head to <span className="font-medium">Models Deployed</span> to wait until they're healthy, then launch the Voice Agent.
                    <span className="ml-1 text-xs opacity-70">(Redirecting in {countdown}s…)</span>
                  </div>
                </div>
                {/* Action buttons */}
                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => navigate("/models-deployed")}
                    className="flex items-center gap-2"
                    style={{ animation: "va-glow-pulse 1.6s ease-in-out 2" }}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    View Models Deployed
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => navigate("/voice-agent")}
                    className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                  >
                    Open Voice Agent <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="pt-2">
                <Button
                  onClick={handleDeploy}
                  disabled={!canDeploy}
                  className="flex items-center gap-2 relative overflow-hidden"
                  style={isDeploying ? {
                    background: "linear-gradient(90deg, var(--tw-gradient-stops))",
                    backgroundImage: "linear-gradient(90deg, #7c68fa 0%, #a78bfa 40%, #7c68fa 60%, #6d55f5 100%)",
                    backgroundSize: "200% auto",
                    animation: "va-shimmer 1.8s linear infinite",
                  } : undefined}
                >
                  {isDeploying && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isDeploying ? "Deploying…" : "Deploy Voice Agent"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ---- ModelCard ------------------------------------------------------------

type CardAccent = "blue" | "purple" | "green";

const ACCENT_IDLE: Record<CardAccent, { border: string; badge: string; icon: string }> = {
  blue:   { border: "border-TT-blue/30 dark:border-TT-blue/40",     badge: "bg-TT-blue/10 text-TT-blue dark:bg-TT-blue/20",         icon: "text-TT-blue" },
  purple: { border: "border-TT-purple/30 dark:border-TT-purple/40", badge: "bg-TT-purple/10 text-TT-purple dark:bg-TT-purple/20",   icon: "text-TT-purple" },
  green:  { border: "border-green-400/30 dark:border-green-500/30", badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", icon: "text-green-600 dark:text-green-400" },
};

function stateClasses(state: DeployState["status"], accent: CardAccent): { wrapper: string; extra?: React.CSSProperties } {
  switch (state) {
    case "deploying":
      return { wrapper: "border-blue-400/70 bg-blue-500/5 ring-2 ring-blue-400/30 ring-offset-0 animate-pulse" };
    case "done":
      return { wrapper: "border-green-400/70 bg-green-500/[0.07] dark:bg-green-500/10", extra: { animation: "va-pop 0.35s ease" } };
    case "error":
      return { wrapper: "border-red-400/60 bg-red-500/5", extra: { animation: "va-shake 0.4s ease" } };
    default:
      return { wrapper: ACCENT_IDLE[accent].border };
  }
}

function ModelCard({ icon, label, deviceLabel, deployState, accent, occupiedBy, children }: {
  icon: ReactNode; label: string; deviceLabel: string;
  deployState: DeployState; accent: CardAccent; occupiedBy?: string; children: ReactNode;
}) {
  const idle = ACCENT_IDLE[accent];
  const { wrapper, extra } = stateClasses(deployState.status, accent);

  return (
    <div
      className={`rounded-xl border-[2px] p-4 flex flex-col gap-3 bg-white/60 dark:bg-stone-900/60 backdrop-blur-sm transition-all duration-500 ${wrapper}`}
      style={extra}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={idle.icon}>{icon}</span>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${idle.badge}`}>
          {deviceLabel}
        </span>
      </div>
      {children}
      {occupiedBy && deployState.status === "idle" && (
        <div className="flex items-center gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Running: {occupiedBy}</span>
        </div>
      )}
      <DeployStatusIndicator state={deployState} />
    </div>
  );
}

function DeployStatusIndicator({ state }: { state: DeployState }) {
  if (state.status === "idle") return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />Idle
    </div>
  );
  if (state.status === "deploying") return (
    <div className="flex items-center gap-1.5 text-xs text-blue-500">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />Deploying…
    </div>
  );
  if (state.status === "done") return (
    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
      <CheckCircle2 className="w-3.5 h-3.5" />Deployed
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 text-xs text-red-500">
      <AlertTriangle className="w-3.5 h-3.5" />{state.error ?? "Error"}
    </div>
  );
}
