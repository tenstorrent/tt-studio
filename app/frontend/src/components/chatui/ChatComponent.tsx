// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { useState, useEffect, useCallback, useRef } from "react";
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
import type {
  InferenceRequest,
  RagDataSource,
  ChatMessage,
  Model,
  InferenceStats,
} from "./types";
import { runInference } from "./runInference";
import { v4 as uuidv4 } from "uuid";
import { usePersistentState } from "./usePersistentState";
import { checkDeployedModels } from "../../api/modelsDeployedApis";
// import { threadId } from "worker_threads";

export default function ChatComponent() {
  console.log("ChatComponent rendered");
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
    [[]]
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
  const [isAgentSelected, setIsAgentSelected] = useState<boolean>(false);
  const [screenSize, setScreenSize] = useState({
    isMobileView: false,
    isLargeScreen: false,
    isExtraLargeScreen: false,
  });
  const chatContainerRef = useRef<HTMLDivElement>(null);

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
      const width = window.innerWidth;
      setScreenSize({
        isMobileView: width < 768,
        isLargeScreen: width >= 1280,
        isExtraLargeScreen: width >= 1600,
      });

      if (width < 768) {
        setIsHistoryPanelOpen(false);
      } else {
        setIsHistoryPanelOpen(true);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [chatThreads, currentThreadIndex]);

  // TODO:
  //! this is a temporary fix to avoid the modelID being null
  useEffect(() => {
    if (chatThreads.length === 0) {
      setChatThreads([[]]);
      setCurrentThreadIndex(0);
    }
  }, [chatThreads, setChatThreads, setCurrentThreadIndex]);

  const handleInference = useCallback(
    async (continuationMessageId: string | null = null) => {
      if (textInput.trim() === "") return;
      const modelsDeployed = await checkDeployedModels();
      if (modelsDeployed && !modelID) {
        return;
      }

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
            : msg
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
        deploy_id: modelID || "", // Provide empty string as fallback when modelID is null
        text: continuationMessageId ? `Continue: ${textInput}` : textInput,
      };

      console.log("Running inference with request:", inferenceRequest);
      setIsStreaming(true);

      if (screenSize.isMobileView) {
        setIsHistoryPanelOpen(false);
      }

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
        isAgentSelected,
        currentThreadIndex
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
      isAgentSelected,
      screenSize.isMobileView,
    ]
  );

  const handleReRender = useCallback(
    async (messageId: string) => {
      const messageToReRender = chatThreads[currentThreadIndex]?.find(
        (msg) => msg.id === messageId
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
            chatThreads[currentThreadIndex].indexOf(messageToReRender)
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
                  updatedMessage.inferenceStats
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
        isAgentSelected,
        currentThreadIndex
      );

      setReRenderingMessageId(null);
    },
    [
      chatThreads,
      currentThreadIndex,
      modelID,
      ragDatasource,
      setChatThreads,
      isAgentSelected,
    ]
  );

  const handleContinue = useCallback(
    (messageId: string) => {
      const messageToContinue = chatThreads[currentThreadIndex]?.find(
        (msg) => msg.id === messageId
      );
      if (!messageToContinue || messageToContinue.sender !== "assistant")
        return;

      setTextInput(`Continue from: "${messageToContinue.text}"`);
    },
    [chatThreads, currentThreadIndex]
  );

  const handleSelectConversation = useCallback(
    (id: string) => {
      setCurrentThreadIndex(parseInt(id));
      setRagDatasource(undefined);

      if (screenSize.isMobileView) {
        setIsHistoryPanelOpen(false);
      }
    },
    [setCurrentThreadIndex, setRagDatasource, screenSize.isMobileView]
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

  // Function to toggle history panel with smooth transition
  const toggleHistoryPanel = () => {
    setIsHistoryPanelOpen((prev) => !prev);
  };

  // Calculate appropriate content width based on screen size
  const getContentMaxWidth = () => {
    if (screenSize.isExtraLargeScreen) {
      return isHistoryPanelOpen ? "w-full" : "w-full";
    }
    if (screenSize.isLargeScreen) {
      return isHistoryPanelOpen ? "w-full" : "w-full";
    }
    return "w-full";
  };

  return (
    <div className="flex flex-col w-full max-w-full mx-auto h-screen overflow-hidden p-2 sm:p-4 md:p-6">
      <Card className="flex flex-row w-full h-full overflow-hidden min-w-0 relative">
        {/* Mobile history panel overlay */}
        <AnimatePresence initial={false} mode="wait">
          {isHistoryPanelOpen && screenSize.isMobileView && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              onClick={toggleHistoryPanel}
            />
          )}
        </AnimatePresence>

        {/* History panel - different behavior based on screen size */}
        <AnimatePresence initial={false} mode="wait">
          {isHistoryPanelOpen && (
            <motion.div
              initial={screenSize.isMobileView ? { x: "-100%" } : { width: 0 }}
              animate={
                screenSize.isMobileView
                  ? { x: 0 }
                  : {
                      width: screenSize.isExtraLargeScreen
                        ? "400px"
                        : screenSize.isLargeScreen
                          ? "350px"
                          : "300px",
                      minWidth: screenSize.isExtraLargeScreen
                        ? "300px"
                        : screenSize.isLargeScreen
                          ? "280px"
                          : "250px",
                      maxWidth: screenSize.isExtraLargeScreen
                        ? "20%"
                        : screenSize.isLargeScreen
                          ? "25%"
                          : "30%",
                    }
              }
              exit={screenSize.isMobileView ? { x: "-100%" } : { width: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className={`h-full overflow-hidden border-r border-gray-200 dark:border-gray-900 
                p-4 bg-white dark:bg-black
                ${
                  screenSize.isMobileView
                    ? "fixed top-0 left-0 w-4/5 max-w-xs z-50 shadow-xl"
                    : "relative flex-shrink-0"
                }`}
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
                  // Auto-close on mobile after creating new conversation
                  if (screenSize.isMobileView) {
                    setIsHistoryPanelOpen(false);
                  }
                }}
                onDeleteConversation={(id) => {
                  const index = parseInt(id);
                  setChatThreads((prevThreads) =>
                    prevThreads.filter((_, i) => i !== index)
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
                        : thread
                    )
                  );
                }}
              />
              {/* Mobile close button */}
              {screenSize.isMobileView && (
                <button
                  className="absolute top-4 right-4 text-gray-500 p-2"
                  onClick={toggleHistoryPanel}
                >
                  ✕
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div
          className={`flex flex-col flex-grow min-w-0 p-2 sm:p-4 ${getContentMaxWidth()} overflow-hidden`}
        >
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
            isAgentSelected={isAgentSelected}
            setIsAgentSelected={setIsAgentSelected}
            isMobileView={screenSize.isMobileView}
          />
          <div
            ref={chatContainerRef}
            className="flex-grow overflow-y-auto px-1 sm:px-2 md:px-4"
          >
            <ChatHistory
              chatHistory={chatThreads[currentThreadIndex] || []}
              logo={logo}
              setTextInput={setTextInput}
              isStreaming={isStreaming}
              onReRender={handleReRender}
              onContinue={handleContinue}
              reRenderingMessageId={reRenderingMessageId}
              isMobileView={screenSize.isMobileView}
            />
          </div>
          <InputArea
            textInput={textInput}
            setTextInput={setTextInput}
            handleInference={() => handleInference(null)}
            isStreaming={isStreaming}
            isListening={isListening}
            setIsListening={setIsListening}
            isMobileView={screenSize.isMobileView}
            onCreateNewConversation={() => {
              setChatThreads((prevThreads) => [...prevThreads, []]);
              setCurrentThreadIndex(chatThreads.length);
              setRagDatasource(undefined);
              if (screenSize.isMobileView) {
                setIsHistoryPanelOpen(false);
              }
            }}
          />
        </div>
      </Card>
    </div>
  );
}
