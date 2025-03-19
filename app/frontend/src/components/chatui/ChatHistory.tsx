// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useRef, useEffect, useState, useCallback } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { User, ChevronDown, Bot, X, Database, File } from "lucide-react";
import { User, ChevronDown, Bot, X, Database, File } from "lucide-react";
import { Button } from "../ui/button";
import ChatExamples from "./ChatExamples";
import StreamingMessage from "./StreamingMessage";
import MessageActions from "./MessageActions";
import MessageIndicator from "./MessageIndicator";
import FileDisplay from "./FileDisplay";
import type { ChatMessage } from "./types";
import * as Dialog from "@radix-ui/react-dialog";

interface ChatHistoryProps {
  chatHistory: ChatMessage[];
  logo: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  isStreaming: boolean;
  onReRender: (messageId: string) => void;
  onContinue: (messageId: string) => void;
  reRenderingMessageId: string | null;
  ragDatasource?: {
    id: string;
    name: string;
    metadata?: {
      created_at?: string;
      embedding_func_name?: string;
      last_uploaded_document?: string;
    };
  };
  isMobileView?: boolean;
}

const RagPill: React.FC<{
  ragDatasource: {
    id: string;
    name: string;
    metadata?: {
      created_at?: string;
      embedding_func_name?: string;
      last_uploaded_document?: string;
    };
  };
}> = ({ ragDatasource }) => (
  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-TT-slate/30 text-xs text-gray-300 mb-2">
    <Database size={12} />
    <span>{ragDatasource.name}</span>
    {ragDatasource.metadata?.last_uploaded_document && (
      <span className="text-gray-400">
        · {ragDatasource.metadata.last_uploaded_document}
      </span>
    )}
  </div>
);

interface FileViewerDialogProps {
  file: { url: string; name: string; isImage: boolean } | null;
  onClose: () => void;
}

