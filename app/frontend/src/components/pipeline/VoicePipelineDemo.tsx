// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2, CheckCircle, Loader2, Circle } from "lucide-react";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { runVoicePipeline } from "../../api/modelsDeployedApis";
import { customToast } from "../CustomToaster";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeployedModelInfo {
  id: string;
  modelName: string;
  model_type?: string;
}

type PipelineStage = "idle" | "recording" | "stt" | "llm" | "tts" | "done";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchDeployedByType(
  modelType: string
): Promise<DeployedModelInfo[]> {
  try {
    const res = await fetch("/models-api/deployed/");
    if (!res.ok) return [];
    const data = await res.json();
    return Object.entries(data)
      .map(([id, info]: [string, any]) => ({
        id,
        modelName:
          info.model_impl?.model_name ||
          info.model_impl?.hf_model_id ||
          "Unknown",
        model_type: info.model_impl?.model_type,
      }))
      .filter((m) => m.model_type === modelType);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Stage indicator
// ---------------------------------------------------------------------------

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: "recording", label: "Mic" },
  { key: "stt", label: "Whisper" },
  { key: "llm", label: "LLM" },
  { key: "tts", label: "TTS" },
];

const STAGE_ORDER: Record<PipelineStage, number> = {
  idle: -1,
  recording: 0,
  stt: 1,
  llm: 2,
  tts: 3,
  done: 4,
};

function StageIndicator({ current }: { current: PipelineStage }) {
  return (
    <div className="flex items-center gap-2">
      {STAGES.map((s, i) => {
        const order = STAGE_ORDER[s.key];
        const currentOrder = STAGE_ORDER[current];
        const isDone = currentOrder > order;
        const isActive = current === s.key;

        return (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-0.5 w-8 ${isDone ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              {isDone ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : isActive ? (
                <Loader2 className="w-5 h-5 text-TT-purple-accent animate-spin" />
              ) : (
                <Circle className="w-5 h-5 text-gray-400" />
              )}
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {s.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function VoicePipelineDemo() {
  // Model dropdowns
  const [sttModels, setSttModels] = useState<DeployedModelInfo[]>([]);
  const [llmModels, setLlmModels] = useState<DeployedModelInfo[]>([]);
  const [ttsModels, setTtsModels] = useState<DeployedModelInfo[]>([]);

  const [whisperDeployId, setWhisperDeployId] = useState("");
  const [llmDeployId, setLlmDeployId] = useState("");
  const [ttsDeployId, setTtsDeployId] = useState("");

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Pipeline state
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [transcript, setTranscript] = useState("");
  const [llmResponse, setLlmResponse] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch deployed models on mount
  useEffect(() => {
    Promise.all([
      fetchDeployedByType("speech_recognition"),
      fetchDeployedByType("chat"),
      fetchDeployedByType("tts"),
    ]).then(([stt, llm, tts]) => {
      setSttModels(stt);
      setLlmModels(llm);
      setTtsModels(tts);
      if (stt.length > 0) setWhisperDeployId(stt[0].id);
      if (llm.length > 0) setLlmDeployId(llm[0].id);
      if (tts.length > 0) setTtsDeployId(tts[0].id);
    });
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setStage("recording");
      setTranscript("");
      setLlmResponse("");
      setAudioUrl(null);
    } catch (err) {
      customToast.error("Microphone access denied");
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const file = new File([blob], "recording.webm", { type: "audio/webm" });
      await runPipeline(file);
    };
    mr.stop();
    mr.stream.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
  };

  const runPipeline = async (audioFile: File) => {
    if (!whisperDeployId || !llmDeployId) {
      customToast.error("Please select STT and LLM models");
      setStage("idle");
      return;
    }

    setStage("stt");
    let llmText = "";

    await runVoicePipeline(
      {
        audioFile,
        whisperDeployId,
        llmDeployId,
        ttsDeployId: ttsDeployId || undefined,
      },
      // onTranscript
      (text) => {
        setTranscript(text);
        setStage("llm");
      },
      // onLlmChunk
      (chunk) => {
        llmText += chunk;
        setLlmResponse((prev) => prev + chunk);
      },
      // onAudio
      (url) => {
        setAudioUrl(url);
        setStage("tts");
        // Auto-play
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.src = url;
            audioRef.current.play().catch(() => {});
          }
        }, 100);
      },
      // onError
      (stage, message) => {
        customToast.error(`Pipeline error (${stage}): ${message}`);
        setStage("idle");
      },
      // onDone
      () => {
        setStage("done");
      }
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
        Voice Pipeline Demo
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Mic → Whisper STT → LLM → TTS → Speaker
      </p>

      {/* Model selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            STT (Whisper)
          </label>
          <Select value={whisperDeployId} onValueChange={setWhisperDeployId}>
            <SelectTrigger>
              <SelectValue
                placeholder={
                  sttModels.length === 0 ? "No STT deployed" : "Select STT"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {sttModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.modelName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            LLM
          </label>
          <Select value={llmDeployId} onValueChange={setLlmDeployId}>
            <SelectTrigger>
              <SelectValue
                placeholder={
                  llmModels.length === 0 ? "No LLM deployed" : "Select LLM"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {llmModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.modelName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            TTS (optional)
          </label>
          <Select
            value={ttsDeployId}
            onValueChange={setTtsDeployId}
          >
            <SelectTrigger>
              <SelectValue placeholder="None (skip TTS)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {ttsModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.modelName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stage indicator */}
      <div className="flex justify-center py-2">
        <StageIndicator current={stage} />
      </div>

      {/* Record button */}
      <div className="flex justify-center">
        {isRecording ? (
          <Button
            variant="destructive"
            size="lg"
            className="flex items-center gap-2 px-8"
            onClick={stopRecording}
          >
            <Square className="w-5 h-5" />
            Stop Recording
          </Button>
        ) : (
          <Button
            size="lg"
            className="flex items-center gap-2 px-8 bg-TT-purple-accent hover:bg-TT-purple text-white"
            onClick={startRecording}
            disabled={stage !== "idle" && stage !== "done"}
          >
            <Mic className="w-5 h-5" />
            {stage === "idle" || stage === "done"
              ? "Start Recording"
              : "Processing…"}
          </Button>
        )}
      </div>

      {/* Outputs */}
      {transcript && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
            Transcript
          </p>
          <p className="text-sm text-gray-800 dark:text-gray-100">
            {transcript}
          </p>
        </div>
      )}

      {llmResponse && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
            LLM Response
          </p>
          <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
            {llmResponse}
          </p>
        </div>
      )}

      {audioUrl && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900 flex items-center gap-4">
          <Volume2 className="w-5 h-5 text-TT-purple-accent" />
          <audio ref={audioRef} controls src={audioUrl} className="flex-1" />
        </div>
      )}

      {/* Hidden audio element for autoplay */}
      {!audioUrl && <audio ref={audioRef} className="hidden" />}
    </div>
  );
}
