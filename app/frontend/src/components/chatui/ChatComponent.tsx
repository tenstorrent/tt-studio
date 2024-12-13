// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "../ui/card";
import { useLocation } from "react-router-dom";
import logo from "../../assets/tt_logo.svg";
import { fetchModels } from "../../api/modelsDeployedApis";
import { useQuery } from "react-query";
import { fetchCollections } from "@/src/components/rag";
import Header from "./Header";
import ChatHistory from "./ChatHistory";
import InputArea from "./InputArea";
import { HistoryPanel } from "./HistoryPanel";
import {
  InferenceRequest,
  RagDataSource,
  ChatMessage,
  Model,
  InferenceStats,
} from "./types";
import { runInference } from "./runInference";
import { v4 as uuidv4 } from "uuid";
import { usePersistentState } from "./usePersistentState";

export default function ChatComponent() {
  const location = useLocation();
  const [textInput, setTextInput] = useState<string>("");
  const [ragDatasource, setRagDatasource] = useState<
    RagDataSource | undefined
  >();
  const { data: ragDataSources } = useQuery("collectionsList", {
    queryFn: fetchCollections,
    initialData: [],
  });
  const [chatThreads, setChatThreads] = usePersistentState<ChatMessage[][]>(
    "chat_threads",
    [[]],
  );
  const [currentThreadIndex, setCurrentThreadIndex] =
    usePersistentState<number>("current_thread_index", 0);
  const [modelID, setModelID] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [modelsDeployed, setModelsDeployed] = useState<Model[]>([]);
  const [reRenderingMessageId, setReRenderingMessageId] = useState<
    string | null
  >(null);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(true);

  useEffect(() => {
    if (location.state) {
      setModelID(location.state.containerID);
      setModelName(location.state.modelName);
    }

    const loadModels = async () => {
      try {
        const models = await fetchModels();
        setModelsDeployed(models);
      } catch (error) {
        console.error("Error fetching models:", error);
      }
    };

    loadModels();
  }, [location.state]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsHistoryPanelOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize(); // Call it initially

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (chatThreads.length === 0) {
      setChatThreads([[]]);
      setCurrentThreadIndex(0);
    }
  }, [chatThreads, setChatThreads, setCurrentThreadIndex]);

  const handleInference = useCallback(
    (continuationMessageId: string | null = null) => {
      if (textInput.trim() === "" || !modelID) return;

      // Ensure the current thread exists
      if (!chatThreads[currentThreadIndex]) {
        setChatThreads((prevThreads) => {
          const newThreads = [...prevThreads];
          newThreads[currentThreadIndex] = [];
          return newThreads;
        });
      }

      let updatedChatHistory: ChatMessage[];

      if (continuationMessageId) {
        updatedChatHistory = chatThreads[currentThreadIndex].map((msg) =>
          msg.id === continuationMessageId
            ? { ...msg, text: msg.text + " [Continuing...] " }
            : msg,
        );
      } else {
        const userMessage: ChatMessage = {
          id: uuidv4(),
          sender: "user",
          text: textInput,
        };
        updatedChatHistory = [
          ...(chatThreads[currentThreadIndex] || []),
          userMessage,
        ];
      }

      setChatThreads((prevThreads) => {
        const newThreads = [...prevThreads];
        newThreads[currentThreadIndex] = updatedChatHistory;
        return newThreads;
      });

      const inferenceRequest: InferenceRequest = {
        deploy_id: modelID,
        text: continuationMessageId ? `Continue: ${textInput}` : textInput,
      };

      setIsStreaming(true);

      runInference(
        inferenceRequest,
        ragDatasource,
        updatedChatHistory,
        (newHistory) => {
          setChatThreads((prevThreads) => {
            const newThreads = [...prevThreads];
            const currentHistory =
              typeof newHistory === "function"
                ? newHistory(newThreads[currentThreadIndex] || [])
                : newHistory;
            const lastMessage = currentHistory[currentHistory.length - 1];
            if (
              lastMessage &&
              lastMessage.sender === "assistant" &&
              !lastMessage.id
            ) {
              newThreads[currentThreadIndex] = [
                ...currentHistory.slice(0, -1),
                { ...lastMessage, id: uuidv4() },
              ];
            } else {
              newThreads[currentThreadIndex] = currentHistory;
            }
            return newThreads;
          });
        },
        setIsStreaming,
      );

      setTextInput("");
      setReRenderingMessageId(null);
    },
    [
      chatThreads,
      currentThreadIndex,
      modelID,
      ragDatasource,
      textInput,
      setChatThreads,
    ],
  );

  const handleReRender = useCallback(
    async (messageId: string) => {
      const messageToReRender = chatThreads[currentThreadIndex]?.find(
        (msg) => msg.id === messageId,
      );
      if (
        !messageToReRender ||
        messageToReRender.sender !== "assistant" ||
        !modelID
      )
        return;

      const userMessage = chatThreads[currentThreadIndex]?.find(
        (msg) =>
          msg.sender === "user" &&
          chatThreads[currentThreadIndex].indexOf(msg) <
            chatThreads[currentThreadIndex].indexOf(messageToReRender),
      );
      if (!userMessage) return;

      setReRenderingMessageId(messageId);
      setIsStreaming(true);

      const inferenceRequest: InferenceRequest = {
        deploy_id: modelID,
        text: userMessage.text,
      };

      await runInference(
        inferenceRequest,
        ragDatasource,
        chatThreads[currentThreadIndex] || [],
        (newHistory) => {
          setChatThreads((prevThreads) => {
            const newThreads = [...prevThreads];
            const currentHistory = Array.isArray(newHistory)
              ? newHistory
              : newHistory(newThreads[currentThreadIndex] || []);
            newThreads[currentThreadIndex] = currentHistory.map((msg) => {
              if (msg.id === messageId) {
                const updatedMessage =
                  currentHistory[currentHistory.length - 1];
                console.log(
                  "Inference stats received:",
                  updatedMessage.inferenceStats,
                );
                return {
                  ...msg,
                  text: updatedMessage.text,
                  inferenceStats:
                    updatedMessage.inferenceStats as InferenceStats,
                };
              }
              return msg;
            });
            return newThreads;
          });
        },
        setIsStreaming,
      );

      setReRenderingMessageId(null);
    },
    [chatThreads, currentThreadIndex, modelID, ragDatasource, setChatThreads],
  );

  const handleContinue = useCallback(
    (messageId: string) => {
      const messageToContinue = chatThreads[currentThreadIndex]?.find(
        (msg) => msg.id === messageId,
      );
      if (!messageToContinue || messageToContinue.sender !== "assistant")
        return;

      setTextInput(`Continue from: "${messageToContinue.text}"`);
    },
    [chatThreads, currentThreadIndex],
  );

  const handleSelectConversation = useCallback(
    (id: string) => {
      setCurrentThreadIndex(parseInt(id));
      setRagDatasource(undefined);
    },
    [setCurrentThreadIndex, setRagDatasource],
  );

  useEffect(() => {
    const currentThread = chatThreads[currentThreadIndex];
    if (currentThread) {
      const lastMessage = currentThread[currentThread.length - 1];
      if (
        lastMessage &&
        lastMessage.sender === "assistant" &&
        lastMessage.inferenceStats
      ) {
        console.log("Inference stats updated:", lastMessage.inferenceStats);
      }
    }
  }, [chatThreads, currentThreadIndex]);

  return (
    <div className="flex flex-col w-full max-w-[1600px] mx-auto h-screen overflow-hidden p-4 md:p-6">
      <Card className="flex flex-row w-full h-full overflow-hidden min-w-0">
        <AnimatePresence initial={false} mode="wait">
          {isHistoryPanelOpen && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: "350px", maxWidth: "35%" }}
              exit={{ width: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="h-full overflow-hidden border-r border-gray-200 dark:border-gray-900 hidden md:block p-4"
            >
              <HistoryPanel
                conversations={chatThreads.map((thread, index) => ({
                  id: index.toString(),
                  title:
                    thread[0]?.text.substring(0, 30) || `New Chat ${index + 1}`,
                }))}
                currentConversationId={currentThreadIndex.toString()}
                onSelectConversation={handleSelectConversation}
                onCreateNewConversation={() => {
                  setChatThreads((prevThreads) => [...prevThreads, []]);
                  setCurrentThreadIndex(chatThreads.length);
                  setRagDatasource(undefined);
                }}
                onDeleteConversation={(id) => {
                  const index = parseInt(id);
                  setChatThreads((prevThreads) =>
                    prevThreads.filter((_, i) => i !== index),
                  );
                  if (currentThreadIndex === index) {
                    setCurrentThreadIndex(0);
                    setRagDatasource(undefined);
                  }
                }}
                onEditConversationTitle={(id, newTitle) => {
                  const index = parseInt(id);
                  setChatThreads((prevThreads) =>
                    prevThreads.map((thread, i) =>
                      i === index
                        ? [
                            { ...thread[0], title: newTitle },
                            ...thread.slice(1),
                          ]
                        : thread,
                    ),
                  );
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div className={`flex flex-col flex-grow min-w-0 w-0 p-4`}>
          <Header
            modelName={modelName}
            modelsDeployed={modelsDeployed}
            setModelID={setModelID}
            setModelName={setModelName}
            ragDataSources={ragDataSources}
            ragDatasource={ragDatasource}
            setRagDatasource={setRagDatasource}
            isHistoryPanelOpen={isHistoryPanelOpen}
            setIsHistoryPanelOpen={setIsHistoryPanelOpen}
          />
          <ChatHistory
            chatHistory={chatThreads[currentThreadIndex] || []}
            logo={logo}
            setTextInput={setTextInput}
            isStreaming={isStreaming}
            onReRender={handleReRender}
            onContinue={handleContinue}
            reRenderingMessageId={reRenderingMessageId}
          />
          <InputArea
            textInput={textInput}
            setTextInput={setTextInput}
            handleInference={() => handleInference(null)}
            isStreaming={isStreaming}
            isListening={isListening}
            setIsListening={setIsListening}
          />
        </div>
      </Card>
    </div>
  );
}
