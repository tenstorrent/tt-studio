// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from "react";
import { Volume2, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { runTTSInference } from "../../api/modelsDeployedApis";
import { customToast } from "../CustomToaster";

interface DeployedModelInfo {
  id: string;
  modelName: string;
  model_type?: string;
}

async function fetchTTSModels(): Promise<DeployedModelInfo[]> {
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
      .filter((m) => m.model_type === "tts");
  } catch {
    return [];
  }
}

export default function TTSDemo() {
  const [ttsModels, setTtsModels] = useState<DeployedModelInfo[]>([]);
  const [selectedDeployId, setSelectedDeployId] = useState("");
  const [text, setText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchTTSModels().then((models) => {
      setTtsModels(models);
      if (models.length > 0) setSelectedDeployId(models[0].id);
    });
  }, []);

  // Revoke previous object URL to avoid memory leaks
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleGenerate = async () => {
    if (!selectedDeployId) {
      customToast.error("Please select a TTS model");
      return;
    }
    if (!text.trim()) {
      customToast.error("Please enter some text to synthesize");
      return;
    }

    setIsLoading(true);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    try {
      const blob = await runTTSInference(selectedDeployId, text.trim());
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.play().catch(() => {});
        }
      }, 100);
    } catch (err) {
      customToast.error(
        `TTS generation failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
        Text to Speech Demo
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Type text below and generate audio using a deployed TTS model.
      </p>

      {/* Model selector */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
          TTS Model
        </label>
        {ttsModels.length === 0 ? (
          <p className="text-sm text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 rounded-md px-3 py-2 bg-amber-50 dark:bg-amber-950">
            No TTS models are currently deployed. Deploy a TTS model to get started.
          </p>
        ) : (
          <Select value={selectedDeployId} onValueChange={setSelectedDeployId}>
            <SelectTrigger>
              <SelectValue placeholder="Select TTS model" />
            </SelectTrigger>
            <SelectContent>
              {ttsModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.modelName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Text input */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
          Text to synthesize
        </label>
        <Textarea
          rows={4}
          placeholder="Enter text here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="resize-none"
        />
      </div>

      {/* Generate button */}
      <div className="flex justify-start">
        <Button
          size="lg"
          className="flex items-center gap-2 px-8 bg-TT-purple-accent hover:bg-TT-purple text-white"
          onClick={handleGenerate}
          disabled={isLoading || ttsModels.length === 0}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Volume2 className="w-5 h-5" />
              Generate
            </>
          )}
        </Button>
      </div>

      {/* Audio player */}
      {audioUrl && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900 flex items-center gap-4">
          <Volume2 className="w-5 h-5 text-TT-purple-accent shrink-0" />
          <audio ref={audioRef} controls src={audioUrl} className="flex-1" />
        </div>
      )}

      {/* Hidden audio element before URL is set */}
      {!audioUrl && <audio ref={audioRef} className="hidden" />}
    </div>
  );
}
