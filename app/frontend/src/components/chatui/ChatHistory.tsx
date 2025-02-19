// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useRef, useEffect, useState, useCallback } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { User, ChevronDown, Bot, X } from "lucide-react";
import { Minimize2, Maximize2 } from "lucide-react";
import { Button } from "../ui/button";
import ChatExamples from "./ChatExamples";
import StreamingMessage from "./StreamingMessage";
import MessageActions from "./MessageActions";
import type { ChatMessage, FileData } from "./types";
import * as Dialog from "@radix-ui/react-dialog";

interface ChatHistoryProps {
  chatHistory: ChatMessage[];
  logo: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  isStreaming: boolean;
  onReRender: (messageId: string) => void;
  onContinue: (messageId: string) => void;
  reRenderingMessageId: string | null;
}

const isImageFile = (
  file: FileData
): file is FileData & { type: "image_url" } => file.type === "image_url";

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
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);
  const [minimizedImages, setMinimizedImages] = useState<Set<string>>(
    new Set()
  );

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
  }, [isStreaming, scrollToBottom]);

  const toggleMinimizeImage = useCallback((imageUrl: string) => {
    setMinimizedImages((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(imageUrl)) {
        newSet.delete(imageUrl);
      } else {
        newSet.add(imageUrl);
      }
      return newSet;
    });
  }, []);

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
                        <Bot className="w-8 h-8 rounded-full mr-2" />
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
                    {message.sender === "assistant" && (
                      <>
                        {reRenderingMessageId === message.id && (
                          <div className="text-yellow-300 font-bold mb-2 flex items-center">
                            <span className="mr-2">Re-rendering</span>
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
                          </div>
                        )}
                        <StreamingMessage
                          content={message.text}
                          isStreamFinished={
                            !isStreaming ||
                            (reRenderingMessageId !== message.id &&
                              index !== chatHistory.length - 1)
                          }
                        />
                      </>
                    )}
                    {message.sender === "user" && (
                      <div className="flex flex-col gap-4">
                        {message.text && (
                          <div className="bg-TT-green-accent/20 p-2 rounded">
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
                        {message.files && message.files.length > 0 && (
                          <div className="bg-gray-800 p-2 rounded">
                            <p className="text-white mb-2 font-semibold">
                              Attached Images:
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {message.files.map(
                                (file, index) =>
                                  isImageFile(file) && (
                                    <div
                                      key={index}
                                      className="relative group max-w-[150px] rounded-lg overflow-hidden border border-gray-700 transition-all duration-300 hover:shadow-lg"
                                    >
                                      {!minimizedImages.has(
                                        file.image_url?.url || ""
                                      ) ? (
                                        <img
                                          src={
                                            file.image_url?.url ||
                                            "/placeholder.svg"
                                          }
                                          alt={file.name}
                                          className="object-cover w-full h-[100px]"
                                          onClick={() =>
                                            setEnlargedImage(
                                              file.image_url?.url ||
                                                "/placeholder.svg"
                                            )
                                          }
                                        />
                                      ) : (
                                        <div className="w-full h-[30px] bg-gray-700"></div>
                                      )}
                                      <div className="p-1 bg-gray-700 text-xs text-gray-300 truncate flex justify-between items-center">
                                        <span className="truncate flex-grow">
                                          {file.name}
                                        </span>
                                        <button
                                          onClick={() =>
                                            toggleMinimizeImage(
                                              file.image_url?.url || ""
                                            )
                                          }
                                          className="ml-2 text-gray-300 hover:text-white flex-shrink-0"
                                        >
                                          {minimizedImages.has(
                                            file.image_url?.url || ""
                                          ) ? (
                                            <Maximize2 size={14} />
                                          ) : (
                                            <Minimize2 size={14} />
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                  )
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {message.sender === "assistant" && (
                    <MessageActions
                      messageId={message.id}
                      onReRender={onReRender}
                      onContinue={onContinue}
                      isReRendering={reRenderingMessageId === message.id}
                      isStreaming={isStreaming}
                      inferenceStats={message.inferenceStats}
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
      <Dialog.Root
        open={!!enlargedImage}
        onOpenChange={() => setEnlargedImage(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg p-4 max-w-3xl max-h-[90vh] w-[90vw] overflow-auto">
            <img
              src={enlargedImage || ""}
              alt="Enlarged view"
              className="w-full h-auto"
            />
            <Dialog.Close asChild>
              <button className="absolute top-2 right-2 text-gray-500 hover:text-gray-700">
                <X className="h-6 w-6" />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};

export default React.memo(ChatHistory);
