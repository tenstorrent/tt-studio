// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "../ui/button";
import { Mic, MicOff } from "lucide-react";
import type {
  SpeechRecognition,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
} from "./types";

interface VoiceInputProps {
  onTranscript: (transcript: string) => void;
  isListening: boolean;
  setIsListening: (isListening: boolean) => void;
}

export function VoiceInput({
  onTranscript,
  isListening,
  setIsListening,
}: VoiceInputProps) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const cleanTranscript = (text: string): string => {
    const cleaned = text.replace(/\s+/g, " ").trim();
    const words = cleaned.split(" ");
    const uniqueWords = words.filter((word, index) => {
      const prevWord = words[index - 1];
      return word !== prevWord;
    });
    return uniqueWords.join(" ");
  };

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      try {
        const SpeechRecognitionConstructor =
          window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognitionConstructor) {
          throw new Error(
            "SpeechRecognition is not supported in this browser.",
          );
        }

        recognitionRef.current = new SpeechRecognitionConstructor();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = "en-US";

        recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
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
            const cleanedContent = cleanTranscript(finalTranscript.trim());
            onTranscript(cleanedContent);
            setIsSpeaking(false);
          } else if (interimTranscript) {
            setIsSpeaking(true);
          }
        };

        recognitionRef.current.onerror = (
          event: SpeechRecognitionErrorEvent,
        ) => {
          console.error("Speech recognition error", event.error);
          setErrorMessage(`Error: ${event.error}`);
          setIsListening(false);
          setIsSpeaking(false);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
          setIsSpeaking(false);
        };
      } catch (error) {
        console.error("Speech recognition not supported", error);
        setErrorMessage("Speech recognition is not supported in this browser.");
        return;
      }
    }

    try {
      recognitionRef.current?.start();
      setIsListening(true);
      setErrorMessage(null);
    } catch (error) {
      console.error("Error starting speech recognition", error);
      setErrorMessage("Error starting speech recognition. Please try again.");
    }
  }, [onTranscript, setIsListening]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    setIsSpeaking(false);
  }, [setIsListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

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
          <div className="absolute -top-1 -right-1 w-3 h-3">
            <div className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7C68FA] opacity-75"></div>
            <div className="relative inline-flex rounded-full h-3 w-3 bg-[#7C68FA]"></div>
          </div>
          {isSpeaking && (
            <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 flex gap-1">
              <div className="w-1 h-3 bg-[#7C68FA] rounded-full animate-sound-wave-1"></div>
              <div className="w-1 h-3 bg-[#7C68FA] rounded-full animate-sound-wave-2"></div>
              <div className="w-1 h-3 bg-[#7C68FA] rounded-full animate-sound-wave-3"></div>
            </div>
          )}
        </>
      )}
      {errorMessage && (
        <p className="text-red-500 text-sm mt-2">{errorMessage}</p>
      )}
    </div>
  );
}
