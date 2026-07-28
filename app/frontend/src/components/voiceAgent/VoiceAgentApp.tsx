// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MainContent } from "@/src/components/voiceAgent/mainContent";
import { StatusPanel } from "@/src/components/voiceAgent/StatusPanel";
import { MetricsPanel } from "@/src/components/voiceAgent/MetricsPanel";
import { AudioRecorderWithVisualizer, type AudioRecorderHandle } from "@/src/components/voiceAgent/AudioRecorderWithVisualizer";
import { useWakeWord } from "@/src/components/voiceAgent/hooks/useWakeWord";
import {
  Activity,
  BarChart3,
  Check,
  Database,
  Globe,
  Settings2,
  UserCheck,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  fetchDeployedModelsInfo,
  runTTSInference,
} from "@/src/api/modelsDeployedApis";
import { runInference } from "@/src/components/chatui/runInference";
import { fetchCollections, isSystemKnowledgeCollection } from "@/src/components/rag";
import { usePersistentState } from "@/src/components/chatui/usePersistentState";
import { useAgentAvailability } from "../../hooks/useAgentAvailability";
import type { ChatMessage, RagDataSource } from "@/src/components/chatui/types";
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
import { VoiceAgentSettings } from "./VoiceAgentSettings";
import {
  loadVoiceSystemPrompt,
  saveVoiceSystemPrompt,
  renderVoiceSystemPrompt,
  VOICE_PROMPT_GROUNDING_CLAUSE,
  VOICE_PROMPT_SAFETY_SUFFIX,
} from "./lib/prompts";
import {
  cleanSpeechText,
  hasAnswerContent,
  parseSearchProgress,
} from "./lib/cleanSpeech";

export type { Conversation, ConversationMessage };

const STAGE_CONFIG: Record<PipelineStage, { label: string; color: string; dotColor: string }> = {
  idle: { label: "Ready", color: "text-TT-purple-accent", dotColor: "bg-TT-purple-accent" },
  recording: { label: "Listening", color: "text-TT-red-accent", dotColor: "bg-TT-red-accent" },
  transcribing: { label: "Transcribing", color: "text-TT-yellow", dotColor: "bg-TT-yellow" },
  retrieving: { label: "Searching your documents", color: "text-TT-yellow", dotColor: "bg-TT-yellow" },
  searching: { label: "Searching the web", color: "text-TT-yellow", dotColor: "bg-TT-yellow" },
  thinking: { label: "Thinking", color: "text-TT-yellow", dotColor: "bg-TT-yellow" },
  speaking: { label: "Speaking", color: "text-TT-green", dotColor: "bg-TT-green" },
  done: { label: "Ready", color: "text-TT-purple-accent", dotColor: "bg-TT-purple-accent" },
};

const ALL_COLLECTIONS_ID = "special-all";

