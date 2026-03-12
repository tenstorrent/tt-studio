// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useRef, useMemo } from "react";
import { Copy, Play, Pause, Volume2, Mic } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useTheme } from "../../hooks/useTheme";
import { motion } from "framer-motion";
import MarkdownComponent from "@/src/components/chatui/MarkdownComponent";
import type { Conversation, ConversationMessage } from "./types";

function cleanLlmText(text: string): string {
  return text
    .replace(/<\|.*?\|>(&gt;)?/g, "")
    .replace(/\b(assistant|user)\b/gi, "")
    .replace(/\|(?:eot_id|start_header_id)\|/g, "")
    .replace(/<think>.*?<\/think>/gis, "")
    .replace(/<think>.*$/is, "")
    .replace(/<\/think>/gi, "")
    .replace(/&(lt|gt);/g, "")
    .trim();
}

interface MainContentProps {
  conversations: Conversation[];
  selectedConversation: string | null;
  isStreaming?: boolean;
  isTTSGenerating?: boolean;
}

export function MainContent({
  conversations,
  selectedConversation,
  isStreaming = false,
  isTTSGenerating = false,
}: MainContentProps) {
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const { theme } = useTheme();

  const contentContainerRef = useRef<HTMLDivElement>(null);

  const selectedConversationData = selectedConversation
    ? conversations.find((c) => c.id === selectedConversation)
    : null;

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (contentContainerRef.current) {
      setTimeout(() => {
        if (contentContainerRef.current) {
          contentContainerRef.current.scrollTo({
            top: contentContainerRef.current.scrollHeight,
            behavior,
          });
        }
      }, 50);
    }
  };

  useEffect(() => {
    if (selectedConversationData?.messages.length) {
      scrollToBottom("auto");
    }
  }, [selectedConversation]);

  useEffect(() => {
    if (autoScrollEnabled && selectedConversationData?.messages.length) {
      scrollToBottom();
    }
  }, [selectedConversationData?.messages.length, autoScrollEnabled]);

  useEffect(() => {
    if (isStreaming && autoScrollEnabled) {
      const interval = setInterval(() => scrollToBottom(), 300);
      return () => clearInterval(interval);
    }
  }, [isStreaming, autoScrollEnabled]);

  useEffect(() => {
    const container = contentContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (!container) return;
      const isAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isAtBottom !== autoScrollEnabled) setAutoScrollEnabled(isAtBottom);
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div
      ref={contentContainerRef}
      className="h-full overflow-y-auto overscroll-contain"
    >
      <div className="p-3 sm:p-4 lg:p-6">
        {selectedConversationData &&
        selectedConversationData.messages.length > 0 ? (
          <div className="flex flex-col gap-5">
            {selectedConversationData.messages.map((message, index) => {
              const isLastAssistant =
                message.sender === "assistant" &&
                index ===
                  selectedConversationData.messages.findLastIndex(
                    (m) => m.sender === "assistant"
                  );
              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.03 }}
                >
                  <ChatMessage
                    message={message}
                    theme={theme}
                    onCopy={copyToClipboard}
                    isSynthesizing={isLastAssistant && isTTSGenerating}
                  />
                </motion.div>
              );
            })}

            {isStreaming && (
              <div className="flex items-center gap-1.5 px-1 py-2">
                <span
                  className="w-1.5 h-1.5 bg-TT-yellow rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="w-1.5 h-1.5 bg-TT-yellow rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="w-1.5 h-1.5 bg-TT-yellow rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] sm:min-h-[300px] gap-3 sm:gap-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 rounded-full flex items-center justify-center bg-TT-purple-accent/10">
              <Mic className="w-6 h-6 sm:w-7 sm:h-7 lg:w-8 lg:h-8 text-TT-purple-accent opacity-60" />
            </div>
            <p
              className={cn(
                "text-sm sm:text-base font-['Bricolage_Grotesque'] font-medium",
                theme === "dark" ? "text-gray-500" : "text-gray-400"
              )}
            >
              Press the microphone to start
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatMessage({
  message,
  theme,
  onCopy,
  isSynthesizing = false,
}: {
  message: ConversationMessage;
  theme: string;
  onCopy: (text: string) => void;
  isSynthesizing?: boolean;
}) {
  const isUser = message.sender === "user";

  const audioSrc = useMemo(() => {
    if (message.audioBlob) return URL.createObjectURL(message.audioBlob);
    return undefined;
  }, [message.audioBlob]);

  useEffect(() => {
    return () => {
      if (audioSrc) URL.revokeObjectURL(audioSrc);
    };
  }, [audioSrc]);

  return (
    <div className={cn(
      "flex flex-col gap-1 pl-3 border-l-2",
      isUser
        ? "border-TT-purple-accent/50"
        : theme === "dark"
          ? "border-white/[0.08]"
          : "border-black/[0.08]"
    )}>
      {/* Role label + timestamp */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-[11px] font-mono font-semibold uppercase tracking-wider",
            isUser ? "text-TT-purple-accent" : "text-TT-green"
          )}
        >
          {isUser ? "you" : "assistant"}
        </span>
        <span
          className={cn(
            "text-[10px] font-mono",
            theme === "dark" ? "text-gray-600" : "text-gray-400"
          )}
        >
          {message.date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {/* Message text */}
      <div
        className={cn(
          "text-sm leading-relaxed font-mono",
          theme === "dark" ? "text-gray-200" : "text-gray-800"
        )}
      >
        {message.text ? (
          isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          ) : (
            <MarkdownComponent>{cleanLlmText(message.text)}</MarkdownComponent>
          )
        ) : (
          <span className="opacity-40 italic">
            {message.isStreaming ? "Thinking..." : ""}
          </span>
        )}
        {message.isStreaming && message.text && (
          <span className="inline-block w-1 h-3.5 bg-TT-yellow ml-0.5 animate-pulse align-text-bottom" />
        )}
      </div>

      {/* Audio playback / synthesizing indicator */}
      {message.audioBlob && audioSrc ? (
        <CompactAudioPlayer src={audioSrc} theme={theme} />
      ) : isSynthesizing ? (
        <SynthesizingIndicator theme={theme} />
      ) : null}

      {/* Copy action */}
      {message.text && !message.isStreaming && (
        <div className="flex mt-0.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onCopy(message.text)}
                  className={cn(
                    "h-5 w-5",
                    theme === "dark"
                      ? "text-gray-600 hover:text-gray-400 hover:bg-white/5"
                      : "text-gray-300 hover:text-gray-500 hover:bg-gray-100"
                  )}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}

function SynthesizingIndicator({ theme }: { theme: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 mt-1 px-2 py-1.5 rounded-md w-fit",
        "bg-TT-green/10"
      )}
    >
      <Volume2 className="w-3.5 h-3.5 text-TT-green animate-pulse" />
      <div className="flex items-end gap-0.5 h-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="w-[3px] rounded-full bg-TT-green animate-waveform"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
      <span
        className={cn(
          "text-xs font-mono",
          theme === "dark" ? "text-TT-green/70" : "text-TT-green-accent"
        )}
      >
        Synthesizing...
      </span>
    </div>
  );
}

function CompactAudioPlayer({ src, theme }: { src: string; theme: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setPlaying(!playing);
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnded = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (el.duration) setProgress(el.currentTime / el.duration);
    };
    el.addEventListener("ended", onEnded);
    el.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, []);

  return (
    <div
      className={cn(
        "flex items-center gap-2 mt-1 px-2 py-1.5 rounded-md w-fit",
        theme === "dark" ? "bg-white/[0.04]" : "bg-black/[0.04]"
      )}
    >
      <button
        onClick={toggle}
        className={cn(
          "w-6 h-6 flex items-center justify-center rounded-full transition-colors",
          theme === "dark"
            ? "text-TT-purple-accent hover:bg-white/10"
            : "text-TT-purple-accent hover:bg-gray-200"
        )}
      >
        {playing ? (
          <Pause className="w-3 h-3" />
        ) : (
          <Play className="w-3 h-3" />
        )}
      </button>
      <div
        className={cn(
          "w-24 h-1 rounded-full overflow-hidden",
          theme === "dark" ? "bg-white/[0.08]" : "bg-black/[0.08]"
        )}
      >
        <div
          className="h-full bg-TT-purple-accent rounded-full transition-all"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <audio ref={audioRef} src={src} preload="metadata" />
    </div>
  );
}
