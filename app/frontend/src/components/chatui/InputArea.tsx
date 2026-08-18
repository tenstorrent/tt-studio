// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Send, X, Plus, Globe, Check } from "lucide-react";
import { VoiceInput } from "./VoiceInput";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { TypingAnimation } from "../ui/typing-animation";

interface InputAreaProps {
  textInput: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  handleInference: () => void;
  isStreaming: boolean;
  isListening: boolean;
  setIsListening: (isListening: boolean) => void;
  isMobileView?: boolean;
  onCreateNewConversation?: () => void;
  onStopInference?: () => void;
  showInitialPromptAnimation?: boolean;
  isAgentSelected?: boolean;
  setIsAgentSelected?: (value: boolean) => void;
  isAgentAvailable?: boolean;
  /** Voice input is only shown when a speech recognition path is available. */
  voiceInputAvailable?: boolean;
  sttDeployId?: string | null;
}

const EXAMPLE_PROMPTS = [
  "How can I help you today?",
  "What would you like to know?",
  "Ask me anything!",
  "I'm here to assist you.",
  "What's on your mind?",
];

export default function InputArea({
  textInput,
  setTextInput,
  handleInference,
  isStreaming,
  isListening,
  setIsListening,
  isMobileView = false,
  onCreateNewConversation,
  onStopInference,
  showInitialPromptAnimation = true,
  isAgentSelected = false,
  setIsAgentSelected,
  isAgentAvailable = false,
  voiceInputAvailable = false,
  sttDeployId = null,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isTouched, setIsTouched] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [touchFeedback, setTouchFeedback] = useState("");

  // Close plus menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setIsPlusMenuOpen(false);
      }
    };
    if (isPlusMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isPlusMenuOpen]);

  // Add a meta viewport setting effect
  useEffect(() => {
    // Ensure proper viewport meta tag settings for mobile
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
      viewportMeta.setAttribute(
        "content",
        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
      );
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current && !isStreaming) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  useEffect(() => {
    if (textareaRef.current) {
      adjustTextareaHeight();
    }
  }, []);

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      // Reset height first to get accurate scrollHeight
      textareaRef.current.style.height = "auto";

      // Set appropriate max heights for mobile vs desktop
      const maxHeight = isMobileView ? 80 : 200;

      // Calculate new height (minimum 36px for mobile to show a line of text)
      const minHeight = isMobileView ? 36 : 24;
      const scrollHeight = Math.min(
        Math.max(textareaRef.current.scrollHeight, minHeight),
        maxHeight
      );

      textareaRef.current.style.height = `${scrollHeight}px`;

      // Only enable scrolling when content exceeds the maximum height
      textareaRef.current.style.overflowY =
        textareaRef.current.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
    setIsTyping(true);
    // Reset typing indicator after a short delay
    clearTimeout((window as any).typingTimeout);
    (window as any).typingTimeout = setTimeout(() => {
      setIsTyping(false);
    }, 1000);
    adjustTextareaHeight();
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isStreaming) {
      e.preventDefault();
      if (textInput.trim() !== "") {
        handleInference();
        setTextInput("");
      }
    }
  };

  const handleVoiceInput = (transcript: string) => {
    setTextInput((prevText) => prevText + (prevText ? " " : "") + transcript);
    setIsTyping(true);
    clearTimeout((window as any).typingTimeout);
    (window as any).typingTimeout = setTimeout(() => {
      setIsTyping(false);
    }, 1000);
    adjustTextareaHeight();
  };

  const handleTouchStart = (message: string) => {
    setTouchFeedback(message);
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  const handleTouchEnd = () => {
    setTimeout(() => setTouchFeedback(""), 500);
  };

  useEffect(() => {
    adjustTextareaHeight();
    window.addEventListener("resize", adjustTextareaHeight);
    return () => window.removeEventListener("resize", adjustTextareaHeight);
  }, [textInput]);

  return (
    <>
      {touchFeedback && (
        <div className="fixed top-1/4 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gray-800 text-white text-sm rounded-lg px-4 py-2 z-50 opacity-80">
          {touchFeedback}
        </div>
      )}

      <div className="shrink-0 w-full mt-2">
        <div
          className={cn(
            "relative w-full bg-white dark:bg-[#2A2A2A] rounded-lg p-2 sm:p-4 shadow-lg dark:shadow-2xl border transition-all duration-200",
            isTyping && !textInput
              ? "border-[#7C68FA] dark:border-[#7C68FA] shadow-[0_0_0_1px_#7C68FA]"
              : isFocused || isTouched
                ? "border-[#7C68FA]/70 dark:border-[#7C68FA]/60"
                : isHovered
                  ? "border-gray-400/70 dark:border-white/30"
                  : "border-gray-200 dark:border-[#7C68FA]/20",
          )}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onTouchStart={() => setIsTouched(true)}
          onTouchEnd={() => {
            setTimeout(() => setIsTouched(false), 300);
          }}
        >
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={textInput}
              onChange={handleTextAreaInput}
              onKeyDown={handleKeyPress}
              placeholder=""
              className="w-full h-full bg-transparent border-none focus:outline-none resize-none font-mono text-base leading-normal overflow-y-auto py-1 px-1 text-gray-900 dark:text-white font-medium"
              disabled={isStreaming}
              rows={1}
              style={{
                minHeight: isMobileView ? "36px" : "24px",
                maxHeight: isMobileView ? "80px" : "200px",
                fontSize: isMobileView ? "16px" : "inherit",
                lineHeight: isMobileView ? "1.2" : "inherit",
                WebkitAppearance: "none",
              }}
              aria-label="Chat input"
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onTouchStart={() => setIsTouched(true)}
              onTouchEnd={() => {
                setTimeout(() => {
                  if (!isFocused) setIsTouched(false);
                }, 300);
              }}
            />
            {showInitialPromptAnimation && !textInput && !isFocused && (
              <div className="absolute inset-0 pointer-events-none">
                <TypingAnimation
                  texts={EXAMPLE_PROMPTS}
                  duration={50}
                  cycleDelay={2000}
                  className="absolute inset-0 flex items-center px-1 text-gray-600 dark:text-gray-200"
                />
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mt-2">
            <div className="flex gap-2 items-center">
              {/* ChatGPT-style plus menu */}
              {isAgentAvailable && setIsAgentSelected && (
                <div className="relative" ref={plusMenuRef}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size={isMobileView ? "sm" : "default"}
                          className={cn(
                            "p-1 sm:p-2 rounded-full flex items-center justify-center transition-all duration-200",
                            isPlusMenuOpen
                              ? "bg-[#7C68FA]/20 text-[#7C68FA] dark:text-[#7C68FA] rotate-45"
                              : "text-gray-600 dark:text-white/90 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20"
                          )}
                          onClick={() => setIsPlusMenuOpen((prev) => !prev)}
                          aria-label="More options"
                        >
                          <Plus className={isMobileView ? "h-4 w-4" : "h-5 w-5"} />
                        </Button>
                      </TooltipTrigger>
                      {!isPlusMenuOpen && (
                        <TooltipContent><p>More options</p></TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>

                  {isPlusMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 z-30 w-56 rounded-xl bg-white dark:bg-[#1E1E2E] border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden">
                      <button
                        type="button"
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors",
                          isAgentSelected
                            ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                            : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#7C68FA]/10"
                        )}
                        onClick={() => {
                          setIsAgentSelected(!isAgentSelected);
                          setIsPlusMenuOpen(false);
                        }}
                      >
                        <Globe className="h-4 w-4" />
                        <span className="flex-1 text-left">Web search</span>
                        {isAgentSelected && <Check className="h-4 w-4" />}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Web search active pill */}
              {isAgentSelected && isAgentAvailable && (
                <button
                  type="button"
                  onClick={() => setIsAgentSelected?.(!isAgentSelected)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                >
                  <Globe className="h-3 w-3" />
                  <span>Search</span>
                  <X className="h-3 w-3" />
                </button>
              )}

              {voiceInputAvailable && (
                <div className="relative group">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <VoiceInput
                            onTranscript={handleVoiceInput}
                            isListening={isListening}
                            setIsListening={setIsListening}
                            deployId={sttDeployId}
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Voice input</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {isMobileView && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      {isListening ? "Stop recording" : "Voice input"}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
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
                      bg-transparent border border-[#7C68FA]/50 hover:bg-[#7C68FA]/10 active:bg-[#7C68FA]/20 text-[#7C68FA] dark:text-[#7C68FA] dark:border-[#7C68FA]/60
                      rounded-full flex items-center transition-all duration-200 touch-manipulation
                      ${isMobileView
                        ? "justify-center h-8 w-8 p-0"
                        : "justify-center gap-1.5 px-3 py-1"
                      }
                    `}
                    aria-label="Start a new chat"
                  >
                    <Plus className={isMobileView ? "h-4 w-4" : "h-4 w-4"} />
                    {!isMobileView && <span className="text-xs">New chat</span>}
                  </Button>
                  {isMobileView && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      New chat
                    </div>
                  )}
                </div>
              )}

              {isStreaming ? (
                <div className="relative group">
                  <Button
                    onClick={() => {
                      if (onStopInference) {
                        handleTouchStart("Stopping generation");
                        onStopInference();
                        handleTouchEnd();
                      }
                    }}
                    onTouchStart={() => handleTouchStart("Stopping generation")}
                    onTouchEnd={handleTouchEnd}
                    className={`
                      bg-red-500 hover:bg-red-600 active:bg-red-700 text-white
                      dark:bg-red-500 dark:hover:bg-red-600 dark:active:bg-red-700
                      ${isMobileView ? "px-3 py-2 text-sm" : "px-4 py-2 text-sm"}
                      rounded-lg flex items-center gap-1 sm:gap-2 transition-all duration-200 touch-manipulation
                    `}
                    aria-label="Stop generation"
                  >
                    {isMobileView ? (
                      <X className="h-4 w-4" />
                    ) : (
                      <>
                        Stop
                        <X className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                  {isMobileView && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      Stop generation
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative group">
                  <Button
                    onClick={() => {
                      if (textInput.trim() !== "" && !isStreaming) {
                        handleTouchStart("Sending message");
                        handleInference();
                        setTextInput("");
                        handleTouchEnd();
                      }
                    }}
                    onTouchStart={() => {
                      if (textInput.trim() !== "" && !isStreaming) {
                        handleTouchStart("Sending message");
                      }
                    }}
                    onTouchEnd={handleTouchEnd}
                    disabled={isStreaming || !textInput.trim()}
                    className={`
                      ${!textInput.trim() || isStreaming
                        ? "bg-gray-400 dark:bg-gray-600 text-gray-600 dark:text-gray-300 cursor-not-allowed"
                        : "bg-[#7C68FA] hover:bg-[#7C68FA]/90 active:bg-[#7C68FA]/80 dark:bg-emerald-600 dark:hover:bg-emerald-700 dark:active:bg-emerald-800 text-white font-semibold cursor-pointer"
                      }
                      ${isMobileView ? "px-3 py-2 text-sm" : "px-4 py-2 text-sm"}
                      rounded-lg flex items-center gap-1 sm:gap-2 transition-all duration-200 touch-manipulation
                      border-0 outline-none focus:outline-none focus:ring-0
                    `}
                    aria-label={
                      isMobileView ? "Send message" : "Generate response"
                    }
                  >
                    {isMobileView ? (
                      <Send className="h-4 w-4" />
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
              )}
            </div>
          </div>

          {isStreaming && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#7C68FA] to-[#7C68FA] animate-pulse-ripple-x" />
            </div>
          )}
        </div>

        {showBanner && (
          <div className="w-full mt-2">
            <div
              className={`
                bg-[#1a1625] rounded-lg flex justify-between items-center
                ${isMobileView ? "p-2 text-xs" : "p-3 text-sm"}
              `}
            >
              <div className="text-gray-300 dark:text-gray-100">
                {isMobileView
                  ? "LLM's can make mistakes."
                  : "LLM's can make mistakes. Check important infos"}
              </div>
              <button
                className="text-gray-400 dark:text-gray-300 hover:text-gray-300 dark:hover:text-gray-200 ml-2"
                onClick={() => setShowBanner(false)}
                title="Dismiss"
              >
                <X className={`${isMobileView ? "h-3 w-3" : "h-4 w-4"}`} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
