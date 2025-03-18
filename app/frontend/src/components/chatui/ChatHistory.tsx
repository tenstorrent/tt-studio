// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useRef, useEffect, useState, useCallback } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { ChevronDown } from "lucide-react";
import { Button } from "../ui/button";
import ChatExamples from "./ChatExamples";
import StreamingMessage from "./StreamingMessage";
import MessageActions from "./MessageActions";
import MessageIndicator from "./MessageIndicator";
import { ChatMessage } from "./types";

interface ChatHistoryProps {
  chatHistory: ChatMessage[];
  logo: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  isStreaming: boolean;
  onReRender: (messageId: string) => void;
  onContinue: (messageId: string) => void;
  reRenderingMessageId: string | null;
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
  isMobileView = false,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const messageRefs = useRef<Map<string | number, HTMLDivElement>>(new Map());
  const [screenSize, setScreenSize] = useState({
    isLargeScreen: false,
    isExtraLargeScreen: false,
  });

  const [userHasScrolled, setUserHasScrolled] = useState(false);

  const prevChatHistoryLengthRef = useRef(chatHistory.length);

  const hasScrolledForCurrentStreamRef = useRef(false);

  const shouldShowMessageIndicator = useCallback(() => {
    if (!isStreaming || chatHistory.length === 0) return false;

    const latestMessage = chatHistory[chatHistory.length - 1];
    return latestMessage && latestMessage.sender === "user";
  }, [isStreaming, chatHistory]);

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

  const isAutoScrollingRef = useRef(false);

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
                      <p
                        className={`${
                          isMobileView
                            ? "text-sm text-right"
                            : "text-base text-right"
                        } w-full`}
                      >
                        {message.text}
                      </p>
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
                      />
                    </div>
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
    </div>
  );
};

export default React.memo(ChatHistory);
