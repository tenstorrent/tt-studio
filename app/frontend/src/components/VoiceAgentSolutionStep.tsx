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

const STATUS_ORDER: Record<string, number> = {
  COMPLETE: 3,
  FUNCTIONAL: 2,
  EXPERIMENTAL: 1,
};

// ---- helpers --------------------------------------------------------------

function pollDeployProgress(jobId: string): Promise<"done" | "error"> {
  return new Promise((resolve) => {
    let notFoundCount = 0;
    const MAX_NOT_FOUND = 10;
    const interval = setInterval(async () => {
      try {
        const resp = await fetch(`/docker-api/deploy/progress/${jobId}/`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.status === "not_found") {
          if (++notFoundCount > MAX_NOT_FOUND) { clearInterval(interval); resolve("error"); }
          return;
        }
        notFoundCount = 0;
        if (data.status === "completed") { clearInterval(interval); resolve("done"); }
        else if (["error", "failed", "timeout"].includes(data.status)) { clearInterval(interval); resolve("error"); }
      } catch { /* keep polling */ }
    }, 1000);
  });
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

/** Group models by status then by compatibility — same logic as FirstStepForm */
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

// ---- ModelSelectItems — renders grouped, compatibility-aware select items --

function ModelSelectItems({ models }: { models: Model[] }) {
  const grouped = groupByStatus(models);

  if (models.length === 0) {
    return (
      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
        No models available
      </div>
    );
  }

  return (
    <>
      {Object.entries(grouped)
        .sort(([a], [b]) => (STATUS_ORDER[b] ?? 0) - (STATUS_ORDER[a] ?? 0))
        .map(([modelStatus, byCompat]) => {
          const cfg = STATUS_CONFIG[modelStatus as keyof typeof STATUS_CONFIG];
          const Icon = cfg?.icon ?? FlaskConical;
          const hasAny =
            byCompat.compatible.length + byCompat.incompatible.length + byCompat.unknown.length > 0;
          if (!hasAny) return null;

          return (
            <div key={modelStatus}>
              {/* Status sub-header */}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${cfg?.color ?? "text-gray-600"} ${cfg?.bgColor ?? "bg-gray-50 dark:bg-gray-900/20"}`}>
                <Icon className="w-3 h-3" />
                <span>{cfg?.label ?? modelStatus}</span>
              </div>

              {byCompat.compatible.map((m) => (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  className="pl-8 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden"
                >
                  <div className="flex items-center w-full">
                    <span className="text-green-500 mr-2 text-xs">●</span>
                    <span className="flex-1">{m.name}</span>
                    <span className="text-xs text-green-600 ml-2">Compatible</span>
                  </div>
                </SelectItem>
              ))}

              {byCompat.unknown.map((m) => (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  className="pl-8 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden"
                >
                  <div className="flex items-center w-full">
                    <span className="text-yellow-500 mr-2 text-xs">●</span>
                    <span className="flex-1">{m.name}</span>
                    <span className="text-xs text-yellow-600 ml-2">Unknown</span>
                  </div>
                </SelectItem>
              ))}

              {byCompat.incompatible.map((m) => (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  disabled
                  className="pl-8 opacity-50 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden"
                >
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

export function VoiceAgentSolutionStep({ onBack }: VoiceAgentSolutionStepProps) {
  const navigate = useNavigate();
  const [allModels, setAllModels] = useState<Model[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  const [selectedLlmId, setSelectedLlmId] = useState<string>("");
  const [selectedWhisperId, setSelectedWhisperId] = useState<string>("");
  const [speechT5Id, setSpeechT5Id] = useState<string>("");

  const [llmState, setLlmState] = useState<DeployState>({ status: "idle" });
  const [whisperState, setWhisperState] = useState<DeployState>({ status: "idle" });
  const [ttsState, setTtsState] = useState<DeployState>({ status: "idle" });

  const [isDeploying, setIsDeploying] = useState(false);
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    fetch(getModelsUrl)
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
      .catch(() => customToast.error("Failed to load model catalog"))
      .finally(() => setLoadingModels(false));
  }, []);

  const SINGLE_DEVICE_BOARDS = ["n150", "n300"];
  const isSingleDevice = (m: Model) =>
    (m.chips_required ?? 1) === 1 &&
    m.compatible_boards.some((b) => SINGLE_DEVICE_BOARDS.includes(b.toLowerCase()));
  const isSingleChip = (m: Model) => (m.chips_required ?? 1) === 1;
  const chatModels = allModels.filter((m) => m.model_type === "chat" && isSingleDevice(m));
  const whisperModels = allModels.filter((m) => m.model_type === "speech_recognition" && isSingleChip(m));
  const ttsModels = allModels.filter((m) => m.model_type === "tts" && isSingleChip(m));
  const speechT5Model = allModels.find((m) => m.id === speechT5Id);

  const canDeploy = !isDeploying && !allDone && !!selectedLlmId && !!selectedWhisperId && !!speechT5Id;

  const handleDeploy = async () => {
    if (!selectedLlmId || !selectedWhisperId || !speechT5Id) {
      customToast.error("Some models are not available in the catalog");
      return;
    }
    setIsDeploying(true);
    setAllDone(false);

    const runStep = async (
      modelId: string,
      deviceId: number,
      setState: (s: DeployState) => void,
      label: string
    ): Promise<boolean> => {
      setState({ status: "deploying" });
      const result = await deployOneModel(modelId, deviceId);
      if (result.error || !result.jobId) {
        setState({ status: "error", error: result.error });
        customToast.error(`${label} deployment failed: ${result.error}`);
        return false;
      }
      const outcome = await pollDeployProgress(result.jobId);
      if (outcome === "error") {
        setState({ status: "error", error: "Deployment failed or timed out" });
        customToast.error(`${label} deployment failed`);
        return false;
      }
      setState({ status: "done" });
      return true;
    };

    const ok1 = await runStep(selectedLlmId, 0, setLlmState, "LLM");
    if (!ok1) { setIsDeploying(false); return; }

    const ok2 = await runStep(selectedWhisperId, 1, setWhisperState, "Whisper");
    if (!ok2) { setIsDeploying(false); return; }

    const ok3 = await runStep(speechT5Id, 2, setTtsState, "SpeechT5");
    if (!ok3) { setIsDeploying(false); return; }

    setIsDeploying(false);
    setAllDone(true);
    customToast.success("Voice Agent pipeline deployed!");
  };

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <div>
        <h2 className="text-lg font-semibold mb-1">Voice Agent Solution</h2>
        <p className="text-sm text-muted-foreground">
          Deploys the full voice pipeline: LLM on device 0, Whisper on device 1, SpeechT5 on device 2.
        </p>
      </div>

      {loadingModels ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading model catalog…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* LLM — device 0 */}
            <ModelCard
              icon={<Bot className="w-5 h-5" />}
              label="LLM"
              deviceLabel="Device 0"
              deployState={llmState}
              accent="blue"
            >
              <Select
                value={selectedLlmId}
                onValueChange={setSelectedLlmId}
                disabled={isDeploying || allDone}
              >
                <SelectTrigger className="w-full text-xs h-8">
                  <SelectValue placeholder="Select LLM" />
                </SelectTrigger>
                <SelectContent>
                  <ModelSelectItems models={chatModels} />
                </SelectContent>
              </Select>
            </ModelCard>

            {/* Whisper — device 1 */}
            <ModelCard
              icon={<Mic className="w-5 h-5" />}
              label="Whisper"
              deviceLabel="Device 1"
              deployState={whisperState}
              accent="purple"
            >
              <Select
                value={selectedWhisperId}
                onValueChange={setSelectedWhisperId}
                disabled={isDeploying || allDone}
              >
                <SelectTrigger className="w-full text-xs h-8">
                  <SelectValue placeholder="Select Whisper" />
                </SelectTrigger>
                <SelectContent>
                  <ModelSelectItems models={whisperModels} />
                </SelectContent>
              </Select>
            </ModelCard>

            {/* SpeechT5 — device 2, fixed */}
            <ModelCard
              icon={<Volume2 className="w-5 h-5" />}
              label="SpeechT5 TTS"
              deviceLabel="Device 2"
              deployState={ttsState}
              accent="green"
            >
              {ttsModels.length > 1 ? (
                <Select
                  value={speechT5Id}
                  onValueChange={setSpeechT5Id}
                  disabled={isDeploying || allDone}
                >
                  <SelectTrigger className="w-full text-xs h-8">
                    <SelectValue placeholder="Select TTS" />
                  </SelectTrigger>
                  <SelectContent>
                    <ModelSelectItems models={ttsModels} />
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center h-8 px-3 rounded-md border border-input bg-muted/50 text-xs text-muted-foreground">
                  {speechT5Model?.name ?? "speecht5_tts"}
                  <span className="ml-auto text-[10px] opacity-60">fixed</span>
                </div>
              )}
            </ModelCard>
          </div>

          {/* Deploy / success */}
          {allDone ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-2">
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4" />
                All models deployed successfully
              </div>
              <Button onClick={() => navigate("/voice-agent")} className="flex items-center gap-2">
                Open Voice Agent
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="pt-2">
              <Button onClick={handleDeploy} disabled={!canDeploy} className="flex items-center gap-2">
                {isDeploying && <Loader2 className="w-4 h-4 animate-spin" />}
                {isDeploying ? "Deploying…" : "Deploy Voice Agent"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- ModelCard sub-component ----------------------------------------------

type CardAccent = "blue" | "purple" | "green";

const accentStyles: Record<CardAccent, { border: string; badge: string; icon: string }> = {
  blue: {
    border: "border-TT-blue/30 dark:border-TT-blue/40",
    badge: "bg-TT-blue/10 text-TT-blue dark:bg-TT-blue/20",
    icon: "text-TT-blue",
  },
  purple: {
    border: "border-TT-purple/30 dark:border-TT-purple/40",
    badge: "bg-TT-purple/10 text-TT-purple dark:bg-TT-purple/20",
    icon: "text-TT-purple",
  },
  green: {
    border: "border-green-400/30 dark:border-green-500/30",
    badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    icon: "text-green-600 dark:text-green-400",
  },
};

function ModelCard({
  icon,
  label,
  deviceLabel,
  deployState,
  accent,
  children,
}: {
  icon: ReactNode;
  label: string;
  deviceLabel: string;
  deployState: DeployState;
  accent: CardAccent;
  children: ReactNode;
}) {
  const styles = accentStyles[accent];
  return (
    <div className={`rounded-xl border-[2px] p-4 flex flex-col gap-3 bg-white/60 dark:bg-stone-900/60 backdrop-blur-sm transition-shadow duration-200 ${styles.border}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={styles.icon}>{icon}</span>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${styles.badge}`}>
          {deviceLabel}
        </span>
      </div>
      {children}
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
