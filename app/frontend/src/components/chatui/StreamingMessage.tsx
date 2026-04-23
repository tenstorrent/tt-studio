// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC


import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Search, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
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

interface SourceLink {
  title: string;
  url: string;
}

interface SearchInfo {
  isSearch: boolean;
  queries: string[];
  sources: SourceLink[];
  isDone: boolean;
}

const parseSearchInfo = (text: string): SearchInfo => {
  const queries: string[] = [];
  const sources: SourceLink[] = [];
  const seenUrls = new Set<string>();

  const searchRegex = /Searching:\s*(.+)/g;
  let m;
  while ((m = searchRegex.exec(text)) !== null) {
    const q = m[1].trim();
    if (q) queries.push(q);
  }

  // Parse "Source: [title](url)" lines emitted by the agent
  const sourceRegex = /Source:\s*\[([^\]]*)\]\(([^)]+)\)/g;
  while ((m = sourceRegex.exec(text)) !== null) {
    const title = m[1].trim();
    const url = m[2].trim();
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ title: title || url, url });
    }
  }

  // [searching] marker signals the agent is about to search,
  // even before specific queries arrive.
  const hasSearchSignal = /\[searching\]/.test(text);

  return {
    isSearch: queries.length > 0 || sources.length > 0 || hasSearchSignal,
    queries,
    sources,
    isDone: /\bDone\b/.test(text) || sources.length > 0,
  };
};

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
    .replace(/[\[<|]*python_tag[\]>|]*/gi, "")
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
    const [showThinking, setShowThinking] = useState(Boolean(externalShowThinking));
    const [isThinkingActive, setIsThinkingActive] = useState(false);
    const contentRef = useRef(processContent(content).cleanedContent);
    const thinkingBlocksRef = useRef<string[]>([]);
    const intervalRef = useRef<number | null>(null);
    const lastChunkRef = useRef("");
    const thinkingScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setShowThinking(Boolean(externalShowThinking));
    }, [externalShowThinking]);

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

    // Extract live thinking text from incomplete <think> block during streaming
    const liveThinkMatch = !isStreamFinished ? content.match(/^<think>([\s\S]*)$/i) : null;
    const liveThinkingText = liveThinkMatch ? liveThinkMatch[1] : null;

    // Detect whether the thinking block represents a web search
    const liveSearchInfo = liveThinkingText ? parseSearchInfo(liveThinkingText) : null;
    const completedSearchInfo = hasThinking
      ? parseSearchInfo(thinkingBlocksRef.current.join("\n"))
      : null;
    const isSearchMode = liveSearchInfo?.isSearch || completedSearchInfo?.isSearch;

    // Auto-scroll thinking box to bottom as tokens arrive
    useEffect(() => {
      if (thinkingScrollRef.current) {
        thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
      }
    }, [liveThinkingText]);

    return (
      <div className="relative">
        <AnimatePresence>
          {(isThinkingActive || hasThinking) && (
            <motion.div
              key="thinking-panel"
              layout
              className="mb-3 overflow-hidden"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <AnimatePresence mode="popLayout">
                {isThinkingActive ? (
                  <motion.div
                    key="live"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.2 }}
                  >
                    {isSearchMode && liveSearchInfo ? (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <motion.div
                            className="flex-shrink-0"
                            animate={{ rotate: [0, 360] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          >
                            <Globe size={14} className="text-blue-400" />
                          </motion.div>
                          <motion.span
                            className="text-sm italic text-gray-400"
                            animate={{ opacity: [1, 0.5, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            Searching the web…
                          </motion.span>
                        </div>
                        <div className="rounded-md bg-gray-800/50 border border-gray-700 px-3 py-2">
                          {liveSearchInfo.queries.map((q, i) => (
                            <div key={i} className="flex items-center gap-2 py-1 text-sm text-gray-300">
                              <Search size={12} className="flex-shrink-0 text-gray-500" />
                              <span>{q}</span>
                            </div>
                          ))}
                          {liveSearchInfo.sources.length > 0 && (
                            <div className="mt-1.5 pt-1.5 border-t border-gray-700/50">
                              {liveSearchInfo.sources.map((s, i) => (
                                <a
                                  key={i}
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 py-1 text-sm text-blue-400 hover:text-blue-300 transition-colors truncate"
                                >
                                  <ExternalLink size={12} className="flex-shrink-0" />
                                  <span className="truncate">{s.title}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <motion.span
                            className="text-gray-400"
                            animate={{ opacity: [1, 0.5, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            💭
                          </motion.span>
                          <span className="text-sm italic text-gray-400">Thinking...</span>
                        </div>
                        <p className="text-xs text-gray-600 mb-1.5">
                          The model is reasoning before responding.
                        </p>
                        <div
                          ref={thinkingScrollRef}
                          className="max-h-36 overflow-y-auto rounded-md bg-gray-800/50 border border-gray-700 px-3 py-2 text-sm text-gray-300 font-mono leading-relaxed whitespace-pre-wrap"
                        >
                          {liveThinkingText}
                        </div>
                      </>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="collapsed"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.2, delay: 0.05 }}
                  >
                    {isSearchMode && completedSearchInfo ? (
                      <div>
                        <button
                          onClick={() => setShowThinking(!showThinking)}
                          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition-colors"
                        >
                          <Globe size={14} className="text-blue-400/70" />
                          <span>Searched the web</span>
                          {showThinking ? (
                            <ChevronDown size={14} className="text-gray-500" />
                          ) : (
                            <ChevronRight size={14} className="text-gray-500" />
                          )}
                        </button>
                        <AnimatePresence>
                          {showThinking && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="mt-2 overflow-hidden"
                            >
                              <div className="rounded-md bg-gray-800/50 border border-gray-700 px-3 py-2">
                                {completedSearchInfo.queries.map((q, i) => (
                                  <div key={i} className="flex items-center gap-2 py-1 text-sm text-gray-300">
                                    <Search size={12} className="flex-shrink-0 text-gray-500" />
                                    <span>{q}</span>
                                  </div>
                                ))}
                                {completedSearchInfo.sources.length > 0 && (
                                  <div className="mt-1.5 pt-1.5 border-t border-gray-700/50">
                                    {completedSearchInfo.sources.map((s, i) => (
                                      <a
                                        key={i}
                                        href={s.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 py-1 text-sm text-blue-400 hover:text-blue-300 transition-colors truncate"
                                      >
                                        <ExternalLink size={12} className="flex-shrink-0" />
                                        <span className="truncate">{s.title}</span>
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ) : (
                      <div>
                        <button
                          onClick={() => setShowThinking(!showThinking)}
                          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition-colors"
                        >
                          <span className="text-xs">{showThinking ? "▼" : "▶"}</span>
                          <span className="italic">{showThinking ? "Hide" : "Show"} thinking process</span>
                        </button>
                        <AnimatePresence>
                          {showThinking && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="mt-2 overflow-hidden"
                            >
                              <p className="text-xs text-gray-600 mb-1.5">
                                The model reasoned before responding.
                              </p>
                              <div className="max-h-48 overflow-y-auto rounded-md bg-gray-800/50 border border-gray-700 p-3">
                                {thinkingBlocksRef.current.map((block, index) => (
                                  <div key={index} className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                                    {block}
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

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
        {!isStreamFinished && !isStopped && renderedContent.length > 0 && (
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
