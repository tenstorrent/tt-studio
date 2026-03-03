// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from "react";
import { Volume2, Loader2, Download } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Card } from "../ui/card";
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && ttsModels.length > 0 && text.trim()) {
        handleGenerate();
      }
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = "tts-output.wav";
    a.click();
  };

  return (
    <Card className="flex flex-col w-full max-w-3xl max-h-[85vh] overflow-hidden shadow-xl bg-white dark:bg-black border-gray-200 dark:border-[#7C68FA]/20 rounded-2xl">
      <div className="flex-1 overflow-auto flex items-center justify-center">
        <div className="w-full max-w-3xl px-6 py-8 flex flex-col gap-6">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="text-center"
            >
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
                Text to Speech Demo
              </h1>
              <p className="mt-2 text-base text-gray-600 dark:text-gray-300">
                Type text below and generate audio using a deployed TTS model.
              </p>
            </motion.div>

            {/* Model selector */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="flex flex-col gap-2"
            >
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                TTS Model
              </label>
              {ttsModels.length === 0 ? (
                <div className="text-sm text-amber-600 dark:text-amber-400 border-2 border-amber-400 dark:border-amber-600 rounded-lg px-4 py-3 bg-amber-50 dark:bg-amber-950">
                  No TTS models are currently deployed. Deploy a TTS model to
                  get started.
                </div>
              ) : (
                <Select
                  value={selectedDeployId}
                  onValueChange={setSelectedDeployId}
                >
                  <SelectTrigger className="h-12 text-base border-2">
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
            </motion.div>

            {/* Text input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="flex flex-col gap-2"
            >
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Text to synthesize
              </label>
              <Textarea
                rows={6}
                placeholder="Enter text here…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                className="resize-none focus-visible:ring-2 focus-visible:ring-TT-purple-accent text-base border-2"
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 flex-wrap">
                <span>Press</span>
                <kbd className="px-2 py-1 rounded font-mono text-[11px] bg-TT-purple-accent/20 dark:bg-TT-purple-accent/30 text-TT-purple-accent dark:text-TT-purple-tint1 border border-TT-purple-accent/40 dark:border-TT-purple-accent/50">
                  Enter
                </kbd>
                <span>to generate</span>
                <span className="text-gray-400 dark:text-gray-600">•</span>
                <kbd className="px-2 py-1 rounded font-mono text-[11px] bg-TT-purple-accent/20 dark:bg-TT-purple-accent/30 text-TT-purple-accent dark:text-TT-purple-tint1 border border-TT-purple-accent/40 dark:border-TT-purple-accent/50">
                  Shift+Enter
                </kbd>
                <span>for new line</span>
              </p>
            </motion.div>

            {/* Generate button */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              className="flex justify-center"
            >
              <Button
                size="lg"
                className="flex items-center gap-2 px-12 h-14 text-lg bg-TT-purple-accent hover:bg-TT-purple text-white font-semibold transition-all duration-200 hover:shadow-xl hover:scale-105 disabled:hover:scale-100 disabled:hover:shadow-none"
                onClick={handleGenerate}
                disabled={isLoading || ttsModels.length === 0 || !text.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Volume2 className="w-6 h-6" />
                    Generate Audio
                  </>
                )}
              </Button>
            </motion.div>

            {/* Audio player */}
            {audioUrl && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="rounded-xl border-2 border-TT-purple-accent/30 dark:border-[#7C68FA]/40 p-6 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-gray-900/50 flex flex-col gap-4 shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-lg bg-TT-purple-accent/20 dark:bg-TT-purple-accent/30">
                      <Volume2 className="w-5 h-5 text-TT-purple-accent" />
                    </div>
                    <span className="text-base font-semibold text-gray-800 dark:text-gray-100">
                      Generated Audio
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5 text-gray-600 hover:text-TT-purple-accent dark:text-gray-300 dark:hover:text-TT-purple-accent hover:bg-TT-purple-accent/10"
                    onClick={handleDownload}
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </Button>
                </div>
                <audio
                  ref={audioRef}
                  controls
                  src={audioUrl}
                  className="w-full"
                />
              </motion.div>
            )}

            {/* Hidden audio element before URL is set */}
            {!audioUrl && <audio ref={audioRef} className="hidden" />}
        </div>
      </div>
    </Card>
  );
}
