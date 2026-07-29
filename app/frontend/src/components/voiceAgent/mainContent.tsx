// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo, useCallback, useState, useEffect, useRef, useMemo } from "react";
import { Copy, Database, ExternalLink, Globe, Play, Pause, Search, Volume2 } from "lucide-react";
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
import type {
  Conversation,
  ConversationMessage,
  PipelineMetrics,
  PipelineStage,
} from "./types";
import { cleanLlmText } from "./lib/cleanSpeech";

// Labels for the stages where the assistant is working before any answer text
// exists, so a slow retrieval or web search doesn't look like a hang.
const ACTIVITY_LABELS: Partial<Record<PipelineStage, string>> = {
  retrieving: "Searching your documents",
  searching: "Searching the web",
  thinking: "Thinking",
};

interface MainContentProps {
  conversations: Conversation[];
  selectedConversation: string | null;
  isStreaming?: boolean;
  isTTSGenerating?: boolean;
  stage?: PipelineStage;
}

export function MainContent({
  conversations,
  selectedConversation,
  isStreaming = false,
  isTTSGenerating = false,
  stage = "idle",
}: MainContentProps) {
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const { theme } = useTheme();

  const contentContainerRef = useRef<HTMLDivElement>(null);

  const selectedConversationData = selectedConversation
    ? conversations.find((c) => c.id === selectedConversation)
    : null;

  const scrollToBottom = useCallback((behavior: "smooth" | "auto" = "smooth") => {
    const container = contentContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (selectedConversationData?.messages.length) {
      scrollToBottom("auto");
    }
  }, [selectedConversation]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoScrollEnabled && selectedConversationData?.messages.length) {
      scrollToBottom();
    }
  }, [selectedConversationData?.messages.length, autoScrollEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // While tokens stream in, follow the bottom on animation frames and only when
  // the content actually grew. The previous 300ms interval fired a *smooth*
  // scroll unconditionally, so every tick queued a new easing animation on top
  // of the one still running — that's what made streaming feel choppy. Instant
  // scroll on real growth keeps the text pinned without animation pile-up.
  useEffect(() => {
    if (!isStreaming || !autoScrollEnabled) return;
    let frame = 0;
    let lastHeight = -1;
    const follow = () => {
      const container = contentContainerRef.current;
      if (container && container.scrollHeight !== lastHeight) {
        lastHeight = container.scrollHeight;
        container.scrollTop = container.scrollHeight;
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
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

  // Stable identity, or every ChatMessage's memo would be invalidated per frame.
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  // Hoisted out of the render map, which used to run findLastIndex per message.
  const lastAssistantIndex = useMemo(
    () =>
      selectedConversationData?.messages.findLastIndex(
        (m) => m.sender === "assistant"
      ) ?? -1,
    [selectedConversationData?.messages]
  );

  return (
    <div
      ref={contentContainerRef}
      className="h-full overflow-y-auto overscroll-contain"
    >
      <div className="p-3 pb-6 sm:p-4 sm:pb-8 lg:p-6 lg:pb-10">
        {selectedConversationData &&
        selectedConversationData.messages.length > 0 ? (
          <div className="flex flex-col gap-5">
            {/* No wrapper element here on purpose: a motion.div per message
                re-rendered on every streamed frame (inline props = fresh
                identity), defeating ChatMessage's memo from the outside. The
                entrance animation lives on ChatMessage's own root instead. */}
            {selectedConversationData.messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                theme={theme}
                onCopy={copyToClipboard}
                isSynthesizing={index === lastAssistantIndex && isTTSGenerating}
                // Only the in-flight turn cares about the stage. Passing it to
                // every message would break their memo on each change.
                stage={message.isStreaming ? stage : undefined}
              />
            ))}

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
          // Empty state is centred in the panel; the message log itself stays
          // left-aligned once there's a conversation to show.
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] sm:min-h-[300px] gap-2 text-center">
            {stage === "recording" ? (
              <>
                <div className="relative w-8 h-8 flex items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-TT-red-accent/30 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-TT-red-accent" />
                </div>
                <p className="text-sm font-['Bricolage_Grotesque'] font-medium text-TT-red-accent">
                  Listening…
                </p>
              </>
            ) : (
              // Just says what the area is. How to start is the mic button's
              // own status line right below it — saying it in both places put
              // the same "Hey Quiet Box" hint on screen twice.
              <p
                className={cn(
                  "text-sm sm:text-base font-['Bricolage_Grotesque'] font-medium",
                  theme === "dark" ? "text-gray-300" : "text-gray-600"
                )}
              >
                Your conversation will appear here
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ChatMessage = memo(function ChatMessage({
  message,
  theme,
  onCopy,
  isSynthesizing = false,
  stage = "idle",
}: {
  message: ConversationMessage;
  theme: string;
  onCopy: (text: string) => void;
  isSynthesizing?: boolean;
  stage?: PipelineStage;
}) {
  const isUser = message.sender === "user";
  // cleanLlmText runs ~15 chained regex replacements over the whole message.
  // Uncached, that ran for every message on every streamed frame — O(n²) over a
  // turn. Keyed on the text so only the message that actually changed pays.
  const displayText = useMemo(
    () => (isUser ? message.text : cleanLlmText(message.text)),
    [isUser, message.text]
  );
  // Search markers can arrive before any answer text — show what's happening
  // instead of an empty bubble.
  const activityLabel =
    !isUser && message.isStreaming && !displayText
      ? ACTIVITY_LABELS[stage] ?? "Thinking"
      : null;
  const latestQuery = message.searchQueries?.[message.searchQueries.length - 1];

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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        // text-left is explicit because #root in App.css sets text-align:center
        // app-wide (Vite boilerplate leftover), which every message would
        // otherwise inherit. The chat transcript does the same thing.
        "flex flex-col gap-1 pl-3 border-l-2 text-left transition-colors duration-500",
        isUser
          ? "border-TT-purple-accent/50"
          // The in-flight turn's rail warms to the active accent, then settles
          // back when the answer lands. Colour transition only — nothing layout.
          : message.isStreaming
            ? "border-TT-yellow/60"
            : theme === "dark"
              ? "border-white/[0.08]"
              : "border-black/[0.08]"
      )}
    >
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
        {displayText ? (
          isUser ? (
            <p className="whitespace-pre-wrap break-words">{displayText}</p>
          ) : (
            <MarkdownComponent>{displayText}</MarkdownComponent>
          )
        ) : activityLabel ? (
          <ActivityRow label={activityLabel} query={latestQuery} theme={theme} stage={stage} />
        ) : null}
        {message.isStreaming && displayText && (
          <span className="inline-block w-1 h-3.5 bg-TT-yellow ml-0.5 animate-pulse align-text-bottom" />
        )}
      </div>

      {/* Where this answer came from */}
      {!isUser && !message.isStreaming && (
        <SourceChips message={message} theme={theme} />
      )}

      {/* What the turn cost, once it's finished */}
      {!isUser && !message.isStreaming && message.metrics && (
        <TurnMetrics metrics={message.metrics} theme={theme} />
      )}

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
    </motion.div>
  );
});

// Live "what the assistant is doing" row, shown in place of an empty bubble.
function ActivityRow({
  label,
  query,
  theme,
  stage,
}: {
  label: string;
  query?: string;
  theme: string;
  stage: PipelineStage;
}) {
  const Icon = stage === "retrieving" ? Database : stage === "searching" ? Globe : Search;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2 py-0.5"
    >
      <Icon className="w-3.5 h-3.5 text-TT-yellow shrink-0 animate-pulse" />
      <span
        className={cn(
          "text-xs font-mono",
          theme === "dark" ? "text-gray-400" : "text-gray-500"
        )}
      >
        {label}
        {query && (
          <>
            {" — "}
            <span className="italic text-TT-yellow">{query}</span>
          </>
        )}
      </span>
      <span className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-TT-yellow animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    </motion.div>
  );
}

// Per-turn pipeline timings, printed under the answer they belong to. Mirrors
// the chat transcript's inline stats line (chatui/InferenceStats.tsx): mono,
// tabular, dot-separated, and quiet enough to ignore until you look for it.
function TurnMetrics({
  metrics,
  theme,
}: {
  metrics: PipelineMetrics;
  theme: string;
}) {
  const ms = (value: number | undefined) =>
    value === undefined
      ? null
      : value >= 1000
        ? `${(value / 1000).toFixed(1)}s`
        : `${Math.round(value)}ms`;

  const segments = [
    metrics.stt_latency_ms !== undefined ? `STT ${ms(metrics.stt_latency_ms)}` : null,
    metrics.rag_used && metrics.rag_latency_ms !== undefined
      ? `RAG ${ms(metrics.rag_latency_ms)}`
      : null,
    metrics.rag_used && metrics.rag_doc_count !== undefined
      ? `${metrics.rag_doc_count} docs`
      : null,
    metrics.llm_ttfb_ms ? `TTFB ${ms(metrics.llm_ttfb_ms)}` : null,
    metrics.llm_total_ms !== undefined ? `LLM ${ms(metrics.llm_total_ms)}` : null,
    metrics.tts_latency_ms !== undefined ? `TTS ${ms(metrics.tts_latency_ms)}` : null,
    metrics.total_ms !== undefined ? `total ${ms(metrics.total_ms)}` : null,
  ].filter((segment): segment is string => segment !== null);

  if (!segments.length) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums mt-0.5",
        theme === "dark" ? "text-white/30" : "text-gray-400"
      )}
    >
      {segments.map((segment, i) => (
        <span key={segment} className="flex items-center gap-1.5">
          {i > 0 && <span className="opacity-40">·</span>}
          {segment}
        </span>
      ))}
    </div>
  );
}

// After the turn settles: any web sources the answer drew on. The grounding
// collection is deliberately not repeated here — it is the same for every turn, so
// it belongs in the header next to the pipeline status rather than under each reply.
function SourceChips({
  message,
  theme,
}: {
  message: ConversationMessage;
  theme: string;
}) {
  if (!message.sources?.length) return null;

  const chipClass = cn(
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono max-w-[14rem]",
    theme === "dark"
      ? "bg-white/[0.06] text-gray-400"
      : "bg-black/[0.04] text-gray-500"
  );

  // Chips arrive together at the end of a turn, so a short stagger reads as
  // "here's where that came from" rather than a block appearing at once.
  const chipMotion = (index: number) => ({
    initial: { opacity: 0, y: 3 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.18, delay: index * 0.04 },
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1">
      {message.sources?.map((source, i) => (
        <motion.a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          title={source.url}
          className={cn(chipClass, "hover:text-TT-purple-accent transition-colors")}
          {...chipMotion(i)}
        >
          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          <span className="truncate">{source.title || source.url}</span>
        </motion.a>
      ))}
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
