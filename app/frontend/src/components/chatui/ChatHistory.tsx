// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useRef, useEffect } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { User } from "lucide-react";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import InferenceStats from "./InferenceStats";
import ChatExamples from "./ChatExamples";

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] =
    React.useState(false);

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
      const isAtBottom = scrollHeight - scrollTop <= clientHeight + 1;
      setIsScrollButtonVisible(!isAtBottom);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  return (
    <div className="flex flex-col w-full flex-grow p-8 font-rmMono relative overflow-hidden">
      {chatHistory.length === 0 && (
        <ChatExamples logo={logo} setTextInput={setTextInput} />
      )}
      {chatHistory.length > 0 && (
        <ScrollArea.Root className="flex-grow h-0 overflow-y-auto">
          <ScrollArea.Viewport
            ref={viewportRef}
            onScroll={handleScroll}
            className="w-full pr-4"
          >
            <div className="p-4 border rounded-lg">
              {chatHistory.map((message, index) => (
                <div
                  key={index}
                  className={`chat ${message.sender === "user" ? "chat-end" : "chat-start"}`}
                >
                  <div className="chat-image avatar text-left">
                    <div className="w-10 rounded-full">
                      {message.sender === "user" ? (
                        <User className="h-6 w-6 mr-2 text-left" />
                      ) : (
                        <img
                          src={logo}
                          alt="Tenstorrent Logo"
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
                    style={{ wordBreak: "break-word" }}
                  >
                    {message.text}
                  </div>
                  {message.sender === "assistant" && message.inferenceStats && (
                    <InferenceStats stats={message.inferenceStats} />
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </ScrollArea.Viewport>
        </ScrollArea.Root>
      )}
      <div
        className={`absolute bottom-4 right-4 transition-all duration-300 ease-in-out ${
          isScrollButtonVisible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4"
        }`}
      >
        <Button
          className="rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300"
          onClick={scrollToBottom}
        >
          <ChevronDown className="h-6 w-6 animate-bounce" />
        </Button>
      </div>
    </div>
  );
}
