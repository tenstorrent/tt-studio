// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC


import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import MarkdownComponent from "./MarkdownComponent";

interface StreamingMessageProps {
  content: string;
  isStreamFinished: boolean;
  isStopped?: boolean;
  onThinkingBlocksChange?: (hasThinking: boolean, blocks: string[]) => void;
  showThinking?: boolean;
}

interface ProcessedContent {
  cleanedContent: string;
  thinkingBlocks: string[];
}

const processContent = (content: string): ProcessedContent => {
  const thinkingBlocks: string[] = [];

  // Extract completed thinking blocks with <think>...</think> tags (before cleaning)
  const thinkingRegex = /<think>(.*?)<\/think>/gis;
  let match;
  while ((match = thinkingRegex.exec(content)) !== null) {
    thinkingBlocks.push(match[1].trim());
  }

  // Clean the content - be aggressive about removing thinking tokens
  const cleanedContent = content
    .replace(/<\|.*?\|>(&gt;)?/g, "")
    .replace(/\b(assistant|user)\b/gi, "")
    .replace(/\|(?:eot_id|start_header_id)\|/g, "")
    .replace(/^think\s+.*?\/think\s*/gims, "")  // Remove completed thinking blocks
    .replace(/^think\s+.*$/ims, "")  // Remove incomplete thinking blocks during streaming
    .replace(/^\s*think\b.*$/ims, "")  // Extra pass to catch any remaining "think" at start
    .replace(/^\/think\s*/gim, "")  // Remove any stray /think tokens
    .replace(/<think>.*?<\/think>/gis, "") // Remove completed thinking blocks
    .replace(/<think>.*$/is, "") // Remove incomplete thinking blocks during streaming
    .replace(/<\/think>/gi, "") // Remove any stray closing tags
    .replace(/[<>]/g, "") // Remove any remaining angle brackets
    .replace(/&(lt|gt);/g, "")
    .trim();

  return { cleanedContent, thinkingBlocks };
};

const StreamingMessage: React.FC<StreamingMessageProps> = React.memo(
  function StreamingMessage({
    content,
    isStreamFinished,
    isStopped,
    onThinkingBlocksChange,
    showThinking: externalShowThinking,
  }) {
    const [renderedContent, setRenderedContent] = useState("");
    const [showThinking, setShowThinking] = useState(false);
    const [isThinkingActive, setIsThinkingActive] = useState(false);
    const contentRef = useRef(processContent(content, isStreamFinished).cleanedContent);
    const thinkingBlocksRef = useRef<string[]>([]);
    const intervalRef = useRef<number | null>(null);
    const lastChunkRef = useRef("");

    const renderNextChunk = useCallback(() => {
      const currentContent = contentRef.current;
      const currentRenderedLength = renderedContent.length;
      const nextChunk = currentContent.slice(
        currentRenderedLength,
        currentRenderedLength + 10
      );

      if (nextChunk !== lastChunkRef.current) {
        lastChunkRef.current = nextChunk;
        setRenderedContent(currentContent.slice(0, currentRenderedLength + 10));
      }
    }, [renderedContent]);

    useEffect(() => {
      const processed = processContent(content);
      contentRef.current = processed.cleanedContent;
      thinkingBlocksRef.current = processed.thinkingBlocks;

      // Notify parent about thinking blocks
      if (onThinkingBlocksChange) {
        onThinkingBlocksChange(
          processed.thinkingBlocks.length > 0,
          processed.thinkingBlocks
        );
      }

      // Check if thinking is actively streaming (has <think> but no closing </think>)
      const hasIncompleteThinking =
        !isStreamFinished && /<think>(?!.*<\/think>)/is.test(content);
      setIsThinkingActive(hasIncompleteThinking);

      if (isStreamFinished) {
        setRenderedContent(contentRef.current);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        if (!intervalRef.current) {
          intervalRef.current = window.setInterval(() => {
            if (renderedContent.length < contentRef.current.length) {
              renderNextChunk();
            } else {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            }
          }, 10);
        }
      }

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }, [
      content,
      isStreamFinished,
      renderNextChunk,
      renderedContent,
      onThinkingBlocksChange,
    ]);

    const hasThinking = thinkingBlocksRef.current.length > 0;

    // // Debug logging
    // console.log("[StreamingMessage] Render:", {
    //   hasThinking,
    //   showThinking,
    //   thinkingBlocksCount: thinkingBlocksRef.current.length,
    //   isStreamFinished,
    // });

    return (
      <div className="relative">
        {/* Show "Thinking..." indicator while thinking is streaming */}
        {isThinkingActive && (
          <div className="mb-3 flex items-center gap-2 text-sm text-gray-400 italic">
            <motion.span
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              💭
            </motion.span>
            <span>Thinking...</span>
          </div>
        )}

        {/* Show toggle button only after streaming is finished and there are thinking blocks */}
        {isStreamFinished && hasThinking && (
          <div className="mb-3">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition-colors"
            >
              <span className="text-xs">
                {showThinking ? "▼" : "▶"}
              </span>
              <span className="italic">
                {showThinking ? "Hide" : "Show"} thinking process
              </span>
            </button>
            {showThinking && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 p-3 bg-gray-800/50 border border-gray-700 rounded-md"
              >
                {thinkingBlocksRef.current.map((block, index) => (
                  <div key={index} className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                    {block}
                  </div>
                ))}
              </motion.div>
            )}
          </div>
        )}

        {renderedContent.length === 0 && !isStreamFinished && !isThinkingActive && !isStopped ? (
          <motion.span
            className="text-gray-400"
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            ...
          </motion.span>
        ) : (
          <MarkdownComponent>{renderedContent}</MarkdownComponent>
        )}
        {!isStreamFinished && !isStopped && renderedContent.length > 0 && renderedContent.length > 0 && (
          <motion.span
            className="absolute bottom-0 right-0 text-white"
            initial={{ opacity: 1 }}
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            ▋
          </motion.span>
        )}
        {isStopped && (
          <div className="mt-2 text-red-500 font-bold text-sm">
            [Stopped by User]
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.isStreamFinished === nextProps.isStreamFinished &&
    prevProps.content === nextProps.content &&
    prevProps.isStopped === nextProps.isStopped &&
    prevProps.showThinking === nextProps.showThinking
);

export default StreamingMessage;
