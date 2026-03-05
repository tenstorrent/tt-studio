// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useTheme } from "../../hooks/useTheme";
import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "../../lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type Props = {
  className?: string;
  onRecordingComplete?: (audioBlob: Blob) => void;
  onRecordingStart?: () => void;
  disabled?: boolean;
};

const LEVEL_BARS = 12;
const SAMPLE_RATE = 16_000;

export const AudioRecorderWithVisualizer = ({
  className,
  onRecordingComplete,
  onRecordingStart,
  disabled = false,
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

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      {/* Audio Level Grid */}
      <div className="flex items-end gap-[3px] h-10 px-1">
        {levels.map((level, i) => (
          <motion.div
            key={i}
            className={cn(
              "w-2 rounded-sm",
              isRecording
                ? "bg-TT-purple-accent"
                : theme === "dark"
                  ? "bg-[#222]"
                  : "bg-gray-200"
            )}
            animate={{
              height: isRecording ? Math.max(4, level * 36) : 4,
              opacity: isRecording ? 0.5 + level * 0.5 : 0.3,
            }}
            transition={{ duration: 0.08, ease: "easeOut" }}
          />
        ))}
      </div>

      {/* Mic Button */}
      <div className="relative flex items-center justify-center">
        <AnimatePresence>
          {isRecording && (
            <motion.div
              className="absolute inset-0 rounded-full bg-red-500/20"
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 1.8, opacity: 0 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
        <button
          onClick={toggleRecording}
          disabled={disabled}
          className={cn(
            "relative z-10 w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-TT-purple-accent focus-visible:ring-offset-2",
            disabled && "opacity-50 cursor-not-allowed",
            isRecording
              ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30"
              : theme === "dark"
                ? "bg-[#1A1A1A] border-2 border-TT-purple-accent/60 text-TT-purple-accent hover:border-TT-purple-accent hover:shadow-lg hover:shadow-TT-purple-accent/20"
                : "bg-white border-2 border-TT-purple-accent/60 text-TT-purple-accent hover:border-TT-purple-accent hover:shadow-lg hover:shadow-TT-purple-accent/20"
          )}
        >
          {isRecording ? (
            <Square className="w-5 h-5" />
          ) : (
            <Mic className="w-6 h-6" />
          )}
        </button>
      </div>

      {/* Status label */}
      <p
        className={cn(
          "text-xs",
          isRecording
            ? "text-red-500"
            : theme === "dark"
              ? "text-gray-500"
              : "text-gray-400"
        )}
      >
        {disabled
          ? "Processing..."
          : isRecording
            ? "Click to stop & send"
            : "Click to record"}
      </p>
    </div>
  );
};
