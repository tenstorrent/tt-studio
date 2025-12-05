// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Video, Paperclip, Send } from "lucide-react";
import { LoadingDots } from "../ui/loading-dots";

interface VideoInputAreaProps {
  textInput: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  handleGenerate: (input: string) => void;
  isGenerating: boolean;
}

export default function VideoInputArea({
  textInput,
  setTextInput,
  handleGenerate,
  isGenerating,
}: VideoInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      adjustTextareaHeight();
    }
  }, []);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
    adjustTextareaHeight();
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate(textInput);
    }
  };

  return (
    <div className="shrink-0 w-full">
      <div
        className={`relative w-full bg-white dark:bg-[#2A2A2A] rounded-lg p-4 shadow-lg dark:shadow-2xl overflow-hidden transition-all duration-300 ${
          isFocused
            ? "border-2 border-gray-800 dark:border-white"
            : "border border-gray-200 dark:border-[#7C68FA]/20"
        }`}
      >
        <textarea
          ref={textareaRef}
          value={textInput}
          onChange={handleTextAreaInput}
          onKeyDown={handleKeyPress}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Describe the video you want to generate... (e.g., 'Volcano on a beach')"
          className="w-full h-full bg-transparent border-none focus:outline-none resize-none font-mono text-base overflow-y-auto text-gray-900 dark:text-white font-medium"
          disabled={isGenerating}
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
              className="text-gray-600 dark:text-white/90 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 p-2 rounded-full flex items-center justify-center transition-colors duration-300"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
          </div>
          <Button
            onClick={() => handleGenerate(textInput)}
            disabled={isGenerating || !textInput.trim()}
            className={`${
              isGenerating || !textInput.trim()
                ? "bg-gray-400 dark:bg-gray-600 text-gray-600 dark:text-gray-300 cursor-not-allowed"
                : "bg-[#7C68FA] hover:bg-[#7C68FA]/80 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white font-semibold cursor-pointer"
            } px-4 py-2 rounded-lg flex items-center gap-2 transition-colors duration-300`}
          >
            {isGenerating ? (
              <LoadingDots size={3}>
                <span>Generating</span>
              </LoadingDots>
            ) : (
              "Generate"
            )}
            {!isGenerating && <Send className="h-4 w-4" />}
          </Button>
        </div>
        {isGenerating && (
          <>
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#7C68FA] to-[#7C68FA] animate-pulse-ripple-x" />
            </div>
            <div className="mt-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-yellow-600 dark:text-yellow-400 animate-pulse" />
                <LoadingDots size={3}>
                  <span className="text-sm text-yellow-600 dark:text-yellow-400 font-medium">
                    Generating video
                  </span>
                </LoadingDots>
              </div>
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1 ml-6">
                This process takes 2-3 minutes. Please be patient and keep this
                tab open and come back later
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
