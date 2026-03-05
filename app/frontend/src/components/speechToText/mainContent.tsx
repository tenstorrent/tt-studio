// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Loader2,
  Copy,
  Mic,
  Play,
  Bot,
  User,
  Volume2,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { AudioRecorderWithVisualizer } from "@/src/components/speechToText/AudioRecorderWithVisualizer";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { sendAudioRecording } from "./lib/apiClient";
import { useTheme } from "../../hooks/useTheme";
import type { Conversation, ConversationMessage } from "./speechToTextApp";

interface MainContentProps {
  conversations: Conversation[];
  selectedConversation: string | null;
  onNewTranscription: (text: string, audioBlob: Blob) => string;
  isRecording: boolean;
  setIsRecording: (isRecording: boolean) => void;
  showRecordingInterface: boolean;
  setShowRecordingInterface: (show: boolean) => void;
  modelID: string;
  isStreaming?: boolean;
  isTTSGenerating?: boolean;
}

type ScrollBehavior = "auto" | "instant" | "smooth";

export function MainContent({
  conversations,
  selectedConversation,
  onNewTranscription,
  isRecording,
  setIsRecording,
  showRecordingInterface,
  setShowRecordingInterface,
  modelID,
  isStreaming = false,
  isTTSGenerating = false,
}: MainContentProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [_audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [justSentRecording, setJustSentRecording] = useState(false);
  const [hasRecordedBefore, setHasRecordedBefore] = useState(false);
  const [forceShowTranscription, setForceShowTranscription] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const { theme } = useTheme();

  const contentContainerRef = useRef<HTMLDivElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);

  const selectedConversationData = selectedConversation
    ? conversations.find((c) => c.id === selectedConversation)
    : null;

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (contentContainerRef.current) {
      void contentContainerRef.current.offsetHeight;
      setTimeout(() => {
        if (contentContainerRef.current) {
          const containerHeight = contentContainerRef.current.clientHeight;
          const contentHeight = contentContainerRef.current.scrollHeight;
          contentContainerRef.current.scrollTo({
            top: contentHeight - containerHeight + 200,
            behavior: behavior,
          });
        }
      }, 100);
    }
  };

  const handleRecordingComplete = async (recordedBlob: Blob) => {
    console.log(
      "Recording completed, blob type:",
      recordedBlob.type,
      "size:",
      recordedBlob.size
    );
    setAudioBlob(recordedBlob);
    setHasRecordedBefore(true);
    await processAudioWithAPI(recordedBlob);
    setForceShowTranscription(true);
  };

  const processAudioWithAPI = async (audioBlob: Blob) => {
    setIsProcessing(true);

    try {
      console.log("Processing audio with API, type:", audioBlob.type);
      const data = await sendAudioRecording(audioBlob, { modelID });
      const transcriptionText = data.text;
      onNewTranscription(transcriptionText, audioBlob);
      setJustSentRecording(true);
      setShowRecordingInterface(false);

      setTimeout(() => {
        if (autoScrollEnabled) {
          scrollToBottom();
        }
      }, 500);

      console.log("Transcription successful:", transcriptionText);
    } catch (error) {
      console.error("Error processing audio:", error);
      alert(
        `Transcription Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const startNewRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    setIsRecording(true);
    setShowRecordingInterface(true);
    setJustSentRecording(false);
    setHasRecordedBefore(true);
    setForceShowTranscription(false);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Scroll to bottom when conversation loads
  useEffect(() => {
    if (selectedConversationData) {
      setTimeout(() => {
        if (selectedConversationData.messages.length > 0) {
          scrollToBottom("auto");
        }
      }, 200);
    }
  }, [selectedConversation]);

  // Scroll when new messages arrive or streaming updates
  useEffect(() => {
    if (autoScrollEnabled && selectedConversationData?.messages.length) {
      scrollToBottom();
    }
  }, [selectedConversationData?.messages.length, autoScrollEnabled]);

  // Scroll during streaming as text accumulates
  useEffect(() => {
    if (isStreaming && autoScrollEnabled) {
      const interval = setInterval(() => scrollToBottom(), 300);
      return () => clearInterval(interval);
    }
  }, [isStreaming, autoScrollEnabled]);

  // Switch to conversation view when recording completes
  useEffect(() => {
    if (justSentRecording && selectedConversationData) {
      setShowRecordingInterface(false);
      setTimeout(() => {
        if (autoScrollEnabled) scrollToBottom();
      }, 500);
    }
  }, [justSentRecording, selectedConversationData, autoScrollEnabled]);

  useEffect(() => {
    if (selectedConversation && !isRecording) {
      setShowRecordingInterface(false);
    }
  }, [selectedConversation, isRecording]);

  useEffect(() => {
    if (isRecording) {
      setShowRecordingInterface(true);
    }
  }, [isRecording]);

  useEffect(() => {
    if (forceShowTranscription && selectedConversationData) {
      setShowRecordingInterface(false);
      setForceShowTranscription(false);
      setTimeout(() => {
        if (autoScrollEnabled) scrollToBottom();
      }, 500);
    }
  }, [forceShowTranscription, selectedConversationData, autoScrollEnabled]);

  // Scroll listener for auto-scroll toggle
  useEffect(() => {
    const container = contentContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!container) return;
      const isAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 200;
      if (isAtBottom !== autoScrollEnabled) {
        setAutoScrollEnabled(isAtBottom);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div
        ref={contentContainerRef}
        className={cn(
          "flex-1 overflow-y-auto",
          theme === "dark"
            ? "bg-gradient-to-b from-[#1A1A1A] to-[#222222]"
            : "bg-gradient-to-b from-gray-50 to-white"
        )}
      >
        <div className="p-2 sm:p-4 md:p-6">
          <div className="max-w-4xl mx-auto w-full">
            {!selectedConversation || showRecordingInterface ? (
              <>
                <div className="mb-4 sm:mb-8">
                  <h1 className="text-xl sm:text-3xl font-bold mb-2 sm:mb-4 text-TT-purple">
                    ML-Powered Speech Recognition
                  </h1>
                  <p
                    className={cn(
                      "text-sm sm:text-base",
                      theme === "dark"
                        ? "text-TT-purple-tint1"
                        : "text-TT-purple-shade"
                    )}
                  >
                    Record your voice to chat with the AI. Your speech will be
                    transcribed and sent to the LLM for a response.
                  </p>
                </div>

                <div
                  className={cn(
                    "mb-4 sm:mb-8 p-4 sm:p-8 backdrop-blur-sm shadow-lg shadow-TT-purple/5 rounded-xl border",
                    "transition-all duration-300 ease-in-out transform",
                    "hover:scale-[1.02] hover:shadow-xl hover:shadow-TT-purple/10",
                    "hover:-translate-y-1 hover:backdrop-blur-md",
                    theme === "dark"
                      ? "bg-[#222222]/80 border-TT-purple/30 hover:bg-[#222222]/90 hover:border-TT-purple/50"
                      : "bg-white/80 border-TT-purple-shade/30 hover:bg-white/90 hover:border-TT-purple-shade/50"
                  )}
                >
                  <h2 className="text-lg sm:text-xl font-semibold mb-4 sm:mb-6 text-TT-purple">
                    {isProcessing ? "Processing..." : ""}
                  </h2>

                  <div className="mb-4">
                    <AudioRecorderWithVisualizer
                      className="mb-4"
                      onRecordingComplete={handleRecordingComplete}
                    />
                  </div>

                  {isProcessing && (
                    <div
                      className={cn(
                        "mt-4 sm:mt-6 p-3 sm:p-4 rounded-md",
                        theme === "dark"
                          ? "border-TT-purple-shade/50 bg-TT-purple-shade/20"
                          : "border-TT-purple-shade/30 bg-TT-purple-shade/10"
                      )}
                    >
                      <div className="flex items-center">
                        <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 mr-2 sm:mr-3 animate-spin text-TT-purple" />
                        <p className="text-sm sm:text-base font-medium text-TT-purple">
                          Transcribing your audio...
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : selectedConversation && selectedConversationData ? (
              <div className="flex flex-col gap-4 pb-8">
                {/* Chat messages */}
                {selectedConversationData.messages.map((message) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    theme={theme}
                    onCopy={copyToClipboard}
                  />
                ))}

                {/* Streaming indicator */}
                {isStreaming && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 px-4 py-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-TT-purple rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-TT-purple rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-TT-purple rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* TTS Generating indicator */}
                {isTTSGenerating && (
                  <div className="flex justify-start">
                    <div className={cn(
                      "flex items-center gap-2 px-4 py-2 text-sm",
                      theme === "dark" ? "text-gray-400" : "text-gray-500"
                    )}>
                      <Volume2 className="h-4 w-4 animate-pulse" />
                      <span>Generating audio...</span>
                    </div>
                  </div>
                )}

                {/* Record another message area */}
                <div
                  className={cn(
                    "py-6 sm:py-10 border-2 border-dashed rounded-lg transition-colors flex justify-center mt-4 sm:mt-8 relative",
                    theme === "dark"
                      ? "border-TT-purple/40 bg-gradient-to-r from-[#1A1A1A] to-[#222222] hover:from-[#222222] hover:to-[#1A1A1A]"
                      : "border-TT-purple-shade/40 bg-gradient-to-r from-gray-50 to-white hover:from-white hover:to-gray-50"
                  )}
                  ref={conversationEndRef}
                >
                  <Button
                    onClick={startNewRecording}
                    variant="default"
                    size="lg"
                    disabled={isStreaming || isTTSGenerating}
                    className="flex items-center gap-2 sm:gap-3 px-4 sm:px-8 py-2 sm:py-7 bg-gradient-to-r from-TT-purple-accent to-TT-purple-accent hover:from-TT-purple hover:to-TT-purple-accent text-white transition-all duration-300 font-medium shadow-md shadow-TT-purple/20 hover:shadow-lg hover:shadow-TT-purple/30"
                  >
                    <Mic className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                    <span className="text-sm sm:text-base text-white">
                      {hasRecordedBefore
                        ? "Record Another Message"
                        : "Record New Message"}
                    </span>
                  </Button>
                </div>

                <div className="h-16 sm:h-32"></div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// Chat bubble component for user and assistant messages
function ChatBubble({
  message,
  theme,
  onCopy,
}: {
  message: ConversationMessage;
  theme: string;
  onCopy: (text: string) => void;
}) {
  const isUser = message.sender === "user";

  // Memoize the audio URL to avoid recreating it on every render
  const audioSrc = useMemo(() => {
    if (message.audioBlob) {
      return URL.createObjectURL(message.audioBlob);
    }
    return undefined;
  }, [message.audioBlob]);

  // Clean up the object URL when the component unmounts or audioBlob changes
  useEffect(() => {
    return () => {
      if (audioSrc) {
        URL.revokeObjectURL(audioSrc);
      }
    };
  }, [audioSrc]);

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "flex gap-3 max-w-[85%] sm:max-w-[75%]",
          isUser ? "flex-row-reverse" : "flex-row"
        )}
      >
        {/* Avatar */}
        <div
          className={cn(
            "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1",
            isUser
              ? "bg-TT-purple text-white"
              : theme === "dark"
                ? "bg-TT-blue/20 text-TT-blue"
                : "bg-TT-blue/10 text-TT-blue"
          )}
        >
          {isUser ? (
            <User className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
        </div>

        {/* Message content */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-xs font-medium",
                theme === "dark" ? "text-gray-400" : "text-gray-500"
              )}
            >
              {isUser ? "You" : "Assistant"}
            </span>
            <span
              className={cn(
                "text-xs",
                theme === "dark" ? "text-gray-500" : "text-gray-400"
              )}
            >
              {message.date.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>

          <div
            className={cn(
              "px-4 py-3 rounded-2xl text-sm sm:text-base leading-relaxed",
              isUser
                ? "bg-TT-purple text-white rounded-tr-sm"
                : theme === "dark"
                  ? "bg-[#2A2A2A] text-gray-100 border border-[#333] rounded-tl-sm"
                  : "bg-white text-gray-800 border border-gray-200 rounded-tl-sm shadow-sm"
            )}
          >
            {/* Audio playback (user = recorded audio, assistant = TTS audio) */}
            {message.audioBlob && (
              <div
                className={cn(
                  "mb-2 rounded-md overflow-hidden",
                  isUser
                    ? "bg-white/10"
                    : theme === "dark"
                      ? "bg-[#222]/60 border border-[#333]"
                      : "bg-gray-50 border border-gray-200"
                )}
              >
                <div className="flex items-center gap-1 sm:gap-2 p-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const audio = document.getElementById(
                        `audio-${message.id}`
                      ) as HTMLAudioElement;
                      if (audio?.paused) {
                        audio.play();
                      } else {
                        audio?.pause();
                      }
                    }}
                    className={cn(
                      "h-6 w-6 p-0 flex items-center justify-center",
                      isUser
                        ? "text-white/80 hover:text-white hover:bg-white/10"
                        : theme === "dark"
                          ? "text-TT-blue hover:text-TT-blue hover:bg-white/5"
                          : "text-TT-blue hover:text-TT-blue hover:bg-gray-100"
                    )}
                  >
                    <Play className="h-3 w-3" />
                  </Button>
                  <audio
                    id={`audio-${message.id}`}
                    className="w-full h-6 opacity-80"
                    src={audioSrc}
                    controls
                    style={{ height: "28px" }}
                  />
                </div>
              </div>
            )}

            {message.text || (
              <span className="opacity-50 italic">
                {message.isStreaming ? "Thinking..." : ""}
              </span>
            )}

            {/* Blinking cursor for streaming */}
            {message.isStreaming && message.text && (
              <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse align-text-bottom" />
            )}
          </div>

          {/* Actions */}
          {message.text && !message.isStreaming && (
            <div className={cn("flex gap-1", isUser ? "justify-end" : "justify-start")}>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onCopy(message.text)}
                      className={cn(
                        "h-6 w-6",
                        theme === "dark"
                          ? "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                          : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy to clipboard</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
