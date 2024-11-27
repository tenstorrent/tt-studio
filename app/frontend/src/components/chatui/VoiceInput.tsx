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
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(
    null,
  );
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");

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
            finalTranscriptRef.current += " " + finalTranscript;
            onTranscript(finalTranscriptRef.current.trim());
          }
          interimTranscriptRef.current = interimTranscript;
        };

        recognitionInstance.onend = () => {
          if (isListening) {
            recognitionInstance.start();
          }
        };

        setRecognition(recognitionInstance);
      }
    }
  }, [onTranscript, isListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognition?.stop();
      finalTranscriptRef.current = "";
      interimTranscriptRef.current = "";
    } else {
      recognition?.start();
    }
    setIsListening(!isListening);
  }, [isListening, recognition]);

  if (!recognition) {
    return null; // Or render a message that voice input is not supported
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
          <MicOff className="h-5 w-5" />
        ) : (
          <Mic className="h-5 w-5" />
        )}
      </Button>
      {isListening && (
        <div className="absolute -top-1 -right-1 w-3 h-3">
          <div className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7C68FA] opacity-75"></div>
          <div className="relative inline-flex rounded-full h-3 w-3 bg-[#7C68FA]"></div>
        </div>
      )}
    </div>
  );
}
