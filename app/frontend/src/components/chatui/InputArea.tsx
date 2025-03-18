// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Paperclip, Send, X, Plus } from "lucide-react";
import { VoiceInput } from "./VoiceInput";

interface InputAreaProps {
  textInput: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  handleInference: (input: string) => void;
  isStreaming: boolean;
  isListening: boolean;
  setIsListening: (isListening: boolean) => void;
  isMobileView?: boolean;
  onCreateNewConversation?: () => void;
}

export default function InputArea({
  textInput,
  setTextInput,
  handleInference,
  isStreaming,
  isListening,
  setIsListening,
  isMobileView = false,
  onCreateNewConversation,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showBanner, setShowBanner] = useState(true);

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
      const maxHeight = isMobileView ? 120 : 200; // Lower max height on mobile
      const scrollHeight = Math.min(
        textareaRef.current.scrollHeight,
        maxHeight
      );
      textareaRef.current.style.height = `${scrollHeight}px`;

      // If content is larger than maxHeight, enable scrolling
      textareaRef.current.style.overflowY =
        textareaRef.current.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (textInput.trim() !== "") {
        handleInference(textInput);
      }
    }
  };

  const handleVoiceInput = (transcript: string) => {
    setTextInput((prevInput) => prevInput + " " + transcript);
  };

  const [touchFeedback, setTouchFeedback] = useState("");

  const handleTouchStart = (message: string) => {
    setTouchFeedback(message);
    // Haptic feedback if available
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  const handleTouchEnd = () => {
    setTimeout(() => setTouchFeedback(""), 500);
  };

  return (
    <div className="flex-shrink-0 w-full mt-2">
      {/* Touch feedback notification */}
      {touchFeedback && (
        <div className="fixed top-1/4 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gray-800 text-white text-sm rounded-lg px-4 py-2 z-50 opacity-80">
          {touchFeedback}
        </div>
      )}

      <div className="relative w-full bg-white dark:bg-[#2A2A2A] rounded-lg p-2 sm:p-4 shadow-lg dark:shadow-2xl border border-gray-200 dark:border-[#7C68FA]/20 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={textInput}
          onChange={handleTextAreaInput}
          onKeyDown={handleKeyPress}
          placeholder={isMobileView ? "Type message..." : "Enter your prompt"}
          className="w-full bg-transparent text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-white/70 border-none focus:outline-none resize-none font-rmMono text-sm sm:text-base overflow-y-auto py-1"
          disabled={isStreaming}
          rows={1}
          style={{
            minHeight: isMobileView ? "20px" : "24px",
            maxHeight: isMobileView ? "120px" : "200px",
          }}
        />
        <div className="flex justify-between items-center mt-2">
          <div className="flex gap-1 sm:gap-2 items-center">
            {/* Show fewer buttons on mobile */}
            {!isMobileView && (
              <Button
                type="button"
                variant="ghost"
                size={isMobileView ? "sm" : "default"}
                className="text-gray-600 dark:text-white/70 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 p-1 sm:p-2 rounded-full flex items-center justify-center transition-colors duration-300"
                title="Attach files"
              >
                <Paperclip
                  className={`${isMobileView ? "h-4 w-4" : "h-5 w-5"}`}
                />
              </Button>
            )}
            <div className="relative group">
              <VoiceInput
                onTranscript={handleVoiceInput}
                isListening={isListening}
                setIsListening={setIsListening}
                // isMobileView={isMobileView}
              />
              {isMobileView && (
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                  {isListening ? "Stop recording" : "Voice input"}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* New Chat button inside input area (for both mobile and desktop) */}
            {onCreateNewConversation && (
              <div className="relative group">
                <Button
                  onClick={() => {
                    handleTouchStart("Creating new chat");
                    onCreateNewConversation();
                    handleTouchEnd();
                  }}
                  onTouchStart={() => handleTouchStart("Creating new chat")}
                  onTouchEnd={handleTouchEnd}
                  size="sm"
                  className={`
                    bg-transparent border border-[#7C68FA]/50 hover:bg-[#7C68FA]/10 active:bg-[#7C68FA]/20 text-[#7C68FA] 
                    rounded-full flex items-center transition-all duration-200 touch-manipulation
                    ${
                      isMobileView
                        ? "justify-center h-7 w-7 p-0"
                        : "justify-center gap-1.5 px-3 py-1"
                    }
                  `}
                  aria-label="Start a new chat"
                >
                  <Plus className={isMobileView ? "h-3 w-3" : "h-4 w-4"} />
                  {!isMobileView && <span className="text-xs">New chat</span>}
                </Button>
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                  New chat
                </div>
              </div>
            )}
            <div className="relative group">
              <Button
                onClick={() => {
                  if (textInput.trim() && !isStreaming) {
                    handleTouchStart("Sending message");
                    handleInference(textInput);
                    handleTouchEnd();
                  }
                }}
                onTouchStart={() => {
                  if (textInput.trim() && !isStreaming) {
                    handleTouchStart("Sending message");
                  }
                }}
                onTouchEnd={handleTouchEnd}
                disabled={isStreaming || !textInput.trim()}
                className={`
                  bg-[#7C68FA] hover:bg-[#7C68FA]/80 active:bg-[#7C68FA]/90 text-white 
                  ${isMobileView ? "px-2 py-1 text-xs" : "px-4 py-2 text-sm"} 
                  rounded-lg flex items-center gap-1 sm:gap-2 transition-all duration-200 touch-manipulation
                  ${!textInput.trim() || isStreaming ? "opacity-70" : ""}
                `}
                aria-label={isMobileView ? "Send message" : "Generate response"}
              >
                {isMobileView ? (
                  <Send className="h-3 w-3" />
                ) : (
                  <>
                    Generate
                    <Send className="h-4 w-4" />
                  </>
                )}
              </Button>
              {isMobileView && (
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                  {isStreaming ? "Generating..." : "Send message"}
                </div>
              )}
            </div>
          </div>
        </div>
        {isStreaming && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#7C68FA] to-[#7C68FA] animate-pulse-ripple-x" />
          </div>
        )}
      </div>

      {/* Compact notification banner for mobile */}
      {showBanner && (
        <div className="w-full mt-2">
          <div
            className={`
            bg-[#1a1625] rounded-lg flex justify-between items-center
            ${isMobileView ? "p-2 text-xs" : "p-3 text-sm"}
          `}
          >
            <div className="text-gray-300">
              {isMobileView
                ? "LLM's can make mistakes."
                : "LLM's can make mistakes. Check important infos."}
            </div>
            <button
              className="text-gray-400 hover:text-gray-300 ml-2"
              onClick={() => setShowBanner(false)}
              title="Dismiss"
            >
              <X className={`${isMobileView ? "h-3 w-3" : "h-4 w-4"}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