function collectionLabel(source: RagDataSource | undefined): string {
  if (!source) return "Knowledge";
  if (source.id === ALL_COLLECTIONS_ID) return "All collections";
  return source.name;
}

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

  // Knowledge (RAG) and Web search (Search Agent) reuse the chat plumbing; the
  // voice UI only has to pick a datasource and flip the agent flag.
  const { data: ragDataSources } = useQuery<RagDataSource[]>({
    queryKey: ["collectionsList"],
    queryFn: fetchCollections,
    initialData: [],
  });
  const [ragCollectionId, setRagCollectionId] = usePersistentState<string | null>(
    "voice_ragDatasource",
    null
  );
  const [isAgentSelected, setIsAgentSelected] = usePersistentState<boolean>(
    "voice_isAgentSelected",
    false
  );
  const [showMetrics, setShowMetrics] = usePersistentState<boolean>(
    "voice_showMetrics",
    false
  );

  const { isAgentAvailable, hasChecked: agentCheckDone } = useAgentAvailability(
    models.llm?.id
  );

  // "All collections" first, then the user's own. The backend's seeded docs
  // collection isn't listed individually — "All collections" spans it, and it's
  // merged into every single-collection query server-side regardless. It still
  // counts toward whether there's anything to search at all.
  const knowledgeOptions = useMemo<RagDataSource[]>(() => {
    const collections = Array.isArray(ragDataSources) ? ragDataSources : [];
    const own = collections.filter((c) => !isSystemKnowledgeCollection(c));
    const all: RagDataSource[] = collections.length
      ? [{ id: ALL_COLLECTIONS_ID, name: "All collections" } as RagDataSource]
      : [];
    return [...all, ...own];
  }, [ragDataSources]);

  const ragDatasource = useMemo(
    () => knowledgeOptions.find((c) => c.id === ragCollectionId),
    [knowledgeOptions, ragCollectionId]
  );

  // A collection can disappear (deleted elsewhere); don't keep pointing at it.
  useEffect(() => {
    if (ragCollectionId && knowledgeOptions.length && !ragDatasource) {
      setRagCollectionId(null);
    }
  }, [ragCollectionId, ragDatasource, knowledgeOptions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Web search follows availability — no tool-calling model or no Tavily key
  // means the agent path would just fail, so clear the selection. Only once the
  // first probe has answered, or a persisted "on" would be wiped on every load.
  useEffect(() => {
    if (agentCheckDone && !isAgentAvailable) setIsAgentSelected(false);
  }, [agentCheckDone, isAgentAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  const [recognizedUser, setRecognizedUser] = useState<string | null>(null);
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);
  const recognizedUserRef = useRef<string | null>(null);
  const autoGreetedRef = useRef(false);

  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<AudioRecorderHandle>(null);

  useWakeWord({
    enabled: stage === "idle" || stage === "done",
    onWake: () => recorderRef.current?.startRecording(),
  });
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const chatHistoryRef = useRef<ChatMessage[]>([]);

  // Light persistent memory: short notes about the user that survive across
  // conversations and page reloads. Kept tiny on purpose so it's cheap to inject
  // into every system prompt.
  const VOICE_AGENT_MEMORY_KEY = "voiceAgentMemory.v1";
  const MEMORY_MAX_NOTES = 8;
  const memoryRef = useRef<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VOICE_AGENT_MEMORY_KEY);
      if (raw) memoryRef.current = JSON.parse(raw);
    } catch {
      memoryRef.current = [];
    }
  }, []);
  const addMemoryNote = useCallback((note: string) => {
    const cleaned = note.trim().replace(/\s+/g, " ");
    if (!cleaned) return;
    const existing = memoryRef.current;
    if (existing.some((n) => n.toLowerCase() === cleaned.toLowerCase())) return;
    const updated = [...existing, cleaned].slice(-MEMORY_MAX_NOTES);
    memoryRef.current = updated;
    try {
      localStorage.setItem(VOICE_AGENT_MEMORY_KEY, JSON.stringify(updated));
    } catch {
      /* storage full / disabled — fine, memory just won't persist */
    }
  }, []);
  const extractMemoryFromUserTurn = useCallback(
    (text: string) => {
      const patterns: RegExp[] = [
        /\bmy name is ([A-Za-z][\w'’\- ]{1,40})/i,
        /\b(?:i am|i'm) (?:called |known as )?([A-Z][\w'’-]{1,30})\b/,
        /\bcall me ([A-Za-z][\w'’\- ]{1,30})/i,
        /\bi(?:'m| am) a ([\w'’\- ]{2,40}?)(?:\.|,|$)/i,
        /\bi work (?:as|at|in|on) ([\w'’\- ]{2,40}?)(?:\.|,|$)/i,
        /\bi (?:like|love|enjoy|prefer) ([\w'’\- ]{2,40}?)(?:\.|,|$)/i,
        /\b(?:please |)(?:keep it|answer|reply|respond) (?:in )?([\w'’\- ]{2,30}?)(?:\.|,|$)/i,
      ];
      const labels = ["name", "name", "preferred name", "role", "work", "likes", "style preference"];
      patterns.forEach((re, i) => {
        const m = text.match(re);
        if (m && m[1]) addMemoryNote(`${labels[i]}: ${m[1].trim()}`);
      });
    },
    [addMemoryNote]
  );

  // Editable LLM system prompt, persisted per-browser. A ref mirrors it so the
  // inference callback reads the latest value without re-subscribing.
  const [systemPrompt, setSystemPrompt] = useState<string>(() => loadVoiceSystemPrompt());
  const systemPromptRef = useRef<string>(systemPrompt);
  useEffect(() => {
    systemPromptRef.current = systemPrompt;
  }, [systemPrompt]);
  const handleSaveSystemPrompt = useCallback((prompt: string) => {
    setSystemPrompt(prompt);
    saveVoiceSystemPrompt(prompt);
  }, []);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  useEffect(() => {
    if (location.state?.containerID) {
      setModelID(location.state.containerID);
    }
    if (location.state?.recognizedUser) {
      const name = location.state.recognizedUser as string;
      recognizedUserRef.current = name;
      setRecognizedUser(name);
      setShowWelcomeBanner(true);
    }
  }, [location.state]);

  // Auto-dismiss the welcome banner after 45 seconds
  useEffect(() => {
    if (!showWelcomeBanner) return;
    const timer = setTimeout(() => setShowWelcomeBanner(false), 15000);
    return () => clearTimeout(timer);
  }, [showWelcomeBanner]);

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

  // Auto-greet the recognized user via TTS once models are ready
  useEffect(() => {
    if (!recognizedUser || !models.tts || autoGreetedRef.current) return;
    autoGreetedRef.current = true;
    const greetText = `Welcome, ${recognizedUser}! How can I help you today?`;
    setStage("speaking");
    setIsTTSGenerating(true);
    let playing = false;
    runTTSInference(models.tts.id, greetText)
      .then((audioBlob) => {
        const audioUrl = URL.createObjectURL(audioBlob);
        ttsAudioUrlRef.current = audioUrl;
        if (!ttsAudioRef.current) ttsAudioRef.current = new Audio();
        const audio = ttsAudioRef.current;
        audio.src = audioUrl;
        audio.load();
        // Same rule as a normal turn: stay in "speaking" until the greeting has
        // actually finished, so the wake word doesn't arm over our own audio.
        audio.onended = () => setStage("idle");
        audio.onerror = () => setStage("idle");
        playing = true;
        audio.play().catch((e) => {
          console.warn("TTS autoplay blocked:", e);
          playing = false;
          setStage("idle");
        });
      })
      .catch((e) => console.error("Auto-greet TTS failed:", e))
      .finally(() => {
        setIsTTSGenerating(false);
        if (!playing) setStage("idle");
      });
  }, [recognizedUser, models.tts]);

  const handleNewConversation = useCallback(() => {
    const id = Date.now().toString();
    const newConversation: Conversation = {
      id,
      title: `Conversation ${conversationCounter}`,
      date: new Date(),
      messages: [],
      // The agent service keys its memory off thread_id, so each conversation
      // needs its own — a shared constant would blend them together.
      threadId: Number(id),
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

      // Retrieval runs first when a collection is picked, so say so rather than
      // showing "Thinking" through a multi-second Chroma round trip.
      setStage(ragDatasource ? "retrieving" : "thinking");
      const assistantMsgId = uuidv4();
      const assistantMessage: ConversationMessage = {
        id: assistantMsgId,
        sender: "assistant",
        text: "",
        date: new Date(),
        isStreaming: true,
        ragCollection: ragDatasource ? collectionLabel(ragDatasource) : undefined,
      };
      addMessageToConversation(conversationId, assistantMessage);

      const currentConvo = conversations.find((c) => c.id === conversationId);
      const threadId = currentConvo?.threadId ?? Number(conversationId);
      const priorMessages: ChatMessage[] = (currentConvo?.messages ?? [])
        .filter((m) => m.text)
        .map((m) => ({ id: m.id, sender: m.sender, text: m.text }));
      priorMessages.push({ id: uuidv4(), sender: "user", text: transcribedText });

      const localChatHistory: ChatMessage[] = [...priorMessages];
      let llmFirstChunk = false;
      const llmStart = performance.now();
      let llmTtfbMs = 0;
      let ragLatencyMs: number | undefined;
      let ragDocCount: number | undefined;
      let reportedQueries: string[] = [];
      // Once real answer text arrives the search markers stop mattering — skip
      // re-scanning every subsequent chunk.
      let sawAnswerText = false;
      // Set once TTS playback owns the stage transition back to "done".
      let handedOffToPlayback = false;

      const setLocalChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>> = (updater) => {
        if (typeof updater === "function") {
          const updated = updater(localChatHistory);
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.sender === "assistant") {
            if (!llmFirstChunk && lastMsg.text) {
              llmFirstChunk = true;
              llmTtfbMs = Math.round(performance.now() - llmStart);
            }

            // The agent narrates its tool use in-band ("[searching]",
            // "Searching: <query>") before any answer tokens arrive. Surface
            // that as a stage instead of a silent pause.
            if (isAgentSelected && !sawAnswerText) {
              const progress = parseSearchProgress(lastMsg.text);
              if (progress.queries.length !== reportedQueries.length) {
                reportedQueries = progress.queries;
                updateMessageInConversation(conversationId, assistantMsgId, {
                  searchQueries: progress.queries,
                });
              }
              if (hasAnswerContent(lastMsg.text)) {
                sawAnswerText = true;
                setStage("thinking");
              } else if (progress.isSearching) {
                setStage("searching");
              }
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
        // priorMessages already includes the current user message (pushed at line 223),
        // so length === 1 means this is the very first exchange in the conversation.
        const isFirstMessage = priorMessages.length === 1;
        const userContext =
          recognizedUserRef.current && isFirstMessage
            ? `Greet the person warmly by their name "${recognizedUserRef.current}" at the start of your response. `
            : "";

        extractMemoryFromUserTurn(transcribedText);
        const memoryBlock = memoryRef.current.length
          ? `Things you remember about this user from past turns (use naturally, don't recite verbatim): ${memoryRef.current
            .map((n) => `- ${n}`)
            .join(" ")} `
          : "";
        // Grounding rules only make sense when there is context to ground in.
        const groundingBlock =
          ragDatasource || isAgentSelected ? `\n${VOICE_PROMPT_GROUNDING_CLAUSE}` : "";

        await runInference(
          {
            deploy_id: models.llm.id,
            text: transcribedText,
            max_tokens: 512,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
          },
          ragDatasource,
          localChatHistory,
          setLocalChatHistory,
          setIsStreaming,
          isAgentSelected,
          threadId,
          undefined,
          `${userContext}${memoryBlock}${renderVoiceSystemPrompt(systemPromptRef.current, {
            userName: recognizedUserRef.current,
            modelName: models.llm.modelName,
          })}${groundingBlock}\n${VOICE_PROMPT_SAFETY_SUFFIX}`,
          null,
          null,
          ({ documents, latencyMs }) => {
            ragLatencyMs = latencyMs;
            ragDocCount = documents.length;
            // Retrieval done — the model is the one working now.
            setStage("thinking");
          }
        );

        const llmTotalMs = Math.round(performance.now() - llmStart);
        const lastAssistant = localChatHistory.findLast(
          (m) => m.sender === "assistant" && m.text
        );
        const llmResponseText = lastAssistant?.text || "";
        const llmTokenEstimate = llmResponseText.split(/\s+/).length;

        // Citations the agent emitted are already parsed out by runInference.
        if (lastAssistant?.sources?.length) {
          updateMessageInConversation(conversationId, assistantMsgId, {
            sources: lastAssistant.sources,
          });
        }

        // The transcript keeps the full answer; speech gets the markdown,
        // citations, and URLs stripped out first.
        const spokenText = cleanSpeechText(llmResponseText);

        let ttsLatencyMs: number | undefined;

        if (spokenText && models.tts) {
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

            const audioBlob = await runTTSInference(models.tts.id, spokenText);
            ttsLatencyMs = Math.round(performance.now() - ttsStart);
            const audioUrl = URL.createObjectURL(audioBlob);
            ttsAudioUrlRef.current = audioUrl;

            updateMessageInConversation(conversationId, assistantMsgId, {
              audioBlob,
              isStreaming: false,
            });

            if (!ttsAudioRef.current) ttsAudioRef.current = new Audio();
            const audio = ttsAudioRef.current;
            audio.src = audioUrl;
            audio.load();
            // Hold "speaking" until playback actually finishes. The wake word only
            // listens in idle/done, so returning to done early would re-open the
            // mic while the assistant is still talking — and it would hear itself.
            audio.onended = () => setStage("done");
            audio.onerror = () => setStage("done");
            handedOffToPlayback = true;
            audio.play().catch((e) => {
              console.warn("TTS autoplay blocked:", e);
              handedOffToPlayback = false;
              setStage("done");
            });
          } catch (ttsErr) {
            console.error("TTS error:", ttsErr);
          } finally {
            setIsTTSGenerating(false);
          }
        }

        const totalMs = Math.round(performance.now() - pipelineStart);
        const turnMetrics: PipelineMetrics = {
          stt_latency_ms: sttLatencyMs,
          llm_ttfb_ms: llmTtfbMs,
          llm_total_ms: llmTotalMs,
          llm_tokens: llmTokenEstimate,
          tts_latency_ms: ttsLatencyMs,
          total_ms: totalMs,
          rag_used: Boolean(ragDatasource),
          rag_collection: ragDatasource ? collectionLabel(ragDatasource) : undefined,
          rag_latency_ms: ragLatencyMs,
          rag_doc_count: ragDocCount,
          web_search_used: isAgentSelected,
        };
        // Header strip shows the latest turn; the transcript keeps each turn's
        // own numbers next to the answer they belong to.
        setMetrics(turnMetrics);
        updateMessageInConversation(conversationId, assistantMsgId, {
          metrics: turnMetrics,
        });
      } catch (err) {
        console.error("LLM inference error:", err);
        updateMessageInConversation(conversationId, assistantMsgId, {
          text: "Error: Failed to get LLM response.",
          isStreaming: false,
        });
      } finally {
        updateMessageInConversation(conversationId, assistantMsgId, { isStreaming: false });
        // When playback started, its onended handler returns us to "done".
        if (!handedOffToPlayback) setStage("done");
      }
    },
    [
      models,
      conversations,
      addMessageToConversation,
      updateMessageInConversation,
      extractMemoryFromUserTurn,
      ragDatasource,
      isAgentSelected,
    ]
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

  const isProcessing =
    stage === "transcribing" ||
    stage === "retrieving" ||
    stage === "searching" ||
    stage === "thinking" ||
    stage === "speaking";
  const stageConfig = STAGE_CONFIG[stage];

  // Header buttons keep the existing icon-button look exactly — same size, same
  // hover treatment as Status/Settings. "On" is shown by the icon taking the
  // accent colour, not by a filled pill, so the header reads as it always has.
  const toggleClass = (active: boolean, disabled = false) =>
    cn(
      "w-8 h-8 flex items-center justify-center rounded-lg transition-colors relative",
      disabled && "opacity-40 cursor-not-allowed",
      active
        ? "text-TT-purple-accent"
        : theme === "dark"
          ? "text-gray-500 hover:text-TT-purple-accent hover:bg-white/[0.05]"
          : "text-gray-400 hover:text-TT-purple-accent hover:bg-black/[0.04]"
    );

  const webSearchTooltip = isAgentAvailable
    ? "Let the assistant search the web before answering"
    : models.llm
      ? "Web search needs a tool-calling model and a configured TAVILY_API_KEY"
      : "Deploy a chat model to enable web search";

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
          theme === "dark" ? "border-white/[0.1] bg-white/[0.03]" : "border-black/[0.08] bg-black/[0.02]"
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
                  <span>Speech-to-text: {models.whisper?.modelName || "not deployed"}</span>
                  <span>LLM: {models.llm?.modelName || "not deployed"}</span>
                  <span>Text-to-speech: {models.tts?.modelName || "not deployed"}</span>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Knowledge (RAG) toggle — click toggles, chevron picks a collection */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        aria-label="Knowledge source"
                        aria-pressed={Boolean(ragDatasource)}
                        disabled={knowledgeOptions.length === 0}
                        className={toggleClass(
                          Boolean(ragDatasource),
                          knowledgeOptions.length === 0
                        )}
                      >
                        <Database className="w-4 h-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60 p-1">
                      <p className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                        Answer from documents
                      </p>
                      <button
                        onClick={() => setRagCollectionId(null)}
                        className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors"
                      >
                        <span>Off</span>
                        {!ragDatasource && <Check className="h-3.5 w-3.5" />}
                      </button>
                      {knowledgeOptions.map((collection) => (
                        <button
                          key={collection.id}
                          onClick={() => setRagCollectionId(collection.id)}
                          className="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors"
                        >
                          <span className="truncate">{collectionLabel(collection)}</span>
                          {ragCollectionId === collection.id && (
                            <Check className="h-3.5 w-3.5 shrink-0" />
                          )}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {knowledgeOptions.length === 0
                  ? "No collections yet — add one in RAG Management"
                  : "Ground answers in a document collection"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Web search (Search Agent) toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <button
                    aria-label="Web search"
                    aria-pressed={isAgentSelected}
                    disabled={!isAgentAvailable}
                    onClick={() => setIsAgentSelected(!isAgentSelected)}
                    className={toggleClass(isAgentSelected, !isAgentAvailable)}
                  >
                    <Globe className="w-4 h-4" />
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {webSearchTooltip}
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

          {/* Metrics — shows the panel inline, right under the header */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label="Pipeline metrics"
                  aria-pressed={showMetrics}
                  onClick={() => setShowMetrics(!showMetrics)}
                  className={toggleClass(showMetrics)}
                >
                  <BarChart3 className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {showMetrics ? "Hide pipeline metrics" : "Show pipeline metrics"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Assistant prompt settings sheet */}
          <Sheet>
            <SheetTrigger asChild>
              <button
                aria-label="Assistant prompt settings"
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-lg transition-colors",
                  theme === "dark"
                    ? "text-gray-500 hover:text-TT-purple-accent hover:bg-white/[0.05]"
                    : "text-gray-400 hover:text-TT-purple-accent hover:bg-black/[0.04]"
                )}
              >
                <Settings2 className="w-4 h-4" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="flex flex-col">
              <VoiceAgentSettings value={systemPrompt} onSave={handleSaveSystemPrompt} />
            </SheetContent>
          </Sheet>
        </div>
      </motion.header>

      {/* Recognized user welcome banner */}
      {showWelcomeBanner && recognizedUser && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className={cn(
            "flex items-center justify-between px-5 py-2 shrink-0 border-b",
            theme === "dark"
              ? "bg-green-950/60 border-green-500/30"
              : "bg-green-50 border-green-200"
          )}
        >
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-green-500 shrink-0" />
            <span className={cn("text-sm font-medium", theme === "dark" ? "text-green-300" : "text-green-800")}>
              Welcome back,{" "}
              <span className="font-bold">{recognizedUser}</span>! The voice agent is ready for you.
            </span>
          </div>
          <button
            onClick={() => setShowWelcomeBanner(false)}
            className={cn(
              "ml-3 shrink-0 rounded p-0.5 transition-colors",
              theme === "dark"
                ? "text-green-400 hover:text-green-200 hover:bg-green-800/40"
                : "text-green-600 hover:text-green-900 hover:bg-green-100"
            )}
            aria-label="Dismiss welcome banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}

      {/* Inline metrics — stays open across turns while the toggle is on */}
      <AnimatePresence initial={false}>
        {showMetrics && (
          <motion.div
            key="metrics"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "shrink-0 overflow-hidden border-b",
              theme === "dark"
                ? "border-white/[0.1] bg-white/[0.02]"
                : "border-black/[0.08] bg-black/[0.01]"
            )}
          >
            <MetricsPanel metrics={metrics} variant="compact" />
          </motion.div>
        )}
      </AnimatePresence>

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
          stage={stage}
        />
      </motion.div>

      {/* Controls footer */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className={cn(
          "shrink-0 border-t px-5 py-3",
          theme === "dark" ? "border-white/[0.1] bg-white/[0.03]" : "border-black/[0.08] bg-black/[0.02]"
        )}
      >
        <AudioRecorderWithVisualizer
          ref={recorderRef}
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
