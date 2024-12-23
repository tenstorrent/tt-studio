// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useEffect, useRef } from "react";
import { Button } from "../ui/button";
import { Paperclip, Send } from "lucide-react";
import { VoiceInput } from "./VoiceInput";

interface InputAreaProps {
  textInput: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  handleInference: (input: string) => void;
  isStreaming: boolean;
  isListening: boolean;
  setIsListening: (isListening: boolean) => void;
}

export default function InputArea({
  textInput,
  setTextInput,
  handleInference,
  isStreaming,
  isListening,
  setIsListening,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  useEffect(() => {
    if (textareaRef.current) {
      adjustTextareaHeight();
    }
  }, [textInput]);

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleInference(textInput);
    }
  };

  const handleVoiceInput = (transcript: string) => {
    setTextInput((prevInput) => prevInput + " " + transcript);
  };

  return (
    <div className="flex-shrink-0 w-full">
      <div className="relative w-full bg-white dark:bg-[#2A2A2A] rounded-lg p-4 shadow-lg dark:shadow-2xl border border-gray-200 dark:border-[#7C68FA]/20 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={textInput}
          onChange={handleTextAreaInput}
          onKeyDown={handleKeyPress}
          placeholder="Enter your prompt"
          className="w-full bg-transparent text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-white/70 border-none focus:outline-none resize-none font-rmMono text-base overflow-y-auto"
          disabled={isStreaming}
          rows={1}
          style={{
            minHeight: "24px",
            maxHeight: "200px",
          }}
        />
        <div className="flex justify-between items-center mt-2">
          <div className="flex gap-2 items-center">
            <Button
              type="button"
              variant="ghost"
              className="text-gray-600 dark:text-white/70 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 p-2 rounded-full flex items-center justify-center transition-colors duration-300"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            <VoiceInput
              onTranscript={handleVoiceInput}
              isListening={isListening}
              setIsListening={setIsListening}
            />
          </div>
          <Button
            onClick={() => handleInference(textInput)}
            disabled={isStreaming || !textInput.trim()}
            className="bg-[#7C68FA] hover:bg-[#7C68FA]/80 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors duration-300"
          >
            Generate
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {isStreaming && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#7C68FA] to-[#7C68FA] animate-pulse-ripple-x" />
          </div>
        )}
      </div>
    </div>
  );
}
