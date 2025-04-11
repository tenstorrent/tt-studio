// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
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
  // Show loading state on initial load
  const [isLoading, setIsLoading] = useState(true);
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

  // Add refs and state for swipe gesture
  const touchStartXRef = useRef<number | null>(null);
  const touchStartTimeRef = useRef<number | null>(null);
  const [touchMoveX, setTouchMoveX] = useState<number | null>(null);
  const [leftSwipeX, setLeftSwipeX] = useState<number | null>(null);
  const swipeAreaRef = useRef<HTMLDivElement>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  const [isHandleTouched, setIsHandleTouched] = useState(false);

  // Show initial loading effect when component mounts
  useEffect(() => {
    // Start with loading state
    setIsLoading(true);

    // Clear loading after a short delay to show the animation
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

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
      const wasMobile = screenSize.isMobileView;
      const isMobileNow = width < 768;

      // Show loading state when transitioning between mobile and desktop views
      if (wasMobile !== isMobileNow) {
        setIsLoading(true);
        // Clear loading after a short delay
        setTimeout(() => setIsLoading(false), 300);
      }

      setScreenSize({
        isMobileView: isMobileNow,
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
  }, [screenSize.isMobileView]);

  // Set up swipe gesture handlers
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      if (!screenSize.isMobileView) return;

      // Store initial touch position
      touchStartXRef.current = e.touches[0].clientX;
      touchStartTimeRef.current = Date.now();

      // Reset swipe states
      setTouchMoveX(null);
      setLeftSwipeX(null);

      // Set touch state
      setIsHandleTouched(true);

      // Only prevent default for touches near edges
      if (
        (e.touches[0].clientX < 20 ||
          (isHistoryPanelOpen &&
            e.touches[0].clientX > window.innerWidth - 20)) &&
        e.cancelable
      ) {
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!screenSize.isMobileView || touchStartXRef.current === null) return;

      const currentX = e.touches[0].clientX;
      const deltaX = currentX - touchStartXRef.current;

      // For right swipe to open panel
      if (deltaX > 10 && !isHistoryPanelOpen) {
        setTouchMoveX(deltaX);

        if (touchStartXRef.current < 20 && e.cancelable) {
          e.preventDefault();
        }
      }

      // For left swipe to close panel
      if (deltaX < -10 && isHistoryPanelOpen && screenSize.isMobileView) {
        setLeftSwipeX(deltaX);

        if (e.cancelable) {
          e.preventDefault();
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (
        !screenSize.isMobileView ||
        touchStartXRef.current === null ||
        touchStartTimeRef.current === null
      )
        return;

      const touchEndX = e.changedTouches[0].clientX;
      const deltaX = touchEndX - touchStartXRef.current;
      const deltaTime = Date.now() - touchStartTimeRef.current;

      // Open panel on right swipe
      if (
        (deltaX > 70 || (deltaX > 40 && deltaTime < 250)) &&
        !isHistoryPanelOpen
      ) {
        setIsHistoryPanelOpen(true);
      }

      // Close panel on left swipe
      if (
        (deltaX < -70 || (deltaX < -40 && deltaTime < 250)) &&
        isHistoryPanelOpen &&
        screenSize.isMobileView
      ) {
        setIsHistoryPanelOpen(false);
      }

      // Reset touch tracking
      touchStartXRef.current = null;
      touchStartTimeRef.current = null;
      setTouchMoveX(null);
      setLeftSwipeX(null);
      setIsHandleTouched(false);
    };

    // Add touch events to elements
    const swipeArea = swipeAreaRef.current;
    const historyPanel = historyPanelRef.current;

    if (swipeArea) {
      swipeArea.addEventListener("touchstart", handleTouchStart, {
        passive: false,
      });
      swipeArea.addEventListener("touchmove", handleTouchMove, {
        passive: false,
      });
      swipeArea.addEventListener("touchend", handleTouchEnd);
    }

    // Add touch events to history panel for left swipe to close
    if (historyPanel && isHistoryPanelOpen && screenSize.isMobileView) {
      historyPanel.addEventListener("touchstart", handleTouchStart, {
        passive: false,
      });
      historyPanel.addEventListener("touchmove", handleTouchMove, {
        passive: false,
      });
      historyPanel.addEventListener("touchend", handleTouchEnd);
    }

    return () => {
      if (swipeArea) {
        swipeArea.removeEventListener("touchstart", handleTouchStart);
        swipeArea.removeEventListener("touchmove", handleTouchMove);
        swipeArea.removeEventListener("touchend", handleTouchEnd);
      }

      if (historyPanel) {
        historyPanel.removeEventListener("touchstart", handleTouchStart);
        historyPanel.removeEventListener("touchmove", handleTouchMove);
        historyPanel.removeEventListener("touchend", handleTouchEnd);
      }
    };
  }, [screenSize.isMobileView, isHistoryPanelOpen]);

  // Auto-scroll chat container
  useEffect(() => {
    // Only auto-scroll when switching between threads
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [currentThreadIndex]); // Remove chatThreads from dependency array

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

      // console.log("Running inference with request:", inferenceRequest);
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
            if (!Array.isArray(prevThreads)) return [defaultThread];

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
        // console.log("Inference stats updated:", lastMessage.inferenceStats);
      }
    }
  }, [chatThreads, currentThreadIndex, getCurrentThread]);

  // Transform Model[] to the format expected by Header component
  const headerModelsDeployed = modelsDeployed.map((model) => ({
    id: model.containerID || model.id || "", // Use containerID from Model type or fall back to id
    name: model.modelName || model.name || "", // Use modelName from Model type or fall back to name
  }));

  // Show skeleton loader while loading - AFTER all hooks are defined
  if (isLoading) {
    return (
      <div className="flex flex-col h-screen w-full p-4 space-y-4">
        <Skeleton className="h-16 w-full rounded-lg" /> {/* Header */}
        <div className="flex-grow space-y-4 overflow-hidden">
          <Skeleton className="h-24 w-3/4 rounded-lg" /> {/* Message */}
          <Skeleton className="h-24 w-3/4 ml-auto rounded-lg" />
          <Skeleton className="h-24 w-3/4 rounded-lg" /> {/* Message */}
        </div>
        <Skeleton className="h-16 w-full rounded-lg" /> {/* Input area */}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full max-w-full mx-auto h-screen overflow-hidden p-2 sm:p-4 md:p-6">
      <Card className="flex flex-row w-full h-full overflow-hidden min-w-0 relative">
        {/* Improved mobile handle with translucent styling */}
        {screenSize.isMobileView && !isHistoryPanelOpen && (
          <div
            ref={swipeAreaRef}
            className="fixed top-0 left-0 h-full w-12 z-50 flex items-center justify-start pointer-events-auto"
            style={{ touchAction: "pan-y" }} // Allow vertical scrolling but capture horizontal swipes
            onClick={toggleHistoryPanel}
            onTouchStart={() => setIsHandleTouched(true)}
            onTouchEnd={() => setIsHandleTouched(false)}
            onTouchCancel={() => setIsHandleTouched(false)}
          >
            <div
              className={`h-48 w-8 rounded-r-lg flex items-center justify-center transition-all duration-200 
                ${
                  isHandleTouched || touchMoveX !== null
                    ? "bg-white/90 dark:bg-[#2A2A2A]/90 shadow-md border-r border-t border-b border-gray-200 dark:border-gray-700"
                    : "bg-white/30 dark:bg-[#2A2A2A]/30 border-r border-t border-b border-gray-200/30 dark:border-gray-700/30"
                }`}
            >
              <svg
                className={`w-5 h-5 transition-opacity duration-200
                  ${
                    isHandleTouched || touchMoveX !== null
                      ? "text-gray-600 dark:text-gray-400 opacity-100"
                      : "text-gray-600/60 dark:text-gray-400/60 opacity-60"
                  }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Swipe indicator with improved feedback */}
        {touchMoveX !== null && !isHistoryPanelOpen && (
          <div
            className="fixed top-0 left-0 h-full bg-gray-800 z-40 opacity-70"
            style={{
              width: `${Math.min(touchMoveX, window.innerWidth * 0.7)}px`,
              borderRight: "2px solid rgba(255,255,255,0.4)",
              boxShadow: "0 0 15px rgba(0,0,0,0.3)",
              transition: "width 0.05s ease",
            }}
          >
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Left swipe indicator for closing panel */}
        {leftSwipeX !== null &&
          isHistoryPanelOpen &&
          screenSize.isMobileView && (
            <div
              className="fixed top-0 right-0 h-full bg-red-800 z-60 opacity-70"
              style={{
                width: `${Math.min(Math.abs(leftSwipeX), window.innerWidth * 0.3)}px`,
                borderLeft: "2px solid rgba(255,255,255,0.4)",
                boxShadow: "0 0 15px rgba(0,0,0,0.3)",
                transition: "width 0.05s ease",
              }}
            >
              <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </div>
            </div>
          )}

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
              ref={historyPanelRef}
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
              className={`h-full overflow-hidden 
        p-4 bg-white dark:bg-black
        ${
          screenSize.isMobileView
            ? "fixed top-0 left-0 w-[90%] max-w-sm z-50 shadow-xl rounded-r-lg"
            : "relative flex-shrink-0"
        }`}
            >
              <HistoryPanel
                isLoading={isLoading}
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
          className={`flex flex-col flex-grow min-w-0 ${
            screenSize.isMobileView ? "h-[100dvh] fixed inset-0" : "p-2 sm:p-4"
          } ${getContentMaxWidth()} overflow-hidden`}
        >
          <div
            className={`${screenSize.isMobileView ? "sticky top-0 z-10 bg-background" : ""}`}
          >
            <Header
              modelName={modelName}
              modelsDeployed={headerModelsDeployed}
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
          </div>
          <div
            ref={chatContainerRef}
            className={`flex-grow overflow-y-auto ${
              screenSize.isMobileView
                ? "px-1 pb-[140px] pt-2" // Increased bottom padding for better scrolling
                : "px-1 sm:px-2 md:px-4"
            }`}
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
          <div
            className={`${
              screenSize.isMobileView
                ? "fixed bottom-0 left-0 right-0 bg-background border-t border-gray-200 dark:border-gray-800 shadow-lg px-2 pb-safe"
                : ""
            }`}
            style={{
              paddingBottom: screenSize.isMobileView
                ? "env(safe-area-inset-bottom, 16px)"
                : undefined,
            }}
          >
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
        </div>
      </Card>
    </div>
  );
}
