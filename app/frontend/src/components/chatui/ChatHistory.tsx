// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useRef, useEffect, useState, useCallback } from "react";
import { Database, File, X } from "lucide-react";
import { motion } from "framer-motion";
import ChatExamples from "./ChatExamples";
import StreamingMessage from "./StreamingMessage";
import MessageActions from "./MessageActions";
import MessageIndicator from "./MessageIndicator";
import FileDisplay from "./FileDisplay";
import type { ChatMessage } from "./types";
import * as Dialog from "@radix-ui/react-dialog";

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

const FileViewerDialog: React.FC<FileViewerDialogProps> = ({ file, onClose }) => {
  if (!file) return null;

  return (
    <Dialog.Root open={!!file} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gray-900 rounded-lg p-4 max-w-3xl max-h-[90vh] w-[90vw] overflow-auto z-50">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-white truncate max-w-[80%]">{file.name}</h3>
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
    metadata?: Record<string, unknown>;
  };
  isMobileView?: boolean;
  modelName?: string | null;
  toggleableInlineStats?: boolean;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  chatHistory = [],
  logo,
  setTextInput,
  isStreaming,
  onReRender,
  onContinue,
  reRenderingMessageId,
  // ragDatasource,
  isMobileView = false,
  modelName,
  toggleableInlineStats = true,
}) => {
  // console.log("ChatHistory component rendered", ragDatasource);
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

  // Add state for tracking which message has stats toggled open
  const [openStatsMessageId, setOpenStatsMessageId] = useState<string | null>(null);

  // Handler to toggle stats for a specific message
  const handleToggleStats = useCallback((messageId: string) => {
    setOpenStatsMessageId((prev) => (prev === messageId ? null : messageId));
  }, []);

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

  // Scroll handling removed - now managed by parent ChatComponent

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
    const isImage = imageExtensions.includes(extension) || fileUrl.startsWith("data:image/");
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
      className={`flex flex-col w-full grow ${isMobileView ? "pt-4" : "pt-4 pb-2"} relative`}
    >
      {chatHistory.length === 0 && !isStreaming ? (
        <ChatExamples logo={logo} setTextInput={setTextInput} isMobileView={isMobileView} />
      ) : (
        <div className="relative flex flex-col grow">
          {/* INNER CONTAINER - ADJUSTED PADDING WITH WIDER WIDTH */}
          <div
            className={`p-2 sm:p-3 border border-gray-700 rounded-lg ${isMobileView ? "mx-0 border-x-0 rounded-none" : "mx-0"} ${getContainerWidth()}`}
          >
            {/* CHAT MESSAGES */}
            {chatHistory.map((message, index) => (
              <motion.div
                key={message.id || index}
                ref={(el) => {
                  if (el) messageRefs.current.set(message.id || index, el);
                  else messageRefs.current.delete(message.id || index);
                }}
                className={`mb-3 sm:mb-4 flex flex-col ${message.sender === "user" ? "items-end" : "items-start"}`}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  duration: 0.25,
                  delay: index * 0.05,
                  ease: "easeOut",
                }}
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
                            const isUrl = /^(https?:\/\/|www\.)\S+/i.test(segment);
                            if (isUrl) {
                              const cleanUrl = segment.replace(/[.,!?;:]$/, "");
                              const punctuation = segment.slice(cleanUrl.length);
                              return (
                                <React.Fragment key={i}>
                                  <a
                                    href={
                                      cleanUrl.startsWith("www.") ? `https://${cleanUrl}` : cleanUrl
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
                      modelName={modelName}
                      statsOpen={openStatsMessageId === (message.id || "")}
                      onToggleStats={() => handleToggleStats(message.id || "")}
                      toggleableInlineStats={toggleableInlineStats}
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
              </motion.div>
            ))}
            {/* Streaming Indicator */}
            {shouldShowMessageIndicator() && (
              <motion.div
                className={`mb-3 sm:mb-4 flex flex-col items-start`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.1, ease: "easeOut" }}
              >
                <div
                  className={`chat-bubble bg-TT-slate text-white p-2 sm:p-3 rounded-lg mb-1 ${
                    isMobileView ? "text-sm" : "text-base"
                  } ${getBubbleMaxWidth()} break-words overflow-hidden shadow-sm`}
                >
                  <div className="w-full text-left">
                    <MessageIndicator isMobileView={isMobileView} />
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* FILE VIEWER DIALOG */}
      <FileViewerDialog file={selectedFile} onClose={() => setSelectedFile(null)} />
    </div>
  );
};

// Added React.memo for potential performance optimization if props don't change often
export default React.memo(ChatHistory);

