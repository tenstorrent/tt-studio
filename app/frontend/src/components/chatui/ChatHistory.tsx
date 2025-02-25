// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useRef, useEffect, useState, useCallback } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { User, ChevronDown, Bot, X, Database, File } from "lucide-react";
import { Button } from "../ui/button";
import ChatExamples from "./ChatExamples";
import StreamingMessage from "./StreamingMessage";
import MessageActions from "./MessageActions";
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
  ragDatasource:
    | {
        id: string;
        name: string;
        metadata?: {
          created_at?: string;
          embedding_func_name?: string;
          last_uploaded_document?: string;
        };
      }
    | undefined;
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
  // ragDatasource,
}) => {
  // console.log("ChatHistory component rendered", ragDatasource);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const lastMessageRef = useRef<HTMLDivElement>(null);

  const [minimizedFiles, setMinimizedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{
    url: string;
    name: string;
    isImage: boolean;
  } | null>(null);

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
                      messageContent={message.text}
                    />
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

      <FileViewerDialog
        file={selectedFile}
        onClose={() => setSelectedFile(null)}
      />
    </div>
  );
};

export default React.memo(ChatHistory);
