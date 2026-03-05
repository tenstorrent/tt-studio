// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useCallback, useRef } from "react";
import { AppSidebar } from "@/src/components/speechToText/appSidebar";
import { MainContent } from "@/src/components/speechToText/mainContent";
import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { Card } from "../ui/card";
import { Mic, MessageSquare } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import { fetchDeployedModelsInfo } from "@/src/api/modelsDeployedApis";
import { runInference } from "@/src/components/chatui/runInference";
import type { ChatMessage } from "@/src/components/chatui/types";
import { v4 as uuidv4 } from "uuid";

export interface ConversationMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  date: Date;
  audioBlob?: Blob;
  isStreaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  date: Date;
  messages: ConversationMessage[];
}

export default function SpeechToTextApp() {
  if (process.env.NODE_ENV === "development") {
    console.log("Rendering SpeechToTextApp");
  }
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<
    string | null
  >(null);
  const [isRecording, setIsRecording] = useState(false);
  const [conversationCounter, setConversationCounter] = useState(1);
  const [showRecordingInterface, setShowRecordingInterface] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const { theme } = useTheme();

  const location = useLocation();
  const [modelID, setModelID] = useState<string | null>(null);
  const [llmDeployId, setLlmDeployId] = useState<string | null>(null);

  // Chat history state used by runInference for the current conversation
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const chatHistoryRef = useRef<ChatMessage[]>([]);

  // Keep ref in sync for use inside callbacks
  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  useEffect(() => {
    if (location.state) {
      if (!location.state.containerID) {
        customToast.error(
          "modelID is unavailable. Try navigating here from the Models Deployed tab"
        );
        return;
      }
      setModelID(location.state.containerID);
      console.log(location.state.containerID);
    }
  }, [location.state, modelID]);

  // Auto-discover deployed LLM on mount
  useEffect(() => {
    const discoverLlm = async () => {
      try {
        const deployed = await fetchDeployedModelsInfo();
        const chatModel = deployed.find((m) => m.model_type === "chat");
        if (chatModel) {
          setLlmDeployId(chatModel.id);
          console.log("Auto-discovered LLM:", chatModel.modelName, chatModel.id);
        } else {
          console.warn("No deployed LLM (chat) model found");
        }
      } catch (err) {
        console.error("Failed to discover deployed LLM:", err);
      }
    };
    discoverLlm();
  }, []);

  const handleNewConversation = () => {
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
    setIsRecording(true);
    setShowRecordingInterface(true);
    setChatHistory([]);

    return id;
  };

  // Helper: add a message to the specified conversation
  const addMessageToConversation = useCallback(
    (conversationId: string, message: ConversationMessage) => {
      setConversations((prev) =>
        prev.map((convo) =>
          convo.id === conversationId
            ? { ...convo, messages: [...convo.messages, message] }
            : convo
        )
      );
    },
    []
  );

  // Helper: update a specific message within a conversation
  const updateMessageInConversation = useCallback(
    (conversationId: string, messageId: string, updates: Partial<ConversationMessage>) => {
      setConversations((prev) =>
        prev.map((convo) =>
          convo.id === conversationId
            ? {
                ...convo,
                messages: convo.messages.map((msg) =>
                  msg.id === messageId ? { ...msg, ...updates } : msg
                ),
              }
            : convo
        )
      );
    },
    []
  );

  // Send transcribed text to the LLM and stream the response
  const sendToLlm = useCallback(
    async (transcribedText: string, conversationId: string) => {
      if (!llmDeployId) {
        console.warn("No LLM deploy_id available, skipping LLM call");
        customToast.error("No deployed LLM found. Deploy a chat model first.");
        return;
      }

      // Add a placeholder assistant message
      const assistantMsgId = uuidv4();
      const assistantMessage: ConversationMessage = {
        id: assistantMsgId,
        sender: "assistant",
        text: "",
        date: new Date(),
        isStreaming: true,
      };
      addMessageToConversation(conversationId, assistantMessage);

      // Build the chat history for the LLM from the current conversation's user/assistant messages
      const currentConvo = conversations.find((c) => c.id === conversationId);
      const priorMessages: ChatMessage[] = (currentConvo?.messages ?? [])
        .filter((m) => m.text)
        .map((m) => ({
          id: m.id,
          sender: m.sender,
          text: m.text,
        }));
      // Add the new user message
      priorMessages.push({ id: uuidv4(), sender: "user", text: transcribedText });

      // Use a local chatHistory state for runInference
      const localChatHistory: ChatMessage[] = [...priorMessages];
      const setLocalChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>> = (updater) => {
        if (typeof updater === "function") {
          const updated = updater(localChatHistory);
          // Find the last assistant message and sync it back to conversation
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.sender === "assistant") {
            updateMessageInConversation(conversationId, assistantMsgId, {
              text: lastMsg.text,
            });
          }
          // Update local reference
          localChatHistory.length = 0;
          localChatHistory.push(...updated);
        }
      };

      try {
        await runInference(
          {
            deploy_id: llmDeployId,
            text: transcribedText,
            max_tokens: 512,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
          },
          undefined, // no RAG
          localChatHistory,
          setLocalChatHistory,
          setIsStreaming,
          false, // not agent mode
          0, // thread id
        );
      } catch (err) {
        console.error("LLM inference error:", err);
        updateMessageInConversation(conversationId, assistantMsgId, {
          text: "Error: Failed to get LLM response.",
          isStreaming: false,
        });
      } finally {
        // Mark streaming complete
        updateMessageInConversation(conversationId, assistantMsgId, {
          isStreaming: false,
        });
      }
    },
    [llmDeployId, conversations, addMessageToConversation, updateMessageInConversation]
  );

  // After transcription completes, add user message then send to LLM
  const handleNewTranscription = (text: string, audioBlob: Blob) => {
    const userMsgId = uuidv4();
    const userMessage: ConversationMessage = {
      id: userMsgId,
      sender: "user",
      text,
      date: new Date(),
      audioBlob,
    };

    let targetConversationId = selectedConversation;

    if (!targetConversationId) {
      targetConversationId = handleNewConversation();
    }

    addMessageToConversation(targetConversationId, userMessage);

    // Send the transcribed text to the LLM
    sendToLlm(text, targetConversationId);

    return targetConversationId;
  };

  const toggleView = () => {
    setShowRecordingInterface(!showRecordingInterface);
  };

  const selectedConversationData = selectedConversation
    ? conversations.find((c) => c.id === selectedConversation)
    : null;

  useEffect(() => {
    const savedCounter = localStorage.getItem("conversationCounter");
    if (savedCounter) {
      setConversationCounter(Number.parseInt(savedCounter));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("conversationCounter", conversationCounter.toString());
  }, [conversationCounter]);

  return (
    <div className="w-full md:w-11/12 lg:w-4/5 h-full md:h-4/5 mx-auto my-auto p-2 md:p-4 pb-20">
      <Card
        className={cn(
          "flex w-full h-full shadow-xl overflow-hidden rounded-xl backdrop-blur-sm",
          theme === "dark"
            ? "bg-[#1A1A1A] border-TT-purple/20"
            : "bg-white border-TT-purple-shade/20"
        )}
      >
        <SidebarProvider defaultOpen={false}>
          <div className="flex w-full h-full">
            <div
              className={cn(
                "h-full border-r overflow-y-auto",
                theme === "dark"
                  ? "border-TT-purple/20"
                  : "border-TT-purple-shade/20"
              )}
            >
              <AppSidebar
                conversations={conversations}
                selectedConversation={selectedConversation}
                onSelectConversation={(id) => {
                  setSelectedConversation(id);
                  setIsRecording(false);
                  setShowRecordingInterface(false);
                }}
                onNewConversation={handleNewConversation}
              />
            </div>

            <div className="flex flex-col flex-1 h-full">
              <div
                className={cn(
                  "sticky top-0 z-50 h-16 md:h-16 border-b flex items-center justify-between px-3 md:px-6",
                  theme === "dark"
                    ? "border-TT-purple/30 bg-gradient-to-r from-[#1A1A1A] via-[#222222] to-[#1A1A1A]"
                    : "border-TT-purple-shade/20 bg-gradient-to-r from-white via-gray-50 to-white"
                )}
              >
                <div className="flex items-center">
                  <SidebarTrigger className="mr-2 md:mr-4 text-TT-purple hover:text-TT-purple-accent" />
                  <h1 className="text-lg md:text-xl font-semibold text-TT-purple truncate max-w-[150px] md:max-w-full">
                    {selectedConversation
                      ? conversations.find((c) => c.id === selectedConversation)
                          ?.title || "Speech to Text"
                      : "New Conversation"}
                  </h1>
                  {selectedConversation && selectedConversationData && (
                    <div
                      className={cn(
                        "ml-2 md:ml-4 text-xs md:text-sm px-2 md:px-2.5 py-0.5 md:py-1 rounded-full",
                        theme === "dark"
                          ? "text-TT-purple-tint1 bg-TT-purple-shade/40"
                          : "text-TT-purple bg-TT-purple-shade/20"
                      )}
                    >
                      {selectedConversationData.messages.length || 0}{" "}
                      {selectedConversationData.messages.length === 1
                        ? "message"
                        : "messages"}
                    </div>
                  )}
                </div>
                {selectedConversation && (
                  <div className="flex items-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleView}
                      className={cn(
                        "text-xs md:text-sm px-2 md:px-4 py-1 md:py-2 h-8 md:h-9",
                        theme === "dark"
                          ? "border-TT-purple/40 hover:border-TT-purple bg-TT-purple-shade/30 hover:bg-TT-purple-shade/50 text-white"
                          : "border-TT-purple-shade/40 hover:border-TT-purple bg-TT-purple-shade/10 hover:bg-TT-purple-shade/20 text-gray-900"
                      )}
                    >
                      {showRecordingInterface ? (
                        <>
                          <MessageSquare className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2 text-TT-purple-accent" />
                          <span className="hidden xs:inline">View</span>{" "}
                          Conversation
                        </>
                      ) : (
                        <>
                          <Mic className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2 text-TT-purple-accent" />
                          <span className="hidden xs:inline">Record</span> Audio
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-hidden">
                <MainContent
                  conversations={conversations}
                  selectedConversation={selectedConversation}
                  onNewTranscription={handleNewTranscription}
                  isRecording={isRecording}
                  setIsRecording={setIsRecording}
                  showRecordingInterface={showRecordingInterface}
                  setShowRecordingInterface={setShowRecordingInterface}
                  modelID={modelID || ""}
                  isStreaming={isStreaming}
                />
              </div>
            </div>
          </div>
        </SidebarProvider>
      </Card>
    </div>
  );
}
