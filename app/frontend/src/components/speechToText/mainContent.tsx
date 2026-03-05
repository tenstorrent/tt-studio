// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useRef, useMemo } from "react";
import { Copy, Play, Pause, Volume2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useTheme } from "../../hooks/useTheme";
import { MetricsPanel } from "./MetricsPanel";
import type { Conversation, ConversationMessage, PipelineMetrics } from "./types";

interface MainContentProps {
  conversations: Conversation[];
  selectedConversation: string | null;
  isStreaming?: boolean;
  isTTSGenerating?: boolean;
  metrics: PipelineMetrics | null;
}

type TabId = "conversation" | "metrics";

export function MainContent({
  conversations,
  selectedConversation,
  isStreaming = false,
  isTTSGenerating = false,
  metrics,
}: MainContentProps) {
  const [activeTab, setActiveTab] = useState<TabId>("conversation");
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

  const tabs: { id: TabId; label: string }[] = [
    { id: "conversation", label: "Conversation" },
    { id: "metrics", label: "Metrics" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div
        className={cn(
          "flex items-center gap-1 px-2 border-b",
          theme === "dark" ? "border-[#1A1A1A]" : "border-gray-200"
        )}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors relative",
              activeTab === tab.id
                ? "text-TT-purple-accent"
                : theme === "dark"
                  ? "text-gray-500 hover:text-gray-300"
                  : "text-gray-400 hover:text-gray-600"
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-TT-purple-accent" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "conversation" ? (
        <div
          ref={contentContainerRef}
          className={cn(
            "flex-1 overflow-y-auto",
            theme === "dark" ? "bg-[#0D0D0D]" : "bg-[#FAFAFA]"
          )}
        >
          <div className="p-3 sm:p-4 max-w-3xl mx-auto">
            {selectedConversationData &&
            selectedConversationData.messages.length > 0 ? (
              <div className="flex flex-col gap-5">
                {selectedConversationData.messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    theme={theme}
                    onCopy={copyToClipboard}
                  />
                ))}

                {isStreaming && (
                  <div className="flex items-center gap-1.5 px-1 py-2">
                    <span
                      className="w-1.5 h-1.5 bg-TT-purple-accent rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="w-1.5 h-1.5 bg-TT-purple-accent rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="w-1.5 h-1.5 bg-TT-purple-accent rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                )}

                {isTTSGenerating && (
                  <div
                    className={cn(
                      "flex items-center gap-2 px-1 py-2 text-xs",
                      theme === "dark" ? "text-gray-500" : "text-gray-400"
                    )}
                  >
                    <Volume2 className="h-3.5 w-3.5 animate-pulse" />
                    <span>Generating audio...</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full min-h-[300px]">
                <p
                  className={cn(
                    "text-sm",
                    theme === "dark" ? "text-gray-600" : "text-gray-400"
                  )}
                >
                  {selectedConversation
                    ? "Record a message to start the conversation"
                    : "Start a new conversation"}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "flex-1 overflow-y-auto",
            theme === "dark" ? "bg-[#0D0D0D]" : "bg-[#FAFAFA]"
          )}
        >
          <MetricsPanel metrics={metrics} />
        </div>
      )}
    </div>
  );
}

function ChatMessage({
  message,
  theme,
  onCopy,
}: {
  message: ConversationMessage;
  theme: string;
  onCopy: (text: string) => void;
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
    <div className="flex flex-col gap-1">
      {/* Role label + timestamp */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-xs font-semibold",
            isUser ? "text-TT-purple-accent" : "text-green-500"
          )}
        >
          {isUser ? "user" : "assistant"}
        </span>
        <span
          className={cn(
            "text-[10px]",
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
          "text-sm leading-relaxed",
          theme === "dark" ? "text-gray-200" : "text-gray-800"
        )}
      >
        {message.text || (
          <span className="opacity-40 italic">
            {message.isStreaming ? "Thinking..." : ""}
          </span>
        )}
        {message.isStreaming && message.text && (
          <span className="inline-block w-1 h-3.5 bg-TT-purple-accent ml-0.5 animate-pulse align-text-bottom" />
        )}
      </div>

      {/* Audio playback */}
      {message.audioBlob && audioSrc && (
        <CompactAudioPlayer src={audioSrc} theme={theme} />
      )}

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
        theme === "dark" ? "bg-[#151515]" : "bg-gray-100"
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
          theme === "dark" ? "bg-[#222]" : "bg-gray-200"
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
