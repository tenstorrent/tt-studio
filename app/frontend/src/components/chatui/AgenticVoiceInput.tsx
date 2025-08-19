// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState, useRef, useCallback } from "react";
import { Button } from "../ui/button";
import { Mic, Bot, Square, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { sendAudioRecording } from "../speechToText/lib/apiClient";
import { customToast } from "../CustomToaster";

interface AgenticVoiceInputProps {
  onTranscriptReceived: (transcript: string) => void;
  onAutoSendMessage: () => Promise<void>;
  modelID?: string;
  disabled?: boolean;
  className?: string;
}

type RecordingState = "idle" | "recording" | "processing" | "transcribing" | "sending";

export function AgenticVoiceInput({
  onTranscriptReceived,
  onAutoSendMessage,
  modelID,
  disabled = false,
  className = "",
}: AgenticVoiceInputProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Refs for audio recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);

  // Recording timeout (10 seconds)
  const RECORDING_TIMEOUT = 10000;

  const cleanupAudioResources = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }

    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }

    chunksRef.current = [];
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setRecordingState("recording");

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/wav")
          ? "audio/wav"
          : "";

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setRecordingState("processing");
        await processRecording();
      };

      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        setError("Recording error occurred");
        setRecordingState("idle");
        cleanupAudioResources();
      };

      mediaRecorder.start(100); // Collect data every 100ms

      // Set timeout to auto-stop recording
      recordingTimeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, RECORDING_TIMEOUT);

      customToast.success("Recording started - speak now!");
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("Failed to access microphone");
      setRecordingState("idle");
      cleanupAudioResources();
      customToast.error("Failed to access microphone. Please check permissions.");
    }
  }, [cleanupAudioResources]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }, []);

  const processRecording = useCallback(async () => {
    try {
      if (chunksRef.current.length === 0) {
        throw new Error("No audio data recorded");
      }

      // Create audio blob
      const audioBlob = new Blob(chunksRef.current, {
        type: mediaRecorderRef.current?.mimeType || "audio/webm",
      });

      if (audioBlob.size === 0) {
        throw new Error("Empty audio recording");
      }

      setRecordingState("transcribing");
      customToast.success("Processing audio...");

      // Send to whisper API
      let transcriptionData;
      let transcription;

      try {
        transcriptionData = await sendAudioRecording(audioBlob, {
          modelID: modelID || null,
        });
        transcription = transcriptionData.text?.trim();
      } catch (apiError) {
        // Fallback for when API isn't available - use browser speech recognition
        console.warn("Whisper API failed, falling back to browser speech recognition:", apiError);
        customToast.error(
          "Whisper API unavailable. Deploy a speech recognition model or configure cloud API."
        );
        throw new Error("Whisper API not available. Please deploy a speech recognition model.");
      }

      if (!transcription) {
        throw new Error("No transcription received");
      }

      // Set the transcription in the input
      onTranscriptReceived(transcription);
      customToast.success(
        `Transcribed: "${transcription.substring(0, 50)}${transcription.length > 50 ? "..." : ""}"`
      );

      // Auto-send the message
      setRecordingState("sending");
      await onAutoSendMessage();

      customToast.success("Message sent to AI!");
      setRecordingState("idle");
    } catch (err) {
      console.error("Failed to process recording:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to process audio";
      setError(errorMessage);
      customToast.error(`Transcription failed: ${errorMessage}`);
      setRecordingState("idle");
    } finally {
      cleanupAudioResources();
    }
  }, [onTranscriptReceived, onAutoSendMessage, modelID, cleanupAudioResources]);

  const handleAgenticChatClick = useCallback(() => {
    if (recordingState === "recording") {
      stopRecording();
    } else if (recordingState === "idle") {
      startRecording();
    }
  }, [recordingState, startRecording, stopRecording]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      cleanupAudioResources();
    };
  }, [cleanupAudioResources]);

  const getButtonContent = () => {
    switch (recordingState) {
      case "recording":
        return (
          <div className="flex items-center gap-1">
            <Square className="h-3 w-3 animate-pulse text-red-500" />
            <div className="text-xs">Stop</div>
          </div>
        );
      case "processing":
      case "transcribing":
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case "sending":
        return (
          <div className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <Bot className="h-3 w-3" />
          </div>
        );
      case "idle":
      default:
        return (
          <div className="flex items-center gap-1">
            <Mic className="h-4 w-4" />
            <Bot className="h-3 w-3" />
          </div>
        );
    }
  };

  const getTooltipText = () => {
    switch (recordingState) {
      case "recording":
        return "Recording... Click to stop";
      case "processing":
        return "Processing audio...";
      case "transcribing":
        return "Transcribing speech...";
      case "sending":
        return "Sending to AI...";
      case "idle":
      default:
        return "Whisper Agentic Chat - Voice to Text";
    }
  };

  const getButtonClassName = () => {
    const baseClasses = "rounded-full transition-all duration-200";

    switch (recordingState) {
      case "recording":
        return `${baseClasses} bg-red-500 text-white hover:bg-red-600 animate-pulse`;
      case "processing":
      case "transcribing":
        return `${baseClasses} bg-orange-500 text-white`;
      case "sending":
        return `${baseClasses} bg-blue-500 text-white`;
      case "idle":
      default:
        return `${baseClasses} text-gray-600 hover:bg-orange-100 hover:text-orange-600`;
    }
  };

  return (
    <div className={`relative group ${className}`}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              onClick={handleAgenticChatClick}
              disabled={
                disabled ||
                recordingState === "processing" ||
                recordingState === "transcribing" ||
                recordingState === "sending"
              }
              className={getButtonClassName()}
              aria-label={getTooltipText()}
            >
              {getButtonContent()}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{getTooltipText()}</p>
            {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Visual feedback for recording state */}
      {recordingState === "recording" && (
        <div className="absolute -inset-2 rounded-full border-2 border-red-500 animate-pulse opacity-60 pointer-events-none" />
      )}
    </div>
  );
}
