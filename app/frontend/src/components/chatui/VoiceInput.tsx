// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "../ui/button";
import { Mic, MicOff } from "lucide-react";
import type {
  SpeechRecognition,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
  VoiceInputProps,
} from "./types";

interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

export function VoiceInput({
  onTranscript,
  isListening,
  setIsListening,
}: VoiceInputProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanTranscript: (text: string) => string = useCallback(
    (text: string): string => {
      const cleaned = text.replace(/\s+/g, " ").trim();
      const words = cleaned.split(" ");
      const uniqueWords = words.filter((word, index) => {
        const prevWord = words[index - 1];
        return word !== prevWord;
      });
      return uniqueWords.join(" ");
    },
    []
  );

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

  const startAudioAnalysis = useCallback(async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const AudioContextConstructor =
        window.AudioContext || (window as WindowWithWebkit).webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error("AudioContext is not supported in this browser.");
      }
      audioContextRef.current = new AudioContextConstructor();
      analyserRef.current = audioContextRef.current.createAnalyser();
      sourceRef.current = audioContextRef.current.createMediaStreamSource(
        streamRef.current
      );
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
  }, [updateBars]);

  const cleanupResources = useCallback(() => {
    // Stop speech recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      recognitionRef.current = null;
    }

    // Stop audio analysis and clean up resources
    stopAudioAnalysis();

    // Release all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Reset state
    setIsListening(false);
    setErrorMessage(null);
  }, [setIsListening, stopAudioAnalysis, setErrorMessage]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      try {
        const SpeechRecognitionConstructor =
          window.SpeechRecognition ||
          (window as WindowWithWebkit).webkitSpeechRecognition;

        if (!SpeechRecognitionConstructor) {
          throw new Error(
            "SpeechRecognition is not supported in this browser."
          );
        }

        recognitionRef.current = new SpeechRecognitionConstructor();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = "en-US";

        recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            }
          }

          if (finalTranscript) {
            const cleanedContent = cleanTranscript(finalTranscript.trim());
            onTranscript(cleanedContent);
          }
        };

        recognitionRef.current.onerror = (
          event: SpeechRecognitionErrorEvent
        ) => {
          console.error("Speech recognition error", event.error);
          setErrorMessage(`Error: ${event.error}`);
          setIsListening(false);
          cleanupResources();
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
          cleanupResources();
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
      startAudioAnalysis();
    } catch (error) {
      console.error("Error starting speech recognition", error);
      setErrorMessage("Error starting speech recognition. Please try again.");
    }
  }, [
    onTranscript,
    setIsListening,
    cleanTranscript,
    startAudioAnalysis,
    cleanupResources,
  ]);

  const stopListening = useCallback(() => {
    cleanupResources();
  }, [cleanupResources]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  return (
    <div className="relative inline-flex items-center">
      <Button
        onClick={toggleListening}
        variant="ghost"
        className={`relative text-gray-600 dark:text-white/90 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 p-2 rounded-full flex items-center justify-center transition-colors duration-300 ${
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
