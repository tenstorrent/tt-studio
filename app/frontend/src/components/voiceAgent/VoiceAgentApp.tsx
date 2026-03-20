// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useCallback, useRef } from "react";
import { MainContent } from "@/src/components/voiceAgent/mainContent";
import { StatusPanel } from "@/src/components/voiceAgent/StatusPanel";
import { MetricsPanel } from "@/src/components/voiceAgent/MetricsPanel";
import { AudioRecorderWithVisualizer } from "@/src/components/voiceAgent/AudioRecorderWithVisualizer";
import { Activity, BarChart3 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import { motion } from "framer-motion";
import {
  fetchDeployedModelsInfo,
  runTTSInference,
} from "@/src/api/modelsDeployedApis";
import { runInference } from "@/src/components/chatui/runInference";
import type { ChatMessage } from "@/src/components/chatui/types";
import { v4 as uuidv4 } from "uuid";
import { sendAudioRecording } from "./lib/apiClient";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/src/components/ui/popover";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import type {
  Conversation,
  ConversationMessage,
  PipelineStage,
  DeployedModelState,
  PipelineMetrics,
} from "./types";

export type { Conversation, ConversationMessage };

const STAGE_CONFIG: Record<PipelineStage, { label: string; color: string; dotColor: string }> = {
  idle: { label: "Ready", color: "text-TT-purple-accent", dotColor: "bg-TT-purple-accent" },
  recording: { label: "Listening", color: "text-TT-red-accent", dotColor: "bg-TT-red-accent" },
  transcribing: { label: "Transcribing", color: "text-TT-yellow", dotColor: "bg-TT-yellow" },
  thinking: { label: "Thinking", color: "text-TT-yellow", dotColor: "bg-TT-yellow" },
  speaking: { label: "Speaking", color: "text-TT-green", dotColor: "bg-TT-green" },
  done: { label: "Ready", color: "text-TT-purple-accent", dotColor: "bg-TT-purple-accent" },
};

export default function VoiceAgentApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationCounter, setConversationCounter] = useState(1);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isTTSGenerating, setIsTTSGenerating] = useState(false);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
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
      const data = await sendAudioRecording(audioBlob, { modelID: models.whisper?.id || modelID || "" });
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
  const stageConfig = STAGE_CONFIG[stage];
  const allModelsConnected = !!models.whisper && !!models.llm && !!models.tts;
  const someModelsConnected = !!models.whisper || !!models.llm || !!models.tts;

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, rotateX: 8 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ type: "spring", stiffness: 180, damping: 24 }}
      style={{ perspective: "1200px", transformStyle: "preserve-3d" }}
      className={cn(
        "max-w-2xl w-full flex flex-col rounded-2xl overflow-hidden",
        "h-full",
        theme === "dark"
          ? "voice-glass voice-tile-3d"
          : "voice-glass-light voice-tile-3d-light"
      )}
    >
        {/* Header */}
        <motion.header
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className={cn(
            "flex items-center justify-between px-5 py-3 shrink-0 border-b",
            theme === "dark" ? "border-white/[0.06]" : "border-black/[0.06]"
          )}
        >
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold font-['Bricolage_Grotesque'] tracking-tight"
              style={{ color: theme === "dark" ? "#e4e4e7" : "#18181b" }}
            >
              Voice Pipeline
            </h1>
            <motion.div
              key={stage}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-1.5"
            >
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  stageConfig.dotColor,
                  (stage !== "idle" && stage !== "done") && "animate-pulse"
                )}
              />
              <span className={cn("text-xs font-mono font-medium tracking-wide", stageConfig.color)}>
                {stageConfig.label}
              </span>
            </motion.div>
          </div>

          <div className="flex items-center gap-1">
            {/* Model connection dots */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 mr-2 cursor-default">
                    <span className={cn("w-1.5 h-1.5 rounded-full", models.whisper ? "bg-TT-purple-accent" : "bg-gray-500")} />
                    <span className={cn("w-1.5 h-1.5 rounded-full", models.llm ? "bg-TT-purple-accent" : "bg-gray-500")} />
                    <span className={cn("w-1.5 h-1.5 rounded-full", models.tts ? "bg-TT-purple-accent" : "bg-gray-500")} />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div className="flex flex-col gap-1">
                    <span>Whisper: {models.whisper?.modelName || "not deployed"}</span>
                    <span>LLM: {models.llm?.modelName || "not deployed"}</span>
                    <span>TTS: {models.tts?.modelName || "not deployed"}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Status popover */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "w-8 h-8 flex items-center justify-center rounded-lg transition-colors",
                    theme === "dark"
                      ? "text-gray-500 hover:text-TT-purple-accent hover:bg-white/[0.05]"
                      : "text-gray-400 hover:text-TT-purple-accent hover:bg-black/[0.04]"
                  )}
                >
                  <Activity className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-0">
                <StatusPanel
                  stage={stage}
                  models={models}
                  conversationId={selectedConversation}
                  messageCount={selectedConversationData?.messages.length ?? 0}
                />
              </PopoverContent>
            </Popover>

            {/* Metrics sheet */}
            <Sheet>
              <SheetTrigger asChild>
                <button
                  className={cn(
                    "w-8 h-8 flex items-center justify-center rounded-lg transition-colors",
                    theme === "dark"
                      ? "text-gray-500 hover:text-TT-purple-accent hover:bg-white/[0.05]"
                      : "text-gray-400 hover:text-TT-purple-accent hover:bg-black/[0.04]"
                  )}
                >
                  <BarChart3 className="w-4 h-4" />
                </button>
              </SheetTrigger>
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle className="font-['Bricolage_Grotesque']">Pipeline Metrics</SheetTitle>
                </SheetHeader>
                <MetricsPanel metrics={metrics} />
              </SheetContent>
            </Sheet>
          </div>
        </motion.header>

        {/* Transcript area */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="flex-1 min-h-0 overflow-hidden"
        >
          <MainContent
            conversations={conversations}
            selectedConversation={selectedConversation}
            isStreaming={isStreaming}
            isTTSGenerating={isTTSGenerating}
          />
        </motion.div>

        {/* Controls footer */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className={cn(
            "shrink-0 border-t px-5 py-3",
            theme === "dark" ? "border-white/[0.06]" : "border-black/[0.06]"
          )}
        >
          <AudioRecorderWithVisualizer
            onRecordingComplete={handleRecordingComplete}
            onRecordingStart={() => setStage("recording")}
            disabled={isProcessing}
            stage={stage}
            isTTSGenerating={isTTSGenerating}
          />
        </motion.div>
    </motion.div>
  );
}
