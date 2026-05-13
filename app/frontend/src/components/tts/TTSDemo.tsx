// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, Loader2, Download, Play, Pause } from "lucide-react";
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

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

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

  const formatTime = (secs: number) => {
    if (!isFinite(secs) || isNaN(secs)) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const cleanupAudio = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    // Don't disconnect/null the source node — it's bound to the <audio> element
    // for the lifetime of the AudioContext and can't be re-created.
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {}
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
      sourceNodeRef.current = null; // invalidated when context closes
    }
  }, []);

  const initAudioGraph = useCallback(() => {
    if (!audioRef.current) return;

    // If we already have a live context + source, just resume it
    if (audioContextRef.current && sourceNodeRef.current) {
      if (audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume();
      }
      return;
    }

    // Tear down any stale graph
    cleanupAudio();

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const source = ctx.createMediaElementSource(audioRef.current);
    source.connect(analyser);
    analyser.connect(ctx.destination);

    audioContextRef.current = ctx;
    analyserRef.current = analyser;
    sourceNodeRef.current = source;
  }, [cleanupAudio]);

  const drawVisualizer = useCallback(
    (playing: boolean, frameCount: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0D0D14";
      ctx.fillRect(0, 0, W, H);

      if (playing && analyserRef.current) {
        // Active: frequency bar visualizer
        const bufferLength = analyserRef.current.frequencyBinCount; // 128
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        const numBars = 80;
        // Use low 75% of spectrum (voice range)
        const voiceBins = Math.floor(bufferLength * 0.75);
        const barWidth = (W - numBars + 1) / numBars;
        const gap = 1;

        for (let i = 0; i < numBars; i++) {
          const binIdx = Math.floor((i / numBars) * voiceBins);
          const amplitude = dataArray[binIdx] / 255; // 0..1
          const barH = Math.max(2, amplitude * H * 0.92);
          const x = i * (barWidth + gap);
          const y = H - barH;

          const isHot = amplitude > 0.65;

          // Per-bar gradient
          const grad = ctx.createLinearGradient(0, y, 0, H);
          if (isHot) {
            grad.addColorStop(0, "#FFFFFF");
            grad.addColorStop(0.08, "#2EE8C4");
            grad.addColorStop(1, "#7C68FA");
          } else {
            grad.addColorStop(0, "#2EE8C4");
            grad.addColorStop(1, "#7C68FA");
          }

          ctx.shadowBlur = isHot ? 18 : 8;
          ctx.shadowColor = isHot ? "#2EE8C4" : "#7C68FA";
          ctx.fillStyle = grad;

          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barH, 2);
          ctx.fill();
        }
      } else {
        // Idle: two-frequency sine interference (amber ECG flatline)
        const numBars = 80;
        const barWidth = (W - numBars + 1) / numBars;
        const gap = 1;
        const t = frameCount * 0.04;

        ctx.shadowBlur = 6;
        ctx.shadowColor = "#F6BC42";
        ctx.fillStyle = "#F6BC42";

        for (let i = 0; i < numBars; i++) {
          const phase = (i / numBars) * Math.PI * 4;
          const sine1 = Math.sin(phase + t);
          const sine2 = Math.sin(phase * 1.7 + t * 0.6);
          const amplitude = ((sine1 + sine2) / 4 + 0.5) * 0.18; // 0..~0.18
          const barH = Math.max(2, amplitude * H);
          const x = i * (barWidth + gap);
          const y = H / 2 - barH / 2;

          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barH, 1);
          ctx.fill();
        }
      }

      // Reset shadow so it doesn't bleed
      ctx.shadowBlur = 0;
    },
    []
  );

  const startVisualizerLoop = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    let frameCount = 0;
    const loop = () => {
      const playing = audioRef.current ? !audioRef.current.paused : false;
      drawVisualizer(playing, frameCount++);
      animationFrameRef.current = requestAnimationFrame(loop);
    };
    animationFrameRef.current = requestAnimationFrame(loop);
  }, [drawVisualizer]);

  // Audio event handlers
  const handlePlay = useCallback(() => {
    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }
    setIsPlaying(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) setDuration(audioRef.current.duration);
  }, []);

  const togglePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setCurrentTime(val);
    }
  }, []);

  // Unmount cleanup
  useEffect(() => {
    return () => cleanupAudio();
  }, [cleanupAudio]);

  // Effect: audioUrl change → start idle visualizer loop
  useEffect(() => {
    if (!audioUrl) return;

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    // Start visualizer loop (idle animation shows immediately)
    startVisualizerLoop();
  }, [audioUrl, startVisualizerLoop]);

  // ResizeObserver: keep canvas bitmap matching CSS layout size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

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

    // Init audio graph NOW (in user-gesture context) so AudioContext isn't suspended
    initAudioGraph();

    try {
      const blob = await runTTSInference(selectedDeployId, text.trim());
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      // Wait for audio element to be ready, then play
      if (audioRef.current) {
        audioRef.current.src = url;
        const playWhenReady = () => {
          audioContextRef.current?.resume();
          audioRef.current?.play().catch(() => {});
          audioRef.current?.removeEventListener("canplay", playWhenReady);
        };
        audioRef.current.addEventListener("canplay", playWhenReady);
        audioRef.current.load();
      }
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
      {/* Always-mounted audio element (no native controls) */}
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        className="hidden"
      />

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
                No TTS models are currently deployed. Deploy a TTS model to get
                started.
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

          {/* Oscilloscope audio player */}
          {audioUrl && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="rounded-xl overflow-hidden border border-[#7C68FA]/30 shadow-2xl"
              style={{ background: "#0D0D14" }}
            >
              {/* Waveform canvas with scan-line overlay */}
              <div className="relative w-full" style={{ height: "112px" }}>
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full"
                  style={{ background: "#0D0D14" }}
                />
                {/* Scan-line CSS overlay */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)",
                  }}
                />
              </div>

              {/* Transport bar */}
              <div
                className="flex items-center gap-3 px-4 py-3"
                style={{ background: "#0D0D14" }}
              >
                {/* Play / Pause button */}
                <button
                  onClick={togglePlayPause}
                  className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-150"
                  style={{
                    border: "1.5px solid #7C68FA",
                    boxShadow: isPlaying
                      ? "0 0 10px 2px rgba(124,104,250,0.5)"
                      : "none",
                    background: "transparent",
                  }}
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4" style={{ color: "#7C68FA" }} />
                  ) : (
                    <Play
                      className="w-4 h-4"
                      style={{ color: "#7C68FA", marginLeft: "2px" }}
                    />
                  )}
                </button>

                {/* Scrubber */}
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={currentTime}
                  onChange={handleSeek}
                  className="flex-1 h-1 rounded-full cursor-pointer"
                  style={{ accentColor: "#7C68FA" }}
                />

                {/* Time display */}
                <span
                  className="flex-shrink-0 text-xs font-mono tabular-nums"
                  style={{ color: "#9CA3AF", minWidth: "80px" }}
                >
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>

                {/* Download */}
                <button
                  onClick={handleDownload}
                  className="flex-shrink-0 flex items-center gap-1 text-xs font-mono px-2 py-1 rounded transition-colors duration-150"
                  style={{ color: "#2EE8C4", border: "1px solid #2EE8C430" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "rgba(46,232,196,0.1)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <Download className="w-3 h-3" />
                  DL
                </button>
              </div>

              {/* Label row */}
              <div
                className="flex items-center gap-2 px-4 pb-3"
                style={{ background: "#0D0D14" }}
              >
                <span
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ background: "#2EE8C4" }}
                />
                <span
                  className="text-[10px] font-mono uppercase tracking-widest"
                  style={{ color: "#2EE8C4" }}
                >
                  Generated Audio
                </span>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </Card>
  );
}
