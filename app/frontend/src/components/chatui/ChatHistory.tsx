// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useRef, useEffect, useState, useCallback } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { ChevronDown, Database, File, X, Lock } from "lucide-react";
import { Button } from "../ui/button";
import ChatExamples from "./ChatExamples";
import StreamingMessage from "./StreamingMessage";
import MessageActions from "./MessageActions";
import MessageIndicator from "./MessageIndicator";
import FileDisplay from "./FileDisplay";
import type { ChatMessage } from "./types";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";

// --- RagPill component (assuming it's defined elsewhere or identical) ---
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
  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-TT-slate/30 dark:bg-TT-slate/30 text-xs text-black dark:text-gray-300 mb-2">
    <Database size={12} className="text-black dark:text-gray-300" />
    <span>{ragDatasource.name}</span>
    {ragDatasource.metadata?.last_uploaded_document && (
      <span className="text-gray-600 dark:text-gray-400">
        · {ragDatasource.metadata.last_uploaded_document}
      </span>
    )}
  </div>
);

// --- FileViewerDialog component (assuming it's defined elsewhere or identical) ---
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
      /* ... */
    };
  };
  isMobileView?: boolean;
}

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
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const [minimizedFiles, setMinimizedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{
    url: string;
    name: string;
    isImage: boolean;
  } | null>(null);
  const messageRefs = useRef<Map<string | number, HTMLDivElement>>(new Map());
  const [screenSize, setScreenSize] = useState<{
    isLargeScreen: boolean;
    isExtraLargeScreen: boolean;
  }>({ isLargeScreen: false, isExtraLargeScreen: false });

  // --- SCROLL STATE REFS ---
  const userHasScrolledAwayRef = useRef(false);
  const prevChatHistoryLengthRef = useRef(chatHistory.length);
  const isAutoScrollingRef = useRef(false); // Track if scroll is from our code vs user
  const lastScrollTopRef = useRef(0); // Remember last scroll position for better detection
  const isAtBottomRef = useRef(true); // Track if user is at bottom
  const isScrollLockedRef = useRef(false); // Track if scroll is locked to bottom
  const [isScrollLocked, setIsScrollLocked] = useState(false); // For UI updates
  // --- END SCROLL STATE REFS ---

  const shouldShowMessageIndicator = useCallback(() => {
    // Check if streaming AND last message is from user
    return (
      isStreaming &&
      chatHistory.length > 0 &&
      chatHistory[chatHistory.length - 1]?.sender === "user"
    );
  }, [isStreaming, chatHistory]);

  // Screen size effect
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

  // --- SCROLLING FUNCTIONS ---
  const scrollToBottom = useCallback(() => {
    if (viewportRef.current) {
      // Set flag to indicate this is an auto-scroll
      isAutoScrollingRef.current = true;
      // Use scrollHeight to get the total scrollable height
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: "smooth",
      });

      // Reset various scroll tracking states
      userHasScrolledAwayRef.current = false;
      isAtBottomRef.current = true;

      // Clear auto-scroll flag after animation
      setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, 300);
    }
  }, []);

  // --- UPDATED: Scroll Event Handler with Enhanced Detection ---
  const handleScroll = useCallback(() => {
    if (!viewportRef.current || isAutoScrollingRef.current) {
      // Skip scroll handling during programmatic scrolling
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;

    // Detection improvements
    const previousScrollTop = lastScrollTopRef.current;
    const scrollChange = Math.abs(scrollTop - previousScrollTop);

    // Update last scroll position
    lastScrollTopRef.current = scrollTop;

    // Reduce sensitivity threshold to detect smaller scrolls
    const isUserScroll = scrollChange > 0.5;

    // Make threshold larger (50px instead of 30px) for better detection
    const isNearBottom = scrollHeight - scrollTop <= clientHeight + 50;

    // Update bottom status ref
    isAtBottomRef.current = isNearBottom;

    // IMPORTANT: Always update scroll button visibility when not at bottom
    // AND when there's actually enough content to scroll
    const isContentScrollable = scrollHeight > clientHeight + 10;
    const shouldShowButton = isContentScrollable && !isNearBottom;

    // Force update button visibility
    if (shouldShowButton !== isScrollButtonVisible) {
      setIsScrollButtonVisible(shouldShowButton);
    }

    // If user is manually scrolling up (away from bottom), unlock scroll
    if (isUserScroll && !isNearBottom) {
      // Only trigger state update if there's an actual change
      if (isScrollLockedRef.current) {
        isScrollLockedRef.current = false;
        setIsScrollLocked(false);
      }
      userHasScrolledAwayRef.current = true;
    }
  }, [isScrollButtonVisible]);

  // Attach scroll listener
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.addEventListener("scroll", handleScroll, { passive: true });
      return () => viewport.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  // NEW EFFECT: Check content length on chat history changes
  useEffect(() => {
    // Force check if content is scrollable when chat history changes
    if (viewportRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
      const isNearBottom = scrollHeight - scrollTop <= clientHeight + 50;
      const isContentScrollable = scrollHeight > clientHeight + 10;

      // Set button visibility if content is scrollable and not at bottom
      const shouldShowButton = isContentScrollable && !isNearBottom;
      if (shouldShowButton !== isScrollButtonVisible) {
        setIsScrollButtonVisible(shouldShowButton);
      }
    }
  }, [chatHistory, isScrollButtonVisible]);

  // Handle Auto-Scrolling for New Messages
  useEffect(() => {
    const currentLength = chatHistory.length;
    const previousLength = prevChatHistoryLengthRef.current;

    // Only update the history length reference
    prevChatHistoryLengthRef.current = currentLength;

    // Only process if there's a new message
    if (currentLength > previousLength && viewportRef.current) {
      const newMessage = chatHistory[currentLength - 1];

      // Schedule scroll logic after the next paint
      requestAnimationFrame(() => {
        if (!viewportRef.current) return;

        // Always scroll to bottom for user messages
        if (newMessage.sender === "user") {
          scrollToBottom();
          userHasScrolledAwayRef.current = false;
        }
        // For assistant messages, only scroll if locked or at bottom
        else if (newMessage.sender === "assistant") {
          if (isScrollLockedRef.current || isAtBottomRef.current) {
            scrollToBottom();
          } else {
            // Show the scroll button when new assistant messages arrive
            setIsScrollButtonVisible(true);
          }
        }
      });
    }
  }, [chatHistory, scrollToBottom]);

  // Streaming auto-scroll behavior
  useEffect(() => {
    if (!isStreaming || !viewportRef.current) return;

    // Only auto-scroll when streaming if we're locked or at bottom
    let animationFrameId: number;

    const autoScrollIfLocked = () => {
      if (!viewportRef.current) return;

      // Check if we should auto-scroll
      if (isScrollLockedRef.current) {
        // Lock is enabled, force scroll to bottom
        isAutoScrollingRef.current = true;
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
        setTimeout(() => {
          isAutoScrollingRef.current = false;
        }, 10);
      }

      // Continue the loop
      animationFrameId = requestAnimationFrame(autoScrollIfLocked);
    };

    // Start the loop if scroll is locked
    if (isScrollLockedRef.current) {
      animationFrameId = requestAnimationFrame(autoScrollIfLocked);
    }

    // Clean up the animation frame
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isStreaming]);

  // Other callbacks
  const toggleMinimizeFile = useCallback((fileId: string) => {
    setMinimizedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) newSet.delete(fileId);
      else newSet.add(fileId);
      return newSet;
    });
  }, []);

  const handleFileClick = useCallback((fileUrl: string, fileName: string) => {
    const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp", "svg"];
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    const isImage =
      imageExtensions.includes(extension) || fileUrl.startsWith("data:image/");
    setSelectedFile({ url: fileUrl, name: fileName, isImage });
  }, []);

  // Responsive helpers
  const getContainerWidth = () => {
    if (isMobileView) return "w-full";
    if (screenSize.isExtraLargeScreen) return "max-w-[97%] w-full"; // Wider container
    if (screenSize.isLargeScreen) return "max-w-[97%] w-full"; // Wider container
    return "max-w-[97%] w-full"; // Wider container
  };

  const getBubbleMaxWidth = () => {
    if (isMobileView) return "max-w-[95vw]"; // Increased from "max-w-[85vw]"
    if (screenSize.isExtraLargeScreen) return "max-w-[95%]"; // Increased from "max-w-[90%]"
    if (screenSize.isLargeScreen) return "max-w-[95%]"; // Increased from "max-w-[90%]"
    return "max-w-full"; // Increased from "max-w-[95%]"
  };

  return (
    <div
      className={`flex flex-col w-full flex-grow ${isMobileView ? "pt-4" : "pt-4 pb-2"} relative overflow-hidden`}
    >
      {chatHistory.length === 0 && !isStreaming ? (
        <ChatExamples
          logo={logo}
          setTextInput={setTextInput}
          isMobileView={isMobileView}
        />
      ) : (
        <ScrollArea.Root
          className={`relative flex flex-col flex-grow ${
            isMobileView ? "h-full touch-pan-y" : ""
          }`}
        >
          {/* VIEWPORT */}
          <ScrollArea.Viewport
            ref={viewportRef}
            className={`h-full w-full outline-none ${
              isMobileView ? "-webkit-overflow-scrolling-touch" : ""
            }`}
            onScroll={handleScroll}
          >
            {/* INNER CONTAINER - ADJUSTED PADDING WITH WIDER WIDTH */}
            <div
              className={`p-2 sm:p-3 border border-gray-700 rounded-lg ${isMobileView ? "mx-0 border-x-0 rounded-none" : "mx-0"} ${getContainerWidth()}`}
            >
              {/* CHAT MESSAGES */}
              {chatHistory.map((message, index) => (
                <div
                  key={message.id || index}
                  ref={(el) => {
                    if (el) messageRefs.current.set(message.id || index, el);
                    else messageRefs.current.delete(message.id || index);
                  }}
                  className={`mb-3 sm:mb-4 flex flex-col ${message.sender === "user" ? "items-end" : "items-start"}`}
                >
                  {/* Bubble */}
                  <div
                    className={`chat-bubble ${
                      message.sender === "user"
                      ? "bg-TT-green-accent text-white"
                      : "bg-TT-purple-accent text-white"
                    } p-4 rounded-2xl mb-1 ${
                      isMobileView ? "text-[15px]" : "text-[15px]"
                    } ${getBubbleMaxWidth()} break-words overflow-hidden shadow-sm leading-relaxed`}
                  >
                    {message.sender === "assistant" && (
                      <>
                        {reRenderingMessageId === message.id && (
                          <div className="text-yellow-300 font-bold mb-1 sm:mb-2 flex items-center text-xs sm:text-sm">
                            <span className="mr-1 sm:mr-2">Re-rendering</span>
                            <svg
                              className="animate-spin"
                              /* ... re-render icon ... */
                            />
                          </div>
                        )}
                        <div className="w-full text-left">
                          <StreamingMessage
                            content={message.text}
                            isStreamFinished={
                              !isStreaming || // If global streaming stopped
                              reRenderingMessageId === message.id || // If this specific message is being re-rendered
                              index < chatHistory.length - 1 // If it's not the absolute last message
                            }
                            isStopped={message.isStopped}
                          />
                        </div>
                      </>
                    )}
                    {message.sender === "user" && (
                      <div className="flex flex-col gap-1">
                        {message.text && (
                          <p className="text-white whitespace-pre-wrap break-words">
                            {message.text.split(/(\s+)/).map((segment, i) => {
                              // Split by space, keeping spaces
                              const isUrl = /^(https?:\/\/|www\.)\S+/i.test(
                                segment
                              );
                              if (isUrl) {
                                const cleanUrl = segment.replace(
                                  /[.,!?;:]$/,
                                  ""
                                );
                                const punctuation = segment.slice(
                                  cleanUrl.length
                                );
                                return (
                                  <React.Fragment key={i}>
                                    <a
                                      href={
                                        cleanUrl.startsWith("www.")
                                          ? `https://${cleanUrl}`
                                          : cleanUrl
                                      }
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-300 hover:text-blue-200 underline break-all"
                                    >
                                      {cleanUrl}
                                    </a>
                                    {punctuation}
                                  </React.Fragment>
                                );
                              } else {
                                return <span key={i}>{segment}</span>; // Render spaces/words
                              }
                            })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Actions & RAG Pill */}
                  {message.sender === "assistant" && (
                    <div className="mt-1 text-xs">
                      <MessageActions
                        messageId={message.id || ""}
                        onReRender={onReRender}
                        onContinue={onContinue}
                        isReRendering={reRenderingMessageId === message.id}
                        isStreaming={
                          isStreaming &&
                          index === chatHistory.length - 1 &&
                          reRenderingMessageId !== message.id
                        }
                        inferenceStats={message.inferenceStats}
                        messageContent={message.text}
                      />
                    </div>
                  )}
                  {/* RAG Pill for User message (assuming it might apply) */}
                  {message.ragDatasource && (
                    <div className="mt-1">
                      <RagPill ragDatasource={message.ragDatasource} />
                    </div>
                  )}
                  {/* Files for both User and Assistant messages */}
                  {message.files && message.files.length > 0 && (
                    <div className="mt-2">
                      <FileDisplay
                        files={message.files}
                        minimizedFiles={minimizedFiles}
                        toggleMinimizeFile={toggleMinimizeFile}
                        onFileClick={handleFileClick}
                      />
                    </div>
                  )}
                </div>
              ))}
              {/* Streaming Indicator */}
              {shouldShowMessageIndicator() && (
                <div className={`mb-3 sm:mb-4 flex flex-col items-start`}>
                  <div
                    className={`chat-bubble bg-TT-slate text-white p-2 sm:p-3 rounded-lg mb-1 ${
                      isMobileView ? "text-sm" : "text-base"
                    } ${getBubbleMaxWidth()} break-words overflow-hidden shadow-sm`}
                  >
                    <div className="w-full text-left">
                      <MessageIndicator isMobileView={isMobileView} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea.Viewport>

          {/* SCROLLBAR - Hide in mobile view */}
          {!isMobileView && (
            <ScrollArea.Scrollbar
              orientation="vertical"
              className="flex select-none touch-none p-0.5 bg-transparent transition-colors duration-160 ease-out data-[orientation=vertical]:w-2.5 hover:bg-black/10"
            >
              <ScrollArea.Thumb className="flex-1 bg-gray-500 dark:bg-gray-600 rounded-[10px] relative before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:w-full before:h-full before:min-w-[44px] before:min-h-[44px]" />
            </ScrollArea.Scrollbar>
          )}
        </ScrollArea.Root>
      )}

      {/* Scroll button */}
      {isScrollButtonVisible && (
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                onClick={scrollToBottom}
                className="fixed bottom-24 right-8 h-10 w-10 rounded-full bg-primary shadow-lg hover:bg-primary/90 transition-all duration-200 z-50"
                size="icon"
              >
                <ChevronDown className="h-5 w-5 text-white" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md rounded-md animate-in fade-in-0 zoom-in-95 z-50"
                side="left"
                sideOffset={5}
              >
                New messages below
                <Tooltip.Arrow className="fill-popover" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      )}

      {/* FILE VIEWER DIALOG */}
      <FileViewerDialog
        file={selectedFile}
        onClose={() => setSelectedFile(null)}
      />
    </div>
  );
};

// Added React.memo for potential performance optimization if props don't change often
export default React.memo(ChatHistory);

