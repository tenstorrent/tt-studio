// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useTheme } from "../../hooks/useTheme";
import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "../../lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import type { PipelineStage } from "./types";

type Props = {
  className?: string;
  onRecordingComplete?: (audioBlob: Blob) => void;
  onRecordingStart?: () => void;
  disabled?: boolean;
  stage?: PipelineStage;
  isTTSGenerating?: boolean;
};

const LEVEL_BARS = 24;
const SAMPLE_RATE = 16_000;

const STAGE_BAR_COLORS: Record<string, string> = {
  idle: "bg-TT-purple-accent",
  recording: "bg-TT-red-accent",
  transcribing: "bg-TT-yellow",
  thinking: "bg-TT-yellow",
  speaking: "bg-TT-green",
  done: "bg-TT-purple-accent",
  tts: "bg-TT-green",
};

export const AudioRecorderWithVisualizer = ({
  className,
  onRecordingComplete,
  onRecordingStart,
  disabled = false,
  stage = "idle",
  isTTSGenerating = false,
}: Props) => {
  const { theme } = useTheme();

  const [isRecording, setIsRecording] = useState(false);
  const [levels, setLevels] = useState<number[]>(new Array(LEVEL_BARS).fill(0));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const cleanup = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch {}
      analyserRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startRecording = async () => {
    if (disabled) return;
    cleanup();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: SAMPLE_RATE },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        cleanup();
        if (onRecordingComplete) onRecordingComplete(blob);
      };

      recorder.start();
      setIsRecording(true);
      if (onRecordingStart) onRecordingStart();
      startVisualization(analyser);
    } catch (err) {
      console.error("Microphone access error:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setLevels(new Array(LEVEL_BARS).fill(0));
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startVisualization = (analyser: AnalyserNode) => {
    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);
    const barsPerBucket = Math.floor(bufLen / LEVEL_BARS);

    const draw = () => {
      if (!analyserRef.current) return;
      analyser.getByteFrequencyData(data);

      const newLevels: number[] = [];
      for (let i = 0; i < LEVEL_BARS; i++) {
        let sum = 0;
        for (let j = 0; j < barsPerBucket; j++) {
          sum += data[i * barsPerBucket + j];
        }
        newLevels.push(sum / barsPerBucket / 255);
      }
      setLevels(newLevels);
      animFrameRef.current = requestAnimationFrame(draw);
    };
    draw();
  };

  // Determine bar color based on state
  const barColorClass = isTTSGenerating
    ? STAGE_BAR_COLORS.tts
    : STAGE_BAR_COLORS[stage] || STAGE_BAR_COLORS.idle;

  const isActive = isRecording || isTTSGenerating;

  // Generate fake TTS animation levels
  const ttsLevels = isTTSGenerating
    ? levels.map((_, i) => 0.2 + 0.5 * Math.abs(Math.sin(Date.now() / 300 + i * 0.5)))
    : levels;

  // Use TTS animation frame when generating
  useEffect(() => {
    if (!isTTSGenerating) return;
    let frame: number;
    const animate = () => {
      setLevels(
        new Array(LEVEL_BARS).fill(0).map((_, i) =>
          0.15 + 0.45 * Math.abs(Math.sin(Date.now() / 250 + i * 0.6))
        )
      );
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [isTTSGenerating]);

  const statusText = disabled
    ? stage === "transcribing"
      ? "Transcribing..."
      : stage === "thinking"
        ? "Thinking..."
        : stage === "speaking"
          ? "Speaking..."
          : "Processing..."
    : isRecording
      ? "Listening — click to stop"
      : "Click to record";

  return (
    <div className={cn("flex flex-col items-center gap-0.5 sm:gap-1.5", className)}>
      {/* Full-width waveform visualizer */}
      <div className="flex items-end justify-center gap-[2px] sm:gap-[3px] h-3 sm:h-5 lg:h-7 w-full px-2 sm:px-4">
        {levels.map((level, i) => (
          <motion.div
            key={i}
            className={cn(
              "flex-1 max-w-[4px] sm:max-w-[6px] lg:max-w-[8px] rounded-sm transition-colors",
              isActive
                ? barColorClass
                : theme === "dark"
                  ? "bg-white/[0.06]"
                  : "bg-black/[0.06]"
            )}
            animate={{
              height: isActive ? Math.max(2, level * 16) : 2,
              opacity: isActive ? 0.5 + level * 0.5 : 0.25,
            }}
            transition={{ duration: 0.08, ease: "easeOut" }}
            style={
              isActive && level > 0.3
                ? { boxShadow: `0 0 6px currentColor` }
                : undefined
            }
          />
        ))}
      </div>

      {/* Mic Button — hero element */}
      <div className="relative flex items-center justify-center">
        <AnimatePresence>
          {isRecording && (
            <motion.div
              className="absolute inset-0 rounded-full bg-TT-purple-accent/20"
              initial={{ scale: 1, opacity: 0.5 }}
              animate={{ scale: 2, opacity: 0 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
        <motion.button
          onClick={toggleRecording}
          disabled={disabled}
          whileHover={!disabled ? { scale: 1.06 } : undefined}
          whileTap={!disabled ? { scale: 0.95 } : undefined}
          className={cn(
            "relative z-10 w-10 h-10 sm:w-12 sm:h-12 lg:w-14 lg:h-14 rounded-full flex items-center justify-center transition-all duration-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-TT-purple-accent focus-visible:ring-offset-2",
            disabled && "opacity-50 cursor-not-allowed",
            isRecording
              ? "bg-TT-red-accent hover:bg-TT-red-shade text-white shadow-lg shadow-TT-red-accent/30"
              : theme === "dark"
                ? "bg-white/[0.05] border-2 border-TT-purple-accent/50 text-TT-purple-accent hover:border-TT-purple-accent hover:shadow-lg hover:shadow-TT-purple-accent/20"
                : "bg-white border-2 border-TT-purple-accent/50 text-TT-purple-accent hover:border-TT-purple-accent hover:shadow-lg hover:shadow-TT-purple-accent/20"
          )}
        >
          {isRecording ? (
            <Square className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6" />
          ) : (
            <Mic className="w-5 h-5 sm:w-6 sm:h-6 lg:w-7 lg:h-7" />
          )}
        </motion.button>
      </div>

      {/* Status label */}
      <motion.p
        key={statusText}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(
          "text-xs sm:text-sm font-mono tracking-wide",
          isRecording
            ? "text-TT-red-accent"
            : disabled
              ? "text-TT-yellow"
              : theme === "dark"
                ? "text-gray-500"
                : "text-gray-400"
        )}
      >
        {statusText}
      </motion.p>
    </div>
  );
};
