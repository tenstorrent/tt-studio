// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useRef, useEffect, useState, useCallback } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { User, ChevronDown} from "lucide-react";
import { Button } from "../ui/button";
import InferenceStats from "./InferenceStats";
import ChatExamples from "./ChatExamples";
import StreamingMessage from "./StreamingMessage";
import MessageActions from "./MessageActions";

interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  inferenceStats?: InferenceStats;
}

interface InferenceStats {
  user_ttft_ms: number;
  user_tps: number;
  user_ttft_e2e_ms: number;
  prefill: {
    tokens_prefilled: number;
    tps: number;
  };
  decode: {
    tokens_decoded: number;
    tps: number;
  };
  batch_size: number;
  context_length: number;
}

interface ChatHistoryProps {
  chatHistory: ChatMessage[];
  logo: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  isStreaming: boolean;
  onReRender: (messageId: string) => void;
  onContinue: (messageId: string) => void;
  reRenderingMessageId: string | null;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  chatHistory = [],
  logo,
  setTextInput,
  isStreaming,
  onReRender,
  onContinue,
  reRenderingMessageId,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (viewportRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
      const isAtBottom = scrollHeight - scrollTop <= clientHeight + 1;
      setIsScrollButtonVisible(!isAtBottom);
    }
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.addEventListener("scroll", handleScroll);
      return () => viewport.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  useEffect(() => {
    if (!isStreaming) {
      const viewport = viewportRef.current;
      if (viewport) {
        const { scrollTop, scrollHeight, clientHeight } = viewport;
        const isAtBottom = scrollHeight - scrollTop <= clientHeight + 1;
        if (isAtBottom) {
          scrollToBottom();
        }
        setIsScrollButtonVisible(!isAtBottom);
      }
    }
  }, [chatHistory, isStreaming, scrollToBottom]);

  return (
    <div className="flex flex-col w-full flex-grow p-8 font-rmMono relative overflow-hidden">
      {chatHistory.length === 0 ? (
        <ChatExamples logo={logo} setTextInput={setTextInput} />
      ) : (
        <ScrollArea.Root className="flex-grow h-full overflow-hidden">
          <ScrollArea.Viewport
            ref={viewportRef}
            className="w-full h-full pr-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-transparent hover:scrollbar-thumb-gray-500"
            onScroll={handleScroll}
          >
            <div className="p-4 border rounded-lg">
              {chatHistory.map((message, index) => (
                <div
                  key={message.id}
                  ref={index === chatHistory.length - 1 ? lastMessageRef : null}
                  className={`chat ${message.sender === "user" ? "chat-end" : "chat-start"} mb-4`}
                >
                  <div className="chat-image avatar text-left">
                    <div className="w-10 rounded-full">
                      {message.sender === "user" ? (
                        <User className="h-6 w-6 mr-2 text-left" />
                      ) : (
                        <img
                          src={logo}
                          alt="Assistant Logo"
                          className="w-8 h-8 rounded-full mr-2"
                        />
                      )}
                    </div>
                  </div>
                  <div
                    className={`chat-bubble ${
                      message.sender === "user"
                        ? "bg-TT-green-accent text-white text-left"
                        : "bg-TT-slate text-white text-left"
                    } p-3 rounded-lg mb-1`}
                  >
                    {message.sender === "assistant" &&
                      reRenderingMessageId === message.id && (
                        <div className="text-yellow-300 font-bold mb-2 flex items-center">
                          <span className="mr-2">1</span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
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
                          <span className="ml-2">2</span>
                        </div>
                      )}
                    {message.sender === "assistant" ? (
                      <StreamingMessage
                        content={message.text}
                        isStreamFinished={
                          !isStreaming || index !== chatHistory.length - 1
                        }
                      />
                    ) : (
                      <p>{message.text}</p>
                    )}
                  </div>
                  {message.sender === "assistant" && message.inferenceStats && (
                    <InferenceStats stats={message.inferenceStats} />
                  )}
                  {message.sender === "assistant" && (
                    <MessageActions
                      messageId={message.id}
                      onCopy={() => {
                        /* Implement copy logic */
                      }}
                      onThumbsUp={() => {
                        /* Implement thumbs up logic */
                      }}
                      onThumbsDown={() => {
                        /* Implement thumbs down logic */
                      }}
                      onRender={onReRender}
                      onContinue={onContinue}
                      isReRendering={reRenderingMessageId === message.id}
                      isStreaming={isStreaming}
                    />
                  )}
                </div>
              ))}
            </div>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar
            orientation="vertical"
            className="w-2 bg-transparent transition-colors duration-150 ease-out hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <ScrollArea.Thumb className="bg-gray-300 rounded-full w-full transition-colors duration-150 ease-out hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500" />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      )}
      {isScrollButtonVisible && (
        <Button
          className="absolute bottom-4 right-4 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300"
          onClick={() => {
            scrollToBottom();
            setIsScrollButtonVisible(false);
          }}
        >
          <ChevronDown className="h-6 w-6 animate-bounce" />
        </Button>
      )}
    </div>
  );
};

export default React.memo(ChatHistory);
