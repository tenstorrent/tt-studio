// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "../ui/button";
import { Mic, MicOff } from "lucide-react";
import { SpeechRecognition, SpeechRecognitionEvent } from "./types";

interface VoiceInputProps {
  onTranscript: (transcript: string) => void;
}

export function VoiceInput({ onTranscript }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(
    null,
  );
  const transcriptRef = useRef("");
  const lastFinalizedTranscriptRef = useRef("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognitionInstance = new SpeechRecognition();

        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;
        recognitionInstance.lang = "en-US";

        recognitionInstance.onresult = (event: SpeechRecognitionEvent) => {
          let interimTranscript = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          if (finalTranscript) {
            transcriptRef.current = (
              transcriptRef.current +
              " " +
              finalTranscript
            ).trim();

            const newContent = transcriptRef.current
              .replace(lastFinalizedTranscriptRef.current, "")
              .trim();

            if (newContent) {
              onTranscript(newContent);
              lastFinalizedTranscriptRef.current = transcriptRef.current;
            }

            setIsSpeaking(false);
          } else if (interimTranscript) {
            setIsSpeaking(true);
          }
        };

        recognitionInstance.onend = () => {
          if (isListening) {
            recognitionInstance.start();
          }
          setIsSpeaking(false);
        };

        recognitionInstance.onerror = (event) => {
          console.error("Speech recognition error", event.error);
          setIsSpeaking(false);
        };

        setRecognition(recognitionInstance);
      }
    }
  }, [onTranscript, isListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognition?.stop();
      transcriptRef.current = "";
      lastFinalizedTranscriptRef.current = "";
      setIsSpeaking(false);
    } else {
      recognition?.start();
    }
    setIsListening(!isListening);
  }, [isListening, recognition]);

  if (!recognition) {
    return null;
  }

  return (
    <div className="relative">
      <Button
        onClick={toggleListening}
        variant="ghost"
        className={`text-gray-600 dark:text-white/70 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 p-2 rounded-full flex items-center justify-center transition-colors duration-300 ${
          isListening ? "bg-[#7C68FA]/20" : ""
        }`}
      >
        {isListening ? (
          <Mic className="h-5 w-5" />
        ) : (
          <MicOff className="h-5 w-5" />
        )}
      </Button>
      {isListening && (
        <>
          {/* Pulsing dot indicator */}
          <div className="absolute -top-1 -right-1 w-3 h-3">
            <div className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7C68FA] opacity-75"></div>
            <div className="relative inline-flex rounded-full h-3 w-3 bg-[#7C68FA]"></div>
          </div>

          {/* Sound wave animation */}
          {isSpeaking && (
            <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 flex gap-1">
              <div className="w-1 h-3 bg-[#7C68FA] rounded-full animate-sound-wave-1"></div>
              <div className="w-1 h-3 bg-[#7C68FA] rounded-full animate-sound-wave-2"></div>
              <div className="w-1 h-3 bg-[#7C68FA] rounded-full animate-sound-wave-3"></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
