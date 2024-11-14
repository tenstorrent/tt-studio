// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useRef, useEffect, useState } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { User, ChevronDown } from "lucide-react";
import { Button } from "../ui/button";
import InferenceStats from "./InferenceStats";
import ChatExamples from "./ChatExamples";
import StreamingMessage from "./StreamingMessage"; // Importing StreamingMessage

interface ChatMessage {
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
}

export default function ChatHistory({
  chatHistory,
  logo,
  setTextInput,
}: ChatHistoryProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);

  const scrollToBottom = () => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const handleScroll = () => {
    if (viewportRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
      const isAtBottom = scrollHeight - scrollTop <= clientHeight + 100;
      setIsScrollButtonVisible(!isAtBottom);
    }
  };

  useEffect(() => {
    handleScroll();
  }, [chatHistory]);

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  return (
    <div className="flex flex-col w-full flex-grow p-8 font-rmMono relative overflow-hidden">
      {chatHistory.length === 0 && (
        <ChatExamples logo={logo} setTextInput={setTextInput} />
      )}
      {chatHistory.length > 0 && (
        <ScrollArea.Root className="flex-grow h-full overflow-hidden">
          <ScrollArea.Viewport
            ref={viewportRef}
            onScroll={handleScroll}
            className="w-full h-full pr-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-transparent hover:scrollbar-thumb-gray-500"
          >
            <div className="p-4">
              {chatHistory.map((message, index) => (
                <div
                  key={index}
                  className={`flex mb-4 ${
                    message.sender === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {message.sender === "assistant" && (
                    <div className="flex items-start mr-2">
                      <img
                        src={logo}
                        alt="Assistant Logo"
                        className="w-8 h-8 rounded-full"
                      />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] p-3 rounded-lg ${
                      message.sender === "user"
                        ? "bg-TT-green-accent text-white text-right"
                        : "bg-TT-slate text-white text-left"
                    }`}
                    style={{ wordBreak: "break-word" }}
                  >
                    {/* Using StreamingMessage for rich content */}
                    <StreamingMessage
                      content={message.text}
                      isStreamFinished={true}
                    />
                  </div>
                  {message.sender === "user" && (
                    <div className="flex items-end ml-2">
                      <User className="w-6 h-6 text-white" />
                    </div>
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
          onClick={scrollToBottom}
        >
          <ChevronDown className="h-6 w-6 animate-bounce" />
        </Button>
      )}
    </div>
  );
}
