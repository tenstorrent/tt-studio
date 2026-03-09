// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useCallback, useRef } from "react";
import { MainContent } from "@/src/components/speechToText/mainContent";
import { StatusPanel } from "@/src/components/speechToText/StatusPanel";
import { AudioRecorderWithVisualizer } from "@/src/components/speechToText/AudioRecorderWithVisualizer";
import { Mic, MessageSquare, Volume2, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import {
  fetchDeployedModelsInfo,
  runTTSInference,
} from "@/src/api/modelsDeployedApis";
import { runInference } from "@/src/components/chatui/runInference";
import type { ChatMessage } from "@/src/components/chatui/types";
import { v4 as uuidv4 } from "uuid";
import { sendAudioRecording } from "./lib/apiClient";
import type {
  Conversation,
  ConversationMessage,
  PipelineStage,
  DeployedModelState,
  PipelineMetrics,
} from "./types";

export type { Conversation, ConversationMessage };

export default function SpeechToTextApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationCounter, setConversationCounter] = useState(1);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isTTSGenerating, setIsTTSGenerating] = useState(false);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [statusPanelOpen, setStatusPanelOpen] = useState(true);
  const { theme } = useTheme();

  const location = useLocation();
  const [modelID, setModelID] = useState<string | null>(null);
  const [models, setModels] = useState<DeployedModelState>({
    whisper: null,
    llm: null,
    tts: null,
  });

  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const chatHistoryRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  useEffect(() => {
    if (location.state?.containerID) {
      setModelID(location.state.containerID);
    }
  }, [location.state]);

  // Auto-discover deployed models
  useEffect(() => {
    const discoverModels = async () => {
      try {
        const deployed = await fetchDeployedModelsInfo();
        const whisper = deployed.find((m) => m.model_type === "speech_recognition");
        const llm = deployed.find((m) => m.model_type === "chat");
        const tts = deployed.find((m) => m.model_type === "tts");
        setModels({
          whisper: whisper ? { id: whisper.id, modelName: whisper.modelName, model_type: whisper.model_type } : null,
          llm: llm ? { id: llm.id, modelName: llm.modelName, model_type: llm.model_type } : null,
          tts: tts ? { id: tts.id, modelName: tts.modelName, model_type: tts.model_type } : null,
        });
      } catch (err) {
        console.error("Failed to discover deployed models:", err);
      }
    };
    discoverModels();
  }, []);

  const handleNewConversation = useCallback(() => {
    const id = Date.now().toString();
    const newConversation: Conversation = {
      id,
      title: `Conversation ${conversationCounter}`,
      date: new Date(),
      messages: [],
    };
    setConversations((prev) => [newConversation, ...prev]);
    setSelectedConversation(id);
    setConversationCounter((prev) => prev + 1);
    setChatHistory([]);
    return id;
  }, [conversationCounter]);

  const addMessageToConversation = useCallback(
    (conversationId: string, message: ConversationMessage) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, messages: [...c.messages, message] }
            : c
        )
      );
    },
    []
  );

  const updateMessageInConversation = useCallback(
    (conversationId: string, messageId: string, updates: Partial<ConversationMessage>) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, ...updates } : m
                ),
              }
            : c
        )
      );
    },
    []
  );

  const sendToLlm = useCallback(
    async (transcribedText: string, conversationId: string, sttLatencyMs?: number) => {
      if (!models.llm) {
        customToast.error("No deployed LLM found. Deploy a chat model first.");
        return;
      }

      setStage("thinking");
      const assistantMsgId = uuidv4();
      const assistantMessage: ConversationMessage = {
        id: assistantMsgId,
        sender: "assistant",
        text: "",
        date: new Date(),
        isStreaming: true,
      };
      addMessageToConversation(conversationId, assistantMessage);

      const currentConvo = conversations.find((c) => c.id === conversationId);
      const priorMessages: ChatMessage[] = (currentConvo?.messages ?? [])
        .filter((m) => m.text)
        .map((m) => ({ id: m.id, sender: m.sender, text: m.text }));
      priorMessages.push({ id: uuidv4(), sender: "user", text: transcribedText });

      const localChatHistory: ChatMessage[] = [...priorMessages];
      let llmFirstChunk = false;
      const llmStart = performance.now();
      let llmTtfbMs = 0;

      const setLocalChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>> = (updater) => {
        if (typeof updater === "function") {
          const updated = updater(localChatHistory);
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.sender === "assistant") {
            if (!llmFirstChunk && lastMsg.text) {
              llmFirstChunk = true;
              llmTtfbMs = Math.round(performance.now() - llmStart);
            }
            updateMessageInConversation(conversationId, assistantMsgId, {
              text: lastMsg.text,
            });
          }
          localChatHistory.length = 0;
          localChatHistory.push(...updated);
        }
      };

      const pipelineStart = performance.now();

      try {
        await runInference(
          {
            deploy_id: models.llm.id,
            text: transcribedText,
            max_tokens: 512,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
          },
          undefined,
          localChatHistory,
          setLocalChatHistory,
          setIsStreaming,
          false,
          0,
          undefined,
          "Role: You are a concise, witty AI assistant for a live demo. \
          Constraint 1: Keep responses extremely short. Aim for 1-2 sentences maximum (under 30 words). \
          Constraint 2: Use natural, conversational language. Avoid bullet points, bolding, or markdown. \
          Constraint 3: Do not repeat the user's question. Get straight to the answer or a clever quip. \
          Goal: Minimize text output to ensure the Text-to-Speech (TTS) engine can process and play audio instantly."
        );

        const llmTotalMs = Math.round(performance.now() - llmStart);
      const lastAssistant = localChatHistory.findLast(
        (m) => m.sender === "assistant" && m.text
      );
        const llmResponseText = lastAssistant?.text || "";
        const llmTokenEstimate = llmResponseText.split(/\s+/).length;

        let ttsLatencyMs: number | undefined;

        if (llmResponseText && models.tts) {
          setStage("speaking");
          setIsTTSGenerating(true);
          const ttsStart = performance.now();
          try {
            if (ttsAudioRef.current) {
              ttsAudioRef.current.pause();
              ttsAudioRef.current.currentTime = 0;
            }
            if (ttsAudioUrlRef.current) {
              URL.revokeObjectURL(ttsAudioUrlRef.current);
              ttsAudioUrlRef.current = null;
            }

            const audioBlob = await runTTSInference(models.tts.id, llmResponseText);
            ttsLatencyMs = Math.round(performance.now() - ttsStart);
            const audioUrl = URL.createObjectURL(audioBlob);
            ttsAudioUrlRef.current = audioUrl;

            updateMessageInConversation(conversationId, assistantMsgId, {
              audioBlob,
              isStreaming: false,
            });

            if (!ttsAudioRef.current) ttsAudioRef.current = new Audio();
            ttsAudioRef.current.src = audioUrl;
            ttsAudioRef.current.load();
            ttsAudioRef.current.play().catch((e) => console.warn("TTS autoplay blocked:", e));
          } catch (ttsErr) {
            console.error("TTS error:", ttsErr);
          } finally {
            setIsTTSGenerating(false);
          }
        }

        const totalMs = Math.round(performance.now() - pipelineStart);
        setMetrics({
          stt_latency_ms: sttLatencyMs,
          llm_ttfb_ms: llmTtfbMs,
          llm_total_ms: llmTotalMs,
          llm_tokens: llmTokenEstimate,
          tts_latency_ms: ttsLatencyMs,
          total_ms: totalMs,
        });
      } catch (err) {
        console.error("LLM inference error:", err);
        updateMessageInConversation(conversationId, assistantMsgId, {
          text: "Error: Failed to get LLM response.",
          isStreaming: false,
        });
      } finally {
        updateMessageInConversation(conversationId, assistantMsgId, { isStreaming: false });
        setStage("done");
      }
    },
    [models, conversations, addMessageToConversation, updateMessageInConversation]
  );

  const handleRecordingComplete = async (audioBlob: Blob) => {
    setStage("transcribing");

    let targetConversationId = selectedConversation;
    if (!targetConversationId) {
      targetConversationId = handleNewConversation();
    }

    try {
      const sttStart = performance.now();
      const data = await sendAudioRecording(audioBlob, { modelID: modelID || "" });
      const sttLatencyMs = Math.round(performance.now() - sttStart);
      const text = data.text;

      const userMsgId = uuidv4();
      const userMessage: ConversationMessage = {
        id: userMsgId,
        sender: "user",
        text,
        date: new Date(),
        audioBlob,
      };
      addMessageToConversation(targetConversationId, userMessage);

      await sendToLlm(text, targetConversationId, sttLatencyMs);
    } catch (error) {
      console.error("Error processing audio:", error);
      customToast.error(
        `Transcription Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      setStage("idle");
    }
  };

  const selectedConversationData = selectedConversation
    ? conversations.find((c) => c.id === selectedConversation)
    : null;

  useEffect(() => {
    const saved = localStorage.getItem("conversationCounter");
    if (saved) setConversationCounter(Number.parseInt(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("conversationCounter", conversationCounter.toString());
  }, [conversationCounter]);

  const isProcessing = stage === "transcribing" || stage === "thinking" || stage === "speaking";

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <header
        className={cn(
          "h-10 flex items-center justify-between px-3 border-b shrink-0",
          theme === "dark"
            ? "bg-[#0A0A0A] border-[#1A1A1A]"
            : "bg-white border-gray-200"
        )}
      >
        <div className="flex items-center gap-3">
          <h1
            className={cn(
              "text-sm font-semibold",
              theme === "dark" ? "text-white" : "text-gray-900"
            )}
          >
            Voice Pipeline
          </h1>
          <span
            className={cn(
              "text-[10px] px-2 py-0.5 rounded-full font-medium",
              stage === "idle" || stage === "done"
                ? theme === "dark"
                  ? "bg-green-500/10 text-green-400"
                  : "bg-green-50 text-green-600"
                : theme === "dark"
                  ? "bg-amber-500/10 text-amber-400"
                  : "bg-amber-50 text-amber-600"
            )}
          >
            {stage === "idle" || stage === "done" ? "Ready" : stage}
          </span>
        </div>

        {/* Model status pills */}
        <div className="flex items-center gap-2">
          <ModelPill
            icon={<Mic className="w-3 h-3" />}
            label="Whisper"
            connected={!!models.whisper}
            theme={theme}
          />
          <ModelPill
            icon={<MessageSquare className="w-3 h-3" />}
            label="LLM"
            connected={!!models.llm}
            theme={theme}
          />
          <ModelPill
            icon={<Volume2 className="w-3 h-3" />}
            label="TTS"
            connected={!!models.tts}
            theme={theme}
          />
          <button
            onClick={() => setStatusPanelOpen(!statusPanelOpen)}
            className={cn(
              "ml-2 w-7 h-7 flex items-center justify-center rounded-md transition-colors",
              theme === "dark"
                ? "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            )}
          >
            {statusPanelOpen ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {/* 3-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Audio */}
        <div
          className={cn(
            "w-36 lg:w-44 shrink-0 flex flex-col items-center justify-center border-r",
            theme === "dark"
              ? "bg-[#0A0A0A] border-[#1A1A1A]"
              : "bg-white border-gray-200"
          )}
        >
          <div className="flex flex-col items-center gap-3 py-3">
            <p
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wider",
                theme === "dark" ? "text-gray-600" : "text-gray-400"
              )}
            >
              Microphone
            </p>
            <AudioRecorderWithVisualizer
              onRecordingComplete={handleRecordingComplete}
              onRecordingStart={() => setStage("recording")}
              disabled={isProcessing}
            />
          </div>

          {/* Bot audio section */}
          {isTTSGenerating && (
            <div
              className={cn(
                "w-full border-t px-3 py-3 flex flex-col items-center gap-2",
                theme === "dark" ? "border-[#1A1A1A]" : "border-gray-200"
              )}
            >
              <p
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider",
                  theme === "dark" ? "text-gray-600" : "text-gray-400"
                )}
              >
                Bot Audio
              </p>
              <div className="flex items-center gap-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-TT-purple-accent rounded-sm animate-pulse"
                    style={{ animationDelay: `${i * 100}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center Panel - Conversation / Metrics */}
        <div className="flex-1 flex flex-col min-w-0">
          <MainContent
            conversations={conversations}
            selectedConversation={selectedConversation}
            isStreaming={isStreaming}
            isTTSGenerating={isTTSGenerating}
            metrics={metrics}
          />
        </div>

        {/* Right Panel - Status */}
        {statusPanelOpen && (
          <div
            className={cn(
              "w-44 lg:w-52 shrink-0 border-l overflow-hidden",
              theme === "dark"
                ? "bg-[#0A0A0A] border-[#1A1A1A]"
                : "bg-white border-gray-200"
            )}
          >
            <StatusPanel
              stage={stage}
              models={models}
              conversationId={selectedConversation}
              messageCount={selectedConversationData?.messages.length ?? 0}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ModelPill({
  icon,
  label,
  connected,
  theme,
}: {
  icon: React.ReactNode;
  label: string;
  connected: boolean;
  theme: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs",
        connected
          ? theme === "dark"
            ? "bg-green-500/10 text-green-400"
            : "bg-green-50 text-green-700"
          : theme === "dark"
            ? "bg-[#151515] text-gray-500"
            : "bg-gray-50 text-gray-400"
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          connected ? "bg-green-500" : "bg-gray-400"
        )}
      />
    </div>
  );
}
