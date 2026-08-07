// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "../ui/button";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { sendAudioRecording } from "../speechToText/lib/apiClient";
import type { VoiceInputProps } from "./types";

interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export function VoiceInput({
  onTranscript,
  isListening,
  setIsListening,
  deployId,
}: VoiceInputProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopAudioAnalysis = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (dataArrayRef.current) {
      dataArrayRef.current = null;
    }
  }, []);

  const updateBars = useCallback(() => {
    if (!analyserRef.current || !dataArrayRef.current) return;

    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    const bars = barsRef.current;
    const barCount = bars.length;

    for (let i = 0; i < barCount; i++) {
      const bar = bars[i];
      if (bar) {
        const barIndex = Math.floor(
          (i / barCount) * dataArrayRef.current.length
        );
        const barHeight = (dataArrayRef.current[barIndex] / 255) * 100;
        bar.style.height = `${Math.max(4, barHeight)}%`;
      }
    }

    rafIdRef.current = requestAnimationFrame(updateBars);
  }, []);

  const startAudioAnalysis = useCallback(
    (stream: MediaStream) => {
      try {
        const AudioContextConstructor =
          window.AudioContext ||
          (window as WindowWithWebkit).webkitAudioContext;
        if (!AudioContextConstructor) {
          throw new Error("AudioContext is not supported in this browser.");
        }
        audioContextRef.current = new AudioContextConstructor();
        analyserRef.current = audioContextRef.current.createAnalyser();
        sourceRef.current =
          audioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.fftSize = 32;
        const bufferLength = analyserRef.current.frequencyBinCount;
        dataArrayRef.current = new Uint8Array(
          bufferLength
        ) as Uint8Array<ArrayBuffer>;
        updateBars();
      } catch (error) {
        console.error("Error starting audio analysis:", error);
      }
    },
    [updateBars]
  );

  const cleanupResources = useCallback(() => {
    // Stop the recorder without triggering a transcription
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }

    stopAudioAnalysis();

    // Release all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsListening(false);
  }, [setIsListening, stopAudioAnalysis]);

  const transcribe = useCallback(
    async (audioBlob: Blob) => {
      setIsProcessing(true);
      try {
        const data = await sendAudioRecording(
          audioBlob,
          deployId ? { modelID: deployId } : undefined
        );
        const text = typeof data?.text === "string" ? data.text.trim() : "";
        if (text) {
          onTranscript(text);
        } else {
          setErrorMessage("No speech detected. Please try again.");
        }
      } catch (error) {
        console.error("Transcription failed:", error);
        setErrorMessage("Transcription failed. Please try again.");
      } finally {
        setIsProcessing(false);
      }
    },
    [deployId, onTranscript]
  );

  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        cleanupResources();
        if (blob.size > 0) {
          transcribe(blob);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsListening(true);
      setErrorMessage(null);
      startAudioAnalysis(stream);
    } catch (error) {
      console.error("Error starting voice recording:", error);
      setErrorMessage("Microphone unavailable. Check browser permissions.");
      cleanupResources();
    }
  }, [setIsListening, startAudioAnalysis, cleanupResources, transcribe]);

  const stopListening = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      // onstop cleans up and sends the audio for transcription
      mediaRecorderRef.current.stop();
    } else {
      cleanupResources();
    }
  }, [cleanupResources]);

  const toggleListening = useCallback(() => {
    if (isProcessing) return;
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isProcessing, isListening, startListening, stopListening]);

  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  return (
    <div className="relative inline-flex items-center">
      <Button
        onClick={toggleListening}
        disabled={isProcessing}
        variant="ghost"
        className={`relative text-gray-600 dark:text-white/90 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 p-2 rounded-full flex items-center justify-center transition-colors duration-300 ${
          isListening ? "bg-[#7C68FA]/20" : ""
        }`}
        aria-label={
          isProcessing
            ? "Transcribing"
            : isListening
              ? "Stop recording"
              : "Start voice input"
        }
      >
        {isProcessing ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : isListening ? (
          <Mic className="h-5 w-5" />
        ) : (
          <MicOff className="h-5 w-5" />
        )}
      </Button>
      {isListening && (
        <>
          <div className="absolute -top-1 -right-1 w-3 h-3">
            <div className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7C68FA] opacity-75"></div>
            <div className="relative inline-flex rounded-full h-3 w-3 bg-[#7C68FA]"></div>
          </div>
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 flex items-center justify-center w-24 h-8 bg-[#7C68FA]/10 rounded-full overflow-hidden">
            <div className="flex gap-1 items-end h-full py-1">
              {[...Array(5)].map((_, index) => (
                <div
                  key={index}
                  ref={(el) => (barsRef.current[index] = el)}
                  className="w-1 bg-[#7C68FA] rounded-full transition-all duration-75"
                  style={{ height: "4%" }}
                ></div>
              ))}
            </div>
          </div>
        </>
      )}
      {errorMessage && (
        <p className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-red-500 text-xs">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