const FileViewerDialog: React.FC<FileViewerDialogProps> = ({
  file,
  onClose,
}) => {
  if (!file) return null;

  return (
    <Dialog.Root open={!!file} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gray-900 rounded-lg p-4 max-w-3xl max-h-[90vh] w-[90vw] overflow-auto z-50">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-white truncate max-w-[80%]">
              {file.name}
            </h3>
            <Dialog.Close asChild>
              <button className="text-gray-400 hover:text-white">
                <X className="h-6 w-6" />
              </button>
            </Dialog.Close>
          </div>

          {file.isImage ? (
            <img
              src={file.url}
              alt={file.name}
              className="w-full h-auto max-h-[70vh] object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 bg-gray-800 rounded-lg">
              <File className="h-16 w-16 text-gray-400 mb-4" />
              <p className="text-gray-300">Preview not available</p>
              <a
                href={file.url}
                download={file.name}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Download File
              </a>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const ChatHistory: React.FC<ChatHistoryProps> = ({
  chatHistory = [],
  logo,
  setTextInput,
  isStreaming,
  onReRender,
  onContinue,
  reRenderingMessageId,
  ragDatasource,
  isMobileView = false,
}) => {
  // console.log("ChatHistory component rendered", ragDatasource);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const [minimizedFiles, setMinimizedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{
    url: string;
    name: string;
    isImage: boolean;
  } | null>(null);
  const messageRefs = useRef<Map<string | number, HTMLDivElement>>(new Map());
  const [screenSize, setScreenSize] = useState({
    isLargeScreen: false,
    isExtraLargeScreen: false,
  });
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const prevChatHistoryLengthRef = useRef(chatHistory.length);
  const hasScrolledForCurrentStreamRef = useRef(false);
  const isAutoScrollingRef = useRef(false);

  const shouldShowMessageIndicator = useCallback(() => {
    if (!isStreaming || chatHistory.length === 0) return false;

    const latestMessage = chatHistory[chatHistory.length - 1];
    return latestMessage && latestMessage.sender === "user";
  }, [isStreaming, chatHistory]);

  // Check screen size on component mount and resize
  useEffect(() => {
    const checkScreenSize = () => {
      const width = window.innerWidth;
      setScreenSize({
        isLargeScreen: width >= 1280,
        isExtraLargeScreen: width >= 1600,
      });
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  const scrollToBottom = useCallback(() => {
    if (viewportRef.current) {
      // Mark this as an auto-scroll to prevent it from being detected as user scrolling
      isAutoScrollingRef.current = true;
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (viewportRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
      const isAtBottom = scrollHeight - scrollTop <= clientHeight + 100;

      setIsScrollButtonVisible(!isAtBottom);

      if (isStreaming) {
        setUserHasScrolled(true);
        hasScrolledForCurrentStreamRef.current = true;
      } else if (!isAtBottom && !isAutoScrollingRef.current) {
        setUserHasScrolled(true);
      }

      if (isAutoScrollingRef.current) {
        setTimeout(() => {
          isAutoScrollingRef.current = false;
        }, 50);
      }
    }
  }, [isStreaming]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.addEventListener("scroll", handleScroll);
      return () => viewport.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  const scrollMessageToTop = useCallback((messageId: string | number) => {
    const messageElement = messageRefs.current.get(messageId);
    if (messageElement && viewportRef.current) {
      isAutoScrollingRef.current = true;

      const messageTopPosition = messageElement.offsetTop;
      const scrollPosition = Math.max(0, messageTopPosition - 16);

      viewportRef.current.scrollTo({
        top: scrollPosition,
        behavior: "auto", // Use immediate scrolling
      });
    }
  }, []);

  // Handle new messages being added
  useEffect(() => {
    if (chatHistory.length > prevChatHistoryLengthRef.current) {
      const newMessage = chatHistory[chatHistory.length - 1];
      const newMessageId = newMessage.id || chatHistory.length - 1;

      if (newMessage.sender === "user") {
        setUserHasScrolled(false);

        setTimeout(() => {
          scrollMessageToTop(newMessageId);

          setTimeout(() => {
            scrollMessageToTop(newMessageId);
          }, 100);
        }, 10);
      } else if (newMessage.sender === "assistant" && !userHasScrolled) {
        scrollToBottom();
      }
    }

    prevChatHistoryLengthRef.current = chatHistory.length;
  }, [chatHistory, scrollMessageToTop, scrollToBottom, userHasScrolled]);

  // Handle streaming state changes
  const prevStreamingStateRef = useRef(isStreaming);

  useEffect(() => {
    const latestMessage = chatHistory[chatHistory.length - 1] || {};
    const streamingJustStarted = isStreaming && !prevStreamingStateRef.current;
    const streamingJustEnded = !isStreaming && prevStreamingStateRef.current;

    if (streamingJustStarted && latestMessage.sender === "assistant") {
      if (!userHasScrolled) {
        setTimeout(() => {
          scrollToBottom();
        }, 100);
      }
    }

    if (streamingJustEnded && chatHistory.length > 0) {
      if (!userHasScrolled && latestMessage.sender === "assistant") {
        scrollToBottom();
      }
    }

    prevStreamingStateRef.current = isStreaming;
  }, [isStreaming, chatHistory, scrollToBottom, userHasScrolled]);

  const toggleMinimizeFile = useCallback((fileId: string) => {
    setMinimizedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  }, []);

  const handleFileClick = useCallback((fileUrl: string, fileName: string) => {
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "svg"];
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    const isImage =
      imageExtensions.includes(extension) || fileUrl.startsWith("data:image/");

    setSelectedFile({
      url: fileUrl,
      name: fileName,
      isImage,
    });
  }, []);

  // Responsive layout helpers
  const getContainerWidth = () => {
    if (screenSize.isExtraLargeScreen) return "max-w-[100%] w-full";
    if (screenSize.isLargeScreen) return "max-w-[100%] w-full";
    if (!isMobileView) return "max-w-[95%] w-full";
    return "w-full";
  };

  const getBubbleMaxWidth = () => {
    if (isMobileView) return "max-w-[85vw]";
    if (screenSize.isExtraLargeScreen) return "max-w-[90%]";
    if (screenSize.isLargeScreen) return "max-w-[90%]";
    return "max-w-[95%]";
  };

  return (
    <div
      className={`flex flex-col w-full flex-grow ${
        isMobileView ? "pt-4" : "p-2 md:p-2 lg:p-8"
      } font-rmMono relative overflow-hidden`}
    >
      {chatHistory.length === 0 ? (
        <ChatExamples
          logo={logo}
          setTextInput={setTextInput}
          isMobileView={isMobileView}
        />
      ) : (
        <ScrollArea.Root className="flex-grow h-full overflow-hidden">
          <ScrollArea.Viewport
            ref={viewportRef}
            className="w-full h-full pr-1 sm:pr-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-transparent hover:scrollbar-thumb-gray-500"
            onScroll={handleScroll}
          >
            <div
              className={`p-2 sm:p-4 border rounded-lg ${
                isMobileView ? "mx-0" : "mx-auto"
              } ${getContainerWidth()} max-w-screen-xl`}
            >
              {chatHistory.map((message, index) => (
                <div
                  key={message.id || index}
                  ref={(el) => {
                    if (el) {
                      messageRefs.current.set(message.id || index, el);
                    }
                  }}
                  className={`mb-4 sm:mb-5 flex flex-col ${
                    message.sender === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div className="chat-image avatar text-left">
                    <div className="w-10 rounded-full">
                      {message.sender === "user" ? (
                        <User
                          className={`${isMobileView ? "h-5 w-5" : "h-6 w-6"} mr-2 text-left`}
                        />
                      ) : (
                        <Bot
                          className={`${isMobileView ? "h-6 w-6" : "w-8 h-8"} rounded-full mr-2`}
                        />
                      )}
                    </div>
                  </div>
                  <div
                    className={`chat-bubble ${
                      message.sender === "user"
                        ? "bg-TT-green-accent text-white"
                        : "bg-TT-slate text-white"
                    } p-2 sm:p-3 rounded-lg mb-1 ${
                      isMobileView ? "text-sm" : "text-base"
                    } 
                        ${getBubbleMaxWidth()} break-words overflow-hidden`}
                  >
                    {message.sender === "assistant" && (
                      <>
                        {reRenderingMessageId === message.id && (
                          <div className="text-yellow-300 font-bold mb-1 sm:mb-2 flex items-center text-xs sm:text-sm">
                            <span className="mr-1 sm:mr-2">Re-rendering</span>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width={isMobileView ? "12" : "16"}
                              height={isMobileView ? "12" : "16"}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="animate-spin"
                            >
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                          </div>
                        )}
                        <div className="w-full text-left">
                          <StreamingMessage
                            content={message.text}
                            isStreamFinished={
                              !isStreaming ||
                              (reRenderingMessageId !== message.id &&
                                index !== chatHistory.length - 1)
                            }
                          />
                        </div>
                      </>
                    )}
                    {message.sender === "user" && (
                      <div className="flex flex-col gap-4">
                        {message.text && (
                          <div
                            className={`bg-TT-green-accent/20 p-2 rounded ${isMobileView ? "text-sm" : "text-base"}`}
                          >
                            <p className="text-white">
                              {message.text.split(" ").map((word, i) => {
                                const isUrl = word.startsWith("http");
                                return isUrl ? (
                                  <span
                                    key={i}
                                    className="text-blue-300 underline"
                                  >
                                    <a
                                      href={word}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {word}
                                    </a>{" "}
                                  </span>
                                ) : (
                                  <span key={i}>{word} </span>
                                );
                              })}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {message.sender === "assistant" && (
                    <div className="-mt-1">
                      <MessageActions
                        messageId={message.id || ""}
                        onReRender={onReRender}
                        onContinue={onContinue}
                        isReRendering={reRenderingMessageId === message.id}
                        isStreaming={isStreaming}
                        inferenceStats={message.inferenceStats}
                        messageContent={message.text}
                      />
                    </div>
                  )}
                  {message.ragDatasource && (
                    <RagPill ragDatasource={message.ragDatasource} />
                  )}
                  {message.files && message.files.length > 0 && (
                    <FileDisplay
                      files={message.files}
                      minimizedFiles={minimizedFiles}
                      toggleMinimizeFile={toggleMinimizeFile}
                      onFileClick={handleFileClick}
                    />
                  )}
                </div>
              ))}
              {shouldShowMessageIndicator() && (
                <div className={`mb-4 sm:mb-5 flex flex-col items-start`}>
                  <div
                    className={`chat-bubble bg-TT-slate text-white p-2 sm:p-3 rounded-lg mb-1 ${
                      isMobileView ? "text-sm" : "text-base"
                    } ${getBubbleMaxWidth()} break-words overflow-hidden`}
                  >
                    <div className="w-full text-left">
                      <MessageIndicator isMobileView={isMobileView} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            orientation="vertical"
            className="w-1 sm:w-2 bg-transparent transition-colors duration-150 ease-out hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ScrollArea.Thumb className="bg-gray-300 rounded-full w-full transition-colors duration-150 ease-out hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      )}
      {isScrollButtonVisible && (
        <Button
          className={`absolute ${
            isMobileView
              ? "bottom-2 right-2 h-8 w-8"
              : "bottom-4 right-4 h-10 w-10"
          } 
            rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 p-0 z-10`}
          onClick={() => {
            scrollToBottom();
            setIsScrollButtonVisible(false);
            setUserHasScrolled(false);
          }}
        >
          <ChevronDown className={`${isMobileView ? "h-4 w-4" : "h-6 w-6"}`} />
        </Button>
      )}

      <FileViewerDialog
        file={selectedFile}
        onClose={() => setSelectedFile(null)}
      />
    </div>
  );
};

export default React.memo(ChatHistory);
