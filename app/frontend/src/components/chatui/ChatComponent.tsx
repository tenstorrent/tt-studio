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
  FileData,
} from "./types";
import { runInference } from "./runInference";
import { v4 as uuidv4 } from "uuid";
import { usePersistentState } from "./usePersistentState";
import { checkDeployedModels } from "../../api/modelsDeployedApis";

// Define a type for conversation with title
interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
}

export default function ChatComponent() {
  const [files, setFiles] = useState<FileData[]>([]);
  const location = useLocation();
  const [textInput, setTextInput] = useState<string>("");
  const [ragDatasource, setRagDatasource] = useState<
    RagDataSource | undefined
  >();
  const { data: ragDataSources } = useQuery("collectionsList", {
    queryFn: fetchCollections,
    initialData: [],
  });

  // Create a default thread to start with
  const defaultThread: ChatThread = {
    id: "0",
    title: "New Chat 1",
    messages: [],
  };

  // Updated structure to include titles directly in the threads
  const [chatThreads, setChatThreads] = usePersistentState<ChatThread[]>(
    "chat_threads",
    [defaultThread]
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

  // Validate and fix chat threads if needed
  useEffect(() => {
    if (!Array.isArray(chatThreads) || chatThreads.length === 0) {
      console.warn(
        "ChatThreads is not an array or is empty, resetting to default"
      );
      setChatThreads([defaultThread]);
      setCurrentThreadIndex(0);
      return;
    }

    const threadMap = new Map<string, ChatThread>();
    let needsUpdate = false;

    chatThreads.forEach((thread) => {
      if (!thread.id) {
        needsUpdate = true;
        return;
      }

      if (!threadMap.has(thread.id)) {
        threadMap.set(thread.id, thread);
      } else {
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      const uniqueThreads = Array.from(threadMap.values());
      if (uniqueThreads.length === 0) {
        setChatThreads([defaultThread]);
        setCurrentThreadIndex(0);
      } else {
        setChatThreads(uniqueThreads);

        // Make sure currentThreadIndex is valid
        if (currentThreadIndex >= uniqueThreads.length) {
          setCurrentThreadIndex(0);
        }
      }
    }
  }, [
    chatThreads,
    setChatThreads,
    currentThreadIndex,
    setCurrentThreadIndex,
    defaultThread,
  ]);

  // Load model information from location state and fetch deployed models
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

  // Update RAG datasource when thread changes
  useEffect(() => {
    const currentThread = getCurrentThread();
    if (
      currentThread &&
      Array.isArray(currentThread.messages) &&
      currentThread.messages.length > 0
    ) {
      const messagesWithRag = currentThread.messages
        .filter((msg) => msg.sender === "user" && msg.ragDatasource)
        .reverse();

      if (messagesWithRag.length > 0) {
        const mostRecentRag = messagesWithRag[0].ragDatasource;
        setRagDatasource(mostRecentRag);
      } else {
        setRagDatasource(undefined);
      }
    } else {
      setRagDatasource(undefined);
    }
  }, [currentThreadIndex, chatThreads]);

  // Handle responsive layout
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

  // Auto-scroll chat container
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [chatThreads, currentThreadIndex]);

  // Safe getter for current thread
  const getCurrentThread = useCallback(() => {
    if (!Array.isArray(chatThreads) || chatThreads.length === 0) {
      return defaultThread;
    }

    if (currentThreadIndex < 0 || currentThreadIndex >= chatThreads.length) {
      return chatThreads[0] || defaultThread;
    }

    return chatThreads[currentThreadIndex] || defaultThread;
  }, [chatThreads, currentThreadIndex, defaultThread]);

  const handleInference = useCallback(
    async (continuationMessageId: string | null = null) => {
      if (textInput.trim() === "" && files.length === 0) return;

      const modelsDeployed = await checkDeployedModels();
      if (modelsDeployed && !modelID) {
        return;
      }

      // Get the current thread first to avoid any order issues
      const threadToUse = getCurrentThread();
      const hasThreads = Array.isArray(chatThreads) && chatThreads.length > 0;

      // Create a new thread if needed
      if (!hasThreads) {
        setChatThreads([defaultThread]);
        setCurrentThreadIndex(0);
        return;
      }

      let updatedMessages: ChatMessage[] = [];

      if (continuationMessageId) {
        updatedMessages = (threadToUse.messages || []).map((msg) =>
          msg.id === continuationMessageId
            ? { ...msg, text: msg.text + " [Continuing...] " }
            : msg
        );
      } else {
        // Store ragDatasource in the user message
        const userMessage: ChatMessage = {
          id: uuidv4(),
          sender: "user",
          text: textInput,
          files: files,
          ragDatasource: ragDatasource, // Store the RAG datasource with the message
        };
        updatedMessages = [...(threadToUse.messages || []), userMessage];

        // Auto-update title for new conversations - don't return early!
        if (updatedMessages.length === 1) {
          setChatThreads((prevThreads) => {
            if (!Array.isArray(prevThreads))
              return [
                {
                  ...threadToUse,
                  title: userMessage.text.substring(0, 30),
                  messages: updatedMessages,
                },
              ];

            return prevThreads.map((thread, idx) =>
              idx === currentThreadIndex
                ? {
                    ...thread,
                    title: userMessage.text.substring(0, 30),
                    messages: updatedMessages,
                  }
                : thread
            );
          });
        }
      }

      // If this was the first message, continue with inference
      if (!continuationMessageId) {
        setChatThreads((prevThreads) => {
          if (!Array.isArray(prevThreads))
            return [{ ...threadToUse, messages: updatedMessages }];

          return prevThreads.map((thread, idx) =>
            idx === currentThreadIndex
              ? { ...thread, messages: updatedMessages }
              : thread
          );
        });
      }

      const inferenceRequest: InferenceRequest = {
        deploy_id: modelID || "", // Provide empty string as fallback when modelID is null
        text: continuationMessageId ? `Continue: ${textInput}` : textInput,
        files: files,
      };

      console.log("Running inference with request:", inferenceRequest);
      setIsStreaming(true);

      if (screenSize.isMobileView) {
        setIsHistoryPanelOpen(false);
      }

      runInference(
        inferenceRequest,
        ragDatasource,
        updatedMessages,
        (newHistory) => {
          setChatThreads((prevThreads) => {
            if (!Array.isArray(prevThreads))
              return [{ ...threadToUse, messages: [] }];

            const currentThreadFromState = prevThreads[currentThreadIndex];
            if (!currentThreadFromState) return prevThreads;

            const currentMessages = currentThreadFromState.messages || [];
            const processedHistory =
              typeof newHistory === "function"
                ? newHistory(currentMessages)
                : newHistory;

            // Safety check for processedHistory
            if (!Array.isArray(processedHistory)) return prevThreads;

            const lastMessage = processedHistory[processedHistory.length - 1];
            const finalMessages =
              lastMessage &&
              lastMessage.sender === "assistant" &&
              !lastMessage.id
                ? [
                    ...processedHistory.slice(0, -1),
                    { ...lastMessage, id: uuidv4() },
                  ]
                : processedHistory;

            return prevThreads.map((thread, idx) =>
              idx === currentThreadIndex
                ? { ...thread, messages: finalMessages }
                : thread
            );
          });
        },
        setIsStreaming,
        isAgentSelected,
        currentThreadIndex
      );

      setTextInput("");
      setReRenderingMessageId(null);
      setFiles([]);
    },
    [
      chatThreads,
      currentThreadIndex,
      modelID,
      ragDatasource,
      textInput,
      files,
      setChatThreads,
      isAgentSelected,
      screenSize.isMobileView,
      getCurrentThread,
      defaultThread,
      setCurrentThreadIndex,
    ]
  );

  const handleReRender = useCallback(
    async (messageId: string) => {
      const currentThread = getCurrentThread();
      if (!currentThread || !Array.isArray(currentThread.messages)) return;

      const messageToReRender = currentThread.messages.find(
        (msg) => msg.id === messageId
      );
      if (
        !messageToReRender ||
        messageToReRender.sender !== "assistant" ||
        !modelID
      )
        return;

      const userMessage = currentThread.messages.find(
        (msg) =>
          msg.sender === "user" &&
          currentThread.messages.indexOf(msg) <
            currentThread.messages.indexOf(messageToReRender)
      );
      if (!userMessage) return;

      // Get the RAG datasource from the user message if available
      const messageRagDatasource = userMessage.ragDatasource || ragDatasource;

      setReRenderingMessageId(messageId);
      setIsStreaming(true);

      const inferenceRequest: InferenceRequest = {
        deploy_id: modelID,
        text: userMessage.text,
        files: userMessage.files,
      };

      await runInference(
        inferenceRequest,
        messageRagDatasource,
        currentThread.messages,
        (newHistory) => {
          setChatThreads((prevThreads) => {
            if (!Array.isArray(prevThreads)) return [defaultThread];

            const currentThreadFromState = prevThreads[currentThreadIndex];
            if (
              !currentThreadFromState ||
              !Array.isArray(currentThreadFromState.messages)
            )
              return prevThreads;

            let currentHistory;
            if (Array.isArray(newHistory)) {
              currentHistory = newHistory;
            } else if (typeof newHistory === "function") {
              const result = newHistory(currentThreadFromState.messages);
              currentHistory = Array.isArray(result)
                ? result
                : currentThreadFromState.messages;
            } else {
              currentHistory = currentThreadFromState.messages;
            }

            if (!Array.isArray(currentHistory) || currentHistory.length === 0) {
              return prevThreads;
            }

            const updatedMessages = currentThreadFromState.messages.map(
              (msg) => {
                if (msg.id === messageId) {
                  const updatedMessage =
                    currentHistory[currentHistory.length - 1];
                  if (!updatedMessage) return msg;

                  console.log(
                    "Inference stats received:",
                    updatedMessage.inferenceStats
                  );
                  return {
                    ...msg,
                    text: updatedMessage.text || msg.text,
                    inferenceStats:
                      updatedMessage.inferenceStats as InferenceStats,
                  };
                }
                return msg;
              }
            );

            return prevThreads.map((thread, idx) =>
              idx === currentThreadIndex
                ? { ...thread, messages: updatedMessages }
                : thread
            );
          });
        },
        setIsStreaming,
        isAgentSelected,
        currentThreadIndex
      );

      setReRenderingMessageId(null);
    },
    [
      getCurrentThread,
      currentThreadIndex,
      modelID,
      ragDatasource,
      setChatThreads,
      isAgentSelected,
      defaultThread,
    ]
  );

  const handleContinue = useCallback(
    (messageId: string) => {
      const currentThread = getCurrentThread();
      if (!currentThread || !Array.isArray(currentThread.messages)) return;

      const messageToContinue = currentThread.messages.find(
        (msg) => msg.id === messageId
      );
      if (!messageToContinue || messageToContinue.sender !== "assistant")
        return;

      setTextInput(`Continue from: "${messageToContinue.text}"`);
    },
    [getCurrentThread]
  );

  const handleSelectConversation = useCallback(
    (id: string) => {
      if (!Array.isArray(chatThreads)) {
        setChatThreads([defaultThread]);
        setCurrentThreadIndex(0);
        return;
      }

      const index = chatThreads.findIndex((thread) => thread.id === id);
      if (index !== -1) {
        setCurrentThreadIndex(index);
        setRagDatasource(undefined);

        if (screenSize.isMobileView) {
          setIsHistoryPanelOpen(false);
        }
      }
    },
    [
      chatThreads,
      setCurrentThreadIndex,
      setRagDatasource,
      screenSize.isMobileView,
      setChatThreads,
      defaultThread,
    ]
  );

  // Create a new conversation with a unique ID
  const createNewConversation = useCallback(() => {
    if (!Array.isArray(chatThreads)) {
      setChatThreads([defaultThread]);
      setCurrentThreadIndex(0);
      return;
    }

    // Find the highest ID to ensure uniqueness
    let maxId = -1;
    chatThreads.forEach((thread) => {
      const threadId = parseInt(thread.id, 10);
      if (!isNaN(threadId) && threadId > maxId) {
        maxId = threadId;
      }
    });

    const newThreadId = (maxId + 1).toString();
    const newThread = {
      id: newThreadId,
      title: `New Chat ${chatThreads.length + 1}`,
      messages: [],
    };

    setChatThreads((prevThreads) => {
      if (!Array.isArray(prevThreads)) return [newThread];
      return [...prevThreads, newThread];
    });

    // Set the current thread to the new one
    setCurrentThreadIndex(chatThreads.length);
    setRagDatasource(undefined);

    if (screenSize.isMobileView) {
      setIsHistoryPanelOpen(false);
    }
  }, [
    chatThreads,
    setChatThreads,
    setCurrentThreadIndex,
    screenSize.isMobileView,
    defaultThread,
  ]);

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

  // Log inference stats when they're updated
  useEffect(() => {
    const currentThread = getCurrentThread();
    if (currentThread && Array.isArray(currentThread.messages)) {
      const lastMessage =
        currentThread.messages[currentThread.messages.length - 1];
      if (
        lastMessage &&
        lastMessage.sender === "assistant" &&
        lastMessage.inferenceStats
      ) {
        console.log("Inference stats updated:", lastMessage.inferenceStats);
      }
    }
  }, [chatThreads, currentThreadIndex, getCurrentThread]);

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
                conversations={
                  Array.isArray(chatThreads)
                    ? chatThreads.map((thread) => ({
                        id: thread?.id || "0",
                        title:
                          thread?.title ||
                          `New Chat ${parseInt(thread?.id || "0") + 1}`,
                      }))
                    : [{ id: "0", title: "New Chat 1" }]
                }
                currentConversationId={getCurrentThread()?.id || "0"}
                onSelectConversation={handleSelectConversation}
                onCreateNewConversation={createNewConversation}
                onDeleteConversation={(id) => {
                  setChatThreads((prevThreads) => {
                    if (
                      !Array.isArray(prevThreads) ||
                      prevThreads.length <= 1
                    ) {
                      return [defaultThread];
                    }

                    const newThreads = prevThreads.filter(
                      (thread) => thread.id !== id
                    );

                    if (newThreads.length === 0) {
                      return [defaultThread];
                    }

                    return newThreads;
                  });

                  if (getCurrentThread()?.id === id) {
                    setCurrentThreadIndex(0);
                    setRagDatasource(undefined);
                  }
                }}
                onEditConversationTitle={(id, newTitle) => {
                  if (!newTitle.trim()) return;

                  setChatThreads((prevThreads) => {
                    if (!Array.isArray(prevThreads)) return [defaultThread];

                    return prevThreads.map((thread) =>
                      thread.id === id ? { ...thread, title: newTitle } : thread
                    );
                  });
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
              chatHistory={(() => {
                const currentThread = getCurrentThread();
                return Array.isArray(currentThread?.messages)
                  ? currentThread.messages
                  : [];
              })()}
              logo={logo}
              setTextInput={setTextInput}
              isStreaming={isStreaming}
              onReRender={handleReRender}
              onContinue={handleContinue}
              reRenderingMessageId={reRenderingMessageId}
              ragDatasource={ragDatasource}
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
            files={files}
            setFiles={setFiles}
            isMobileView={screenSize.isMobileView}
            onCreateNewConversation={createNewConversation}
          />
        </div>
      </Card>
    </div>
  );
}
